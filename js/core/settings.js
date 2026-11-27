// Réglages de l'application, communs à toutes les courses : circuits, barèmes et balises connues.
// Ils sont enregistrés par le serveur (table « settings ») ; chaque course garde sa propre copie
// du circuit et du barème choisis, pour que ses notes ne changent pas après coup.
import { api } from './api.js';
import { bus } from './bus.js';
import { norm, uid } from './util.js';
import { DEFAULT_SCORING } from '../domain/scoring.js';
import { isControlMode } from '../sportident/constants.js';

export const settings = { loaded: false, error: null, circuits: [], baremes: [], balises: [], boitiers: [] };

let loading = null;

function emit() {
  bus.emit('settings', settings);
}

/** Barème CM1 « Course d'Orientation Militaire », proposé par défaut. */
export function defaultBareme() {
  return { id: 'cm1', name: 'Barème CM1', ...structuredCopy(DEFAULT_SCORING) };
}

function structuredCopy(v) {
  return JSON.parse(JSON.stringify(v));
}

/** Charge les réglages (une seule fois) ; au premier lancement, les crée à partir de l'existant. */
export function loadSettings(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const data = await api.getSettings();
      let circuits = data.circuits;
      let baremes = data.baremes;
      if (!Array.isArray(circuits)) {
        // Premier lancement : on reprend les circuits déjà utilisés dans les courses existantes.
        circuits = [];
        const seen = new Set();
        for (const it of await api.listCourses().catch(() => [])) {
          const controls = it.course.controls || [];
          const key = controls.join(',');
          if (!controls.length || seen.has(key)) continue;
          seen.add(key);
          const base = it.course.name && norm(it.course.name) !== 'circuit' ? it.course.name : 'Circuit';
          const day = it.eventDate ? ` du ${new Date(it.eventDate + 'T12:00').toLocaleDateString('fr-FR')}` : '';
          circuits.push({ id: uid(), name: `${base}${day}`, controls: [...controls] });
        }
        await api.putSetting('circuits', circuits);
      }
      if (!Array.isArray(baremes) || !baremes.length) {
        baremes = [defaultBareme()];
        await api.putSetting('baremes', baremes);
      }
      let balises = data.balises;
      if (!Array.isArray(balises)) {
        // Premier lancement : les balises des circuits connus et les boîtiers déjà contrôlés sur ce poste.
        const codes = new Set(circuits.flatMap((c) => c.controls || []));
        for (const e of stationLog()) if (isControlMode(e.mode) && e.code) codes.add(e.code);
        balises = [...codes].sort((a, b) => a - b).map((code) => ({ code }));
        for (const e of stationLog().slice().reverse()) {
          const b = balises.find((x) => x.code === e.code && isControlMode(e.mode));
          if (b) Object.assign(b, { serial: e.serial, battery: e.battery, drift: e.drift, checkedAt: e.at });
        }
        // (un serveur d'une version précédente, pas encore relancé, ne connaît pas ce réglage : on continue)
        await api.putSetting('balises', balises).catch(() => {});
      }
      let boitiers = data.boitiers;
      if (!Array.isArray(boitiers)) {
        // Premier lancement : les boîtiers déjà contrôlés sur ce poste (ancien journal du navigateur).
        const map = new Map();
        for (const e of stationLog().slice().reverse()) {
          if (!e.serial) continue;
          const prev = map.get(e.serial) || { serial: e.serial, history: [] };
          map.set(e.serial, stationRecord(prev, e, e.action || 'Contrôle', e.at));
        }
        boitiers = [...map.values()];
        await api.putSetting('boitiers', boitiers).catch(() => {});
      }
      Object.assign(settings, { loaded: true, error: null, circuits, baremes, balises, boitiers });
    } catch (e) {
      settings.error = e.message;
      loading = null;
    }
    emit();
    return settings;
  })();
  return loading;
}

async function save(key, list) {
  const prev = settings[key];
  settings[key] = list;
  emit();
  try {
    await api.putSetting(key, list);
  } catch (e) {
    settings[key] = prev;
    emit();
    throw e;
  }
}

/** Boîtiers lus ou programmés sur ce poste (journal de la page « Programmer les boîtiers »). */
function stationLog() {
  try {
    return JSON.parse(localStorage.getItem('balise.boitiers') || '[]');
  } catch {
    return [];
  }
}

// --- Boîtiers SportIdent contrôlés (mémoire par n° de série, conservée aux mises à jour) ----------------
/** Fiche d'un boîtier mise à jour après un contrôle, une mise à l'heure ou une programmation. */
function stationRecord(prev, info, action, at = Date.now()) {
  const battery = info.batteryPercent ?? info.battery ?? prev.battery ?? null;
  const rec = {
    ...prev,
    serial: info.serial,
    model: info.model ?? prev.model,
    firmware: info.firmware ?? prev.firmware,
    mode: info.mode ?? prev.mode,
    code: info.code ?? prev.code,
    battery,
    capacityMah: info.capacityMah ?? prev.capacityMah ?? null,
    usedMah: info.usedMah ?? prev.usedMah ?? null,
    batteryDate: info.batteryDate ?? prev.batteryDate ?? null,
    drift: info.drift ?? prev.drift ?? null,
    firstSeenAt: prev.firstSeenAt || at,
    checkedAt: at,
  };
  if (action === "Mis à l'heure" || (action === 'Programmé' && info.synced)) rec.clockSetAt = at;
  if (action === 'Programmé') rec.programmedAt = at;
  rec.history = [{ at, action, mode: rec.mode, code: rec.code, battery, drift: rec.drift }, ...(prev.history || [])].slice(0, 30);
  return rec;
}

/** Fiche enregistrée d'un boîtier (ou null). */
export function stationInfo(serial) {
  return settings.boitiers.find((b) => b.serial === serial) || null;
}

/** Enregistre le contrôle d'un boîtier (action : « Contrôle », « Mis à l'heure » ou « Programmé »). */
export function noteStationChecked(info, action = 'Contrôle') {
  if (!settings.loaded || !info?.serial) return Promise.resolve();
  const prev = stationInfo(info.serial) || {};
  const rec = stationRecord(prev, info, action);
  return save('boitiers', [rec, ...settings.boitiers.filter((b) => b.serial !== info.serial)]);
}

// --- Balises connues (numéros des boîtiers « poste ») --------------------------------------------------
const byCode = (a, b) => a.code - b.code;

export function saveBalises(list) {
  const seen = new Map();
  for (const b of list) if (Number.isInteger(b.code) && b.code >= 1 && b.code <= 1023) seen.set(b.code, { ...(seen.get(b.code) || {}), ...b });
  return save('balises', [...seen.values()].sort(byCode));
}

/**
 * Position d'un poste sur la carte : { lat, lon, acc (m), source: 'manuel' | 'gps', at }.
 * pos = null retire la position.
 */
export function setBalisePosition(code, pos) {
  const prev = settings.balises.find((b) => b.code === code) || { code };
  const next = { ...prev };
  if (pos) next.pos = { lat: pos.lat, lon: pos.lon, acc: pos.acc ?? null, source: pos.source || 'manuel', at: pos.at || Date.now() };
  else delete next.pos;
  return saveBalises([...settings.balises.filter((b) => b.code !== code), next]);
}

/**
 * Poste contrôlé sur place : sa position est précisée avec le GPS si la mesure est assez précise et
 * meilleure que celle enregistrée (un placement à la main est toujours remplacé par une mesure GPS).
 * Renvoie la position retenue, ou null si rien n'a changé.
 */
export async function refineBalisePosition(code, fix, maxAcc = 40) {
  if (!settings.loaded || !fix || !(fix.acc <= maxAcc)) return null;
  const cur = settings.balises.find((b) => b.code === code)?.pos;
  if (cur && cur.source === 'gps' && cur.acc != null && cur.acc <= fix.acc) return null;
  const pos = { lat: fix.lat, lon: fix.lon, acc: Math.round(fix.acc), source: 'gps', at: Date.now() };
  await setBalisePosition(code, pos);
  return { ...pos, previous: cur || null };
}

/** Ajoute des numéros de balises (sans doublon). */
export function addBalises(codes) {
  const known = new Set(settings.balises.map((b) => b.code));
  const fresh = codes.filter((c) => !known.has(c)).map((code) => ({ code }));
  return fresh.length ? saveBalises([...settings.balises, ...fresh]) : Promise.resolve();
}

export function removeBalise(code) {
  return save('balises', settings.balises.filter((b) => b.code !== code));
}

/** Boîtier « poste » lu ou programmé : sa balise est ajoutée ou mise à jour (batterie, horloge, date). */
export function noteBaliseChecked(info) {
  if (!settings.loaded || !isControlMode(info?.mode) || !info.code) return Promise.resolve();
  const entry = { code: info.code, serial: info.serial, battery: info.batteryPercent ?? null, drift: info.drift ?? null, checkedAt: Date.now() };
  const others = settings.balises.filter((b) => b.code !== info.code);
  const prev = settings.balises.find((b) => b.code === info.code) || {};
  return saveBalises([...others, { ...prev, ...entry }]);
}

export function saveCircuit(circuit) {
  const doc = { ...circuit, id: circuit.id || uid() };
  const list = settings.circuits.some((c) => c.id === doc.id) ? settings.circuits.map((c) => (c.id === doc.id ? doc : c)) : [...settings.circuits, doc];
  return save('circuits', list).then(() => doc);
}

export function deleteCircuit(id) {
  return save('circuits', settings.circuits.filter((c) => c.id !== id));
}

export function saveBareme(bareme) {
  const doc = { ...bareme, id: bareme.id || uid() };
  const list = settings.baremes.some((b) => b.id === doc.id) ? settings.baremes.map((b) => (b.id === doc.id ? doc : b)) : [...settings.baremes, doc];
  return save('baremes', list).then(() => doc);
}

export function deleteBareme(id) {
  return save('baremes', settings.baremes.filter((b) => b.id !== id));
}

/** Partie « calcul » d'un barème (ce que la course enregistre dans event.scoring). */
export function scoringFromBareme(b) {
  const { id, name, ...cfg } = b;
  return structuredCopy(cfg);
}

export function sameScoring(a, b) {
  return JSON.stringify(normalizeScoring(a)) === JSON.stringify(normalizeScoring(b));
}

function normalizeScoring(cfg) {
  const c = { ...DEFAULT_SCORING, ...(cfg || {}) };
  return [c.steps.map(([m, n]) => [Number(m), Number(n)]), +c.overtimePerMinute, c.overtimeRounding, +c.firstPenalty, +c.missingPenalty, +c.minNote, +c.maxNote];
}
