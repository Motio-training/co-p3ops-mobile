// Service de lecture : reçoit les puces lues par le boîtier, les enregistre
// et les associe aux coureurs. Actif quelle que soit la page affichée.
import { station } from '../sportident/station.js';
import { getDerived, mutate, put, putOp, store } from './store.js';
import { bus, toast } from './bus.js';
import { personName, uid } from './util.js';
import { playSound } from './sound.js';
import { getPref } from './prefs.js';
import { printTicket } from '../io/reports.js';

export const readout = { lastId: null, reading: null };

export function initReadout() {
  station.addEventListener('card-reading', (e) => {
    readout.reading = e.detail;
    bus.emit('readout', {});
  });
  station.addEventListener('card-error', (e) => {
    readout.reading = null;
    toast(e.detail.message, 'error');
    playSound('error');
    bus.emit('readout', {});
  });
  station.addEventListener('card', (e) => {
    readout.reading = null;
    handleCard(e.detail.card, e.detail.source);
  });
}

function sameCardData(a, b) {
  if (a.start !== b.start || a.finish !== b.finish) return false;
  if ((a.punches || []).length !== (b.punches || []).length) return false;
  return a.punches.every((p, i) => p.code === b.punches[i].code && p.time === b.punches[i].time);
}

export function handleCard(card, source = 'station') {
  if (!store.eventId || store.status !== 'ready') {
    toast(`Puce ${card.number} lue, mais aucune épreuve n'est ouverte : ouvrez l'épreuve puis relisez la puce.`, 'error');
    playSound('error');
    return;
  }
  const read = {
    id: uid(),
    number: card.number,
    type: card.type,
    h24: card.h24 !== false,
    check: card.check ?? null,
    clear: card.clear ?? null,
    start: card.start ?? null,
    finish: card.finish ?? null,
    punches: (card.punches || []).map((p) => ({ code: p.code, time: p.time ?? null })),
    readAt: Date.now(),
    source,
    competitorId: null,
  };

  // Relecture d'une puce identique : rien ne change.
  const same = [...store.cards.values()].find((r) => r.number === read.number && sameCardData(r, read));
  if (same) {
    readout.lastId = same.id;
    bus.emit('readout', { id: same.id, duplicate: true });
    toast(`Puce ${read.number} déjà lue — résultat inchangé.`, 'info');
    feedback(same.id, { print: false });
    return;
  }

  const d = getDerived();
  const owners = [...store.competitors.values()].filter((c) => Number(c.card) === read.number);
  let target = null;
  if (owners.length === 1) {
    if (d.readsByComp.has(owners[0].id)) read.note = 'conflict';
    else target = owners[0];
  } else if (owners.length > 1) {
    let free = owners.filter((o) => !d.readsByComp.has(o.id) && o.status !== 'DNS');
    if (free.length > 1) {
      // Même puce sur plusieurs lignes : on départage par la 1re balise imposée.
      const codes = new Set([...store.courses.values()].flatMap((c) => c.controls || []));
      const first = read.punches.find((p) => codes.has(p.code))?.code ?? read.punches[0]?.code;
      const byFirst = free.filter((o) => o.firstControl != null && Number(o.firstControl) === first);
      if (byFirst.length === 1) free = byFirst;
    }
    if (free.length === 1) target = free[0];
    else read.note = 'ambiguous';
  }
  read.competitorId = target?.id ?? null;
  const ops = [putOp('card', read)];
  if (target && target.status === 'DNS') ops.push(putOp('competitor', { ...target, status: '' }));
  mutate(ops);
  readout.lastId = read.id;
  bus.emit('readout', { id: read.id });
  feedback(read.id);
}

function feedback(readId, { print = true } = {}) {
  const read = store.cards.get(readId);
  const compId = read?.competitorId;
  if (!compId || !store.competitors.has(compId)) {
    playSound('unknown');
    return;
  }
  const res = getDerived().results.get(compId);
  const clean = res?.status === 'OK' && !res.missing.length && res.first?.ok !== false;
  playSound(clean ? 'ok' : 'mp');
  if (print && getPref('autoPrint')) printTicket(readId);
}

/** Associe une lecture à un coureur (la lecture précédente du coureur est archivée). */
export function assignRead(readId, compId) {
  const read = store.cards.get(readId);
  const comp = store.competitors.get(compId);
  if (!read || !comp) return;
  const ops = [];
  for (const r of store.cards.values()) {
    if (r.id !== readId && r.competitorId === compId) ops.push(putOp('card', { ...r, competitorId: null, archived: true }));
  }
  const { note, ...rest } = read;
  ops.push(putOp('card', { ...rest, competitorId: compId, archived: false }));
  const patch = {};
  if (Number(comp.card) !== read.number) patch.card = read.number;
  if (comp.status === 'DNS') patch.status = '';
  if (Object.keys(patch).length) ops.push(putOp('competitor', { ...comp, ...patch }));
  mutate(ops);
  readout.lastId = readId;
  bus.emit('readout', { id: readId });
  toast(`Lecture attribuée à ${personName(comp)}.`, 'success');
  feedback(readId);
}

export function unassignRead(readId) {
  const read = store.cards.get(readId);
  if (!read) return;
  put('card', { ...read, competitorId: null, archived: false });
}

export function archiveRead(readId) {
  const read = store.cards.get(readId);
  if (!read) return;
  put('card', { ...read, competitorId: null, archived: true });
}

/**
 * Définit les balises d'un circuit à partir d'une puce de référence (personne ayant fait toute la course).
 * Sans circuit existant, un circuit est créé et associé aux catégories qui n'en ont pas.
 */
export function courseFromRead(readId, courseId = null) {
  const read = store.cards.get(readId);
  if (!read) return null;
  const codes = [];
  for (const p of read.punches) if (!codes.includes(p.code)) codes.push(p.code);
  if (!codes.length) {
    toast('Cette puce ne contient aucun poinçon.', 'error');
    return null;
  }
  // Course au score : l'ordre ne compte pas, les balises sont rangées par numéro.
  if (store.event?.mode === 'score') codes.sort((a, b) => a - b);
  const existing = courseId ? store.courses.get(courseId) : null;
  const course = existing ? { ...existing, controls: codes } : { id: uid(), name: 'Circuit', length: 0, climb: 0, controls: codes };
  const ops = [putOp('course', course)];
  // La puce de référence n'est pas celle d'un participant : on la retire des puces à traiter.
  if (!read.competitorId) ops.push(putOp('card', { ...read, archived: true, note: 'reference' }));
  for (const cls of store.classes.values()) {
    if (!cls.courseId || !store.courses.has(cls.courseId)) ops.push(putOp('class', { ...cls, courseId: course.id }));
  }
  mutate(ops);
  toast(`Circuit « ${course.name} » : ${codes.length} balises enregistrées depuis la puce ${read.number}.`, 'success');
  return course;
}

/** Crée un coureur pour une puce inconnue et lui attribue la lecture. */
export function createCompetitorFromRead(readId, data) {
  const read = store.cards.get(readId);
  if (!read) return null;
  const comp = {
    id: uid(),
    firstName: '',
    lastName: '',
    club: '',
    section: '',
    firstControl: null,
    classId: [...store.classes.values()].length === 1 ? [...store.classes.values()][0].id : '',
    bib: '',
    startTime: null,
    status: '',
    nc: false,
    rented: false,
    licence: '',
    manualStart: null,
    manualFinish: null,
    createdAt: Date.now(),
    ...data,
    card: read.number,
  };
  const { note, ...rest } = read;
  mutate([putOp('competitor', comp), putOp('card', { ...rest, competitorId: comp.id, archived: false })]);
  readout.lastId = readId;
  bus.emit('readout', { id: readId });
  feedback(readId);
  return comp;
}
