// Calcul des résultats : contrôle du circuit, temps, classements, temps intermédiaires.
//
// Deux types d'épreuve :
//  - classique (event.mode absent ou 'classic') : postes à poinçonner dans l'ordre, PM si poste manquant ;
//  - au score militaire (event.mode === 'score') : balises dans n'importe quel ordre, 1re balise imposée,
//    note /20 calculée avec le barème (voir scoring.js), regroupement par section.
import { DAY, HALF_DAY, resolve12h } from '../core/time.js';
import { compareText } from '../core/util.js';
import { computeNote, scoringOf } from './scoring.js';

export const STATUS_LABEL = {
  OK: 'OK',
  MP: 'PM',
  DNF: 'Abandon',
  DNS: 'Non partant',
  DSQ: 'Disqualifié',
  RUN: 'En course',
};

export const STATUS_TITLE = {
  OK: 'Classé',
  MP: 'Poste manquant',
  DNF: "Abandon (pas d'arrivée)",
  DNS: 'Non partant',
  DSQ: 'Disqualifié',
  RUN: 'Pas encore arrivé',
};

export const IOF_STATUS = {
  OK: 'OK',
  MP: 'MissingPunch',
  DNF: 'DidNotFinish',
  DNS: 'DidNotStart',
  DSQ: 'Disqualified',
  RUN: 'Active',
};

const STATUS_ORDER = { OK: 0, MP: 2, DNF: 3, DSQ: 4, RUN: 5, DNS: 6 };

export const isScoreMode = (event) => event?.mode === 'score';

/** Heures d'une lecture ramenées sur la journée (gestion des SI-Card 5 sur 12 h). */
export function cardTimes(read, zeroTime) {
  const conv = (t) => (t == null ? null : read.h24 ? t : resolve12h(t, zeroTime));
  return {
    start: conv(read.start),
    finish: conv(read.finish),
    check: conv(read.check),
    clear: conv(read.clear),
    punches: (read.punches || []).map((p) => ({ code: p.code, time: conv(p.time) })),
  };
}

/** Recherche les postes du circuit, dans l'ordre, parmi les poinçons. */
export function matchCourse(punches, controls) {
  const used = new Array(punches.length).fill(false);
  const found = [];
  let idx = 0;
  for (const code of controls) {
    let j = idx;
    while (j < punches.length && punches[j].code !== code) j++;
    if (j < punches.length) {
      found.push(j);
      used[j] = true;
      idx = j + 1;
    } else {
      found.push(-1);
    }
  }
  return { found, used, missing: controls.filter((_, i) => found[i] < 0) };
}

/** Balises d'un circuit au score : chaque balise compte une fois, dans n'importe quel ordre. */
export function matchScore(punches, controls) {
  const set = new Set(controls);
  const seen = new Set();
  const valid = [];
  const extra = [];
  for (const p of punches) {
    if (set.has(p.code) && !seen.has(p.code)) {
      seen.add(p.code);
      valid.push(p);
    } else extra.push(p);
  }
  const missing = [...set].filter((c) => !seen.has(c));
  return { valid, extra, missing, total: set.size };
}

/** Résultat d'un coureur. */
export function evaluate(comp, read, course, event) {
  const zero = event?.zeroTime ?? 0;
  const score = isScoreMode(event);
  const r = {
    status: 'RUN',
    time: null,
    start: null,
    finish: null,
    splits: [],
    finishLeg: null,
    missing: [],
    extra: [],
    warnings: [],
    readId: read?.id ?? null,
    validated: null,
    totalControls: course?.controls?.length ? new Set(course.controls).size : 0,
    first: null,
    score: null,
    note: null,
  };
  const card = read ? cardTimes(read, zero) : null;

  // Départ : saisie manuelle > selon le mode de l'épreuve (puce ou liste de départ)
  const listStart = comp.startTime ?? null;
  const cardStart = card?.start ?? null;
  let start;
  if (comp.manualStart != null) start = comp.manualStart;
  else if (event?.startMode === 'list') start = listStart ?? cardStart;
  else start = cardStart ?? listStart;
  r.start = start;

  // Passage de minuit éventuel
  const unwrap = (t) => (t != null && start != null && t < start - HALF_DAY ? t + DAY : t);
  const finish = comp.manualFinish ?? unwrap(card?.finish ?? null);
  r.finish = finish;

  if (card && course) {
    const punches = card.punches.map((p) => ({ code: p.code, time: unwrap(p.time) }));
    let prev = start;
    if (score) {
      const m = matchScore(punches, course.controls || []);
      m.valid.forEach((p, i) => {
        r.splits.push({
          n: i + 1,
          code: p.code,
          time: p.time,
          cumul: p.time != null && start != null ? p.time - start : null,
          leg: p.time != null && prev != null ? p.time - prev : null,
        });
        // Une heure qui recule (horloge de boîtier mal réglée) ne sert pas de référence au partiel suivant.
        if (p.time != null && (prev == null || p.time >= prev)) prev = p.time;
      });
      r.missing = m.missing;
      r.extra = m.extra;
      r.validated = m.valid.length;
    } else {
      const m = matchCourse(punches, course.controls || []);
      m.found.forEach((j, i) => {
        const code = course.controls[i];
        if (j >= 0) {
          const t = punches[j].time;
          r.splits.push({
            n: i + 1,
            code,
            time: t,
            cumul: t != null && start != null ? t - start : null,
            leg: t != null && prev != null ? t - prev : null,
          });
          if (t != null && (prev == null || t >= prev)) prev = t;
        } else {
          r.splits.push({ n: i + 1, code, time: null, cumul: null, leg: null, missing: true });
          prev = null;
        }
      });
      r.missing = m.missing;
      r.extra = punches.filter((_, i) => !m.used[i]);
      r.validated = r.splits.filter((s) => !s.missing).length;
    }
    if (finish != null && prev != null) r.finishLeg = finish - prev;
  } else if (card) {
    r.extra = card.punches;
  }

  // 1re balise imposée (course au score)
  if (score && card) {
    const expected = comp.firstControl != null && comp.firstControl !== '' ? Number(comp.firstControl) : null;
    const punched = r.splits[0]?.code ?? null;
    r.first = { expected, punched, ok: expected == null ? null : punched === expected };
  }

  if (start != null && finish != null && finish >= start) r.time = finish - start;

  if (comp.status === 'DNS' || comp.status === 'DNF' || comp.status === 'DSQ') {
    r.status = comp.status;
  } else if (!read && comp.manualFinish == null) {
    r.status = 'RUN';
  } else if (!course) {
    r.status = 'MP';
    r.warnings.push('Aucun circuit associé à la catégorie');
  } else if (start == null) {
    r.status = 'MP';
    r.warnings.push('Heure de départ inconnue');
  } else if (!score && r.missing.length) {
    r.status = 'MP';
  } else if (finish == null) {
    r.status = 'DNF';
  } else if (finish < start) {
    r.status = 'MP';
    r.warnings.push("Heure d'arrivée antérieure au départ");
  } else {
    r.status = 'OK';
  }

  if (score && r.status === 'OK') {
    r.score = computeNote({ time: r.time, missing: r.missing.length, firstOk: r.first?.ok ?? null }, scoringOf(event));
    r.note = r.score?.note ?? null;
  }
  if (comp.manualStart != null || comp.manualFinish != null) r.warnings.push('Heure corrigée manuellement');
  return r;
}

function rankRows(comps, results, { score = false } = {}) {
  const rows = comps.map((comp) => ({ comp, res: results.get(comp.id), place: null, behind: null }));
  const key = (row) => (row.res.status === 'OK' ? (row.comp.nc ? 1 : 0) : STATUS_ORDER[row.res.status] ?? 9);
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka - kb;
    if (ka <= 1) {
      if (score && a.res.note !== b.res.note) return (b.res.note ?? -1) - (a.res.note ?? -1);
      if (a.res.time !== b.res.time) return a.res.time - b.res.time;
    }
    return compareText(a.comp.lastName, b.comp.lastName) || compareText(a.comp.firstName, b.comp.firstName);
  });
  let place = 0;
  let count = 0;
  let last = null;
  let leader = null;
  for (const row of rows) {
    if (row.res.status === 'OK' && !row.comp.nc) {
      count++;
      const k = score ? `${row.res.note}|${row.res.time}` : row.res.time;
      if (k !== last) place = count;
      last = k;
      row.place = place;
      if (leader == null) leader = row.res.time;
      row.behind = row.res.time - leader;
    }
  }

  if (score) return { rows, ranked: count, bestLegs: [], bestFinishLeg: null };

  // Classements par tronçon et au cumul (coureurs classés uniquement)
  const ranked = rows.filter((r) => r.res.status === 'OK');
  const nControls = rows.reduce((m, r) => Math.max(m, r.res.splits.length), 0);
  const best = [];
  const rankBy = (getter, setter) => {
    const vals = ranked.map((r) => ({ r, v: getter(r) })).filter((x) => x.v != null && x.v >= 0);
    vals.sort((a, b) => a.v - b.v);
    let p = 0;
    let lastV = null;
    vals.forEach((x, i) => {
      if (x.v !== lastV) p = i + 1;
      lastV = x.v;
      setter(x.r, p);
    });
    return vals.length ? vals[0].v : null;
  };
  for (let i = 0; i < nControls; i++) {
    best[i] = rankBy(
      (r) => r.res.splits[i]?.leg,
      (r, p) => (r.res.splits[i].legRank = p)
    );
    rankBy(
      (r) => r.res.splits[i]?.cumul,
      (r, p) => (r.res.splits[i].cumulRank = p)
    );
  }
  const bestFinish = rankBy(
    (r) => r.res.finishLeg,
    (r, p) => (r.res.finishLegRank = p)
  );
  return { rows, ranked: count, bestLegs: best, bestFinishLeg: bestFinish };
}

/** Section d'un coureur (course au score) : texte libre, « Sans section » si vide. */
export function sectionKey(comp) {
  return String(comp?.section ?? '').trim();
}

export function sectionLabel(key) {
  if (!key) return 'Sans section';
  return /^\d+$/.test(key) ? `Section ${key}` : key;
}

/** Calcule tous les résultats d'une épreuve à partir de l'état du magasin. */
export function computeAll(s) {
  const event = s.event;
  const score = isScoreMode(event);
  const readsByComp = new Map();
  const unassigned = [];
  for (const rd of s.cards.values()) {
    if (rd.competitorId && s.competitors.has(rd.competitorId)) {
      const prev = readsByComp.get(rd.competitorId);
      if (!prev || rd.readAt > prev.readAt) readsByComp.set(rd.competitorId, rd);
    } else if (!rd.archived) {
      unassigned.push(rd);
    }
  }
  unassigned.sort((a, b) => b.readAt - a.readAt);

  const results = new Map();
  for (const c of s.competitors.values()) {
    const cls = s.classes.get(c.classId);
    const course = cls ? s.courses.get(cls.courseId) : null;
    const res = evaluate(c, readsByComp.get(c.id), course, event);
    if (!cls) res.warnings.push('Aucune catégorie');
    results.set(c.id, res);
  }

  const byClass = new Map();
  for (const cls of s.classes.values()) byClass.set(cls.id, []);
  const noClass = [];
  for (const c of s.competitors.values()) (byClass.get(c.classId) || noClass).push(c);

  const classes = new Map();
  for (const [classId, comps] of byClass) classes.set(classId, rankRows(comps, results, { score }));

  // Groupes de résultats : catégories (classique) ou sections (score)
  const groups = [];
  if (score) {
    const bySection = new Map();
    for (const c of s.competitors.values()) {
      const k = sectionKey(c);
      if (!bySection.has(k)) bySection.set(k, []);
      bySection.get(k).push(c);
    }
    const keys = [...bySection.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : compareText(a, b)));
    for (const k of keys) {
      const ranking = rankRows(bySection.get(k), results, { score });
      groups.push({ id: 'sec:' + k, key: k, name: sectionLabel(k), courseId: null, ...ranking });
    }
  } else {
    const list = [...s.classes.values()].sort((a, b) => compareText(a.name, b.name));
    for (const cls of list) groups.push({ id: cls.id, key: cls.id, name: cls.name, courseId: cls.courseId, ...classes.get(cls.id) });
  }

  const stats = { total: 0, dns: 0, finished: 0, ok: 0, mp: 0, dnf: 0, dsq: 0, running: 0, unassigned: unassigned.length };
  for (const c of s.competitors.values()) {
    const st = results.get(c.id).status;
    stats.total++;
    if (st === 'DNS') stats.dns++;
    else if (st === 'RUN') stats.running++;
    else {
      stats.finished++;
      if (st === 'OK') stats.ok++;
      else if (st === 'MP') stats.mp++;
      else if (st === 'DNF') stats.dnf++;
      else if (st === 'DSQ') stats.dsq++;
    }
  }

  // Ligne de classement de chaque coureur (dans sa section en mode score, sa catégorie sinon)
  const rowByComp = new Map();
  for (const g of score ? groups : classes.values()) for (const row of g.rows) rowByComp.set(row.comp.id, { ...row, ranked: g.ranked });

  // Classement général (course au score) : meilleure note, puis meilleur temps
  const overall = score ? rankRows([...s.competitors.values()], results, { score }) : null;

  return { results, readsByComp, unassigned, classes, groups, noClass, stats, rowByComp, score, overall };
}

/** Circuits les plus compatibles avec une lecture (pour une puce inconnue). */
export function suggestCourses(read, s) {
  const punches = cardTimes(read, s.event?.zeroTime).punches;
  const score = isScoreMode(s.event);
  const out = [];
  for (const course of s.courses.values()) {
    if (!course.controls?.length) continue;
    const m = score ? matchScore(punches, course.controls) : matchCourse(punches, course.controls);
    const extra = score ? m.extra.length : m.used.filter((u) => !u).length;
    const classes = [...s.classes.values()].filter((c) => c.courseId === course.id);
    out.push({ course, missing: m.missing.length, extra, classes });
  }
  out.sort((a, b) => a.missing - b.missing || a.extra - b.extra);
  return out.slice(0, 3);
}
