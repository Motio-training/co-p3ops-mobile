// Réglages de l'application, communs à toutes les courses : circuits, barèmes et balises connues.
// Ils sont enregistrés par le serveur (table « settings ») ; chaque course garde sa propre copie
// du circuit et du barème choisis, pour que ses notes ne changent pas après coup.
import { api } from './api.js';
import { bus } from './bus.js';
import { norm, uid } from './util.js';
import { DEFAULT_SCORING } from '../domain/scoring.js';
import { isControlMode } from '../sportident/constants.js';

export const settings = { loaded: false, error: null, circuits: [], baremes: [], balises: [] };

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
      Object.assign(settings, { loaded: true, error: null, circuits, baremes, balises });
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

// --- Balises connues (numéros des boîtiers « poste ») --------------------------------------------------
const byCode = (a, b) => a.code - b.code;

export function saveBalises(list) {
  const seen = new Map();
  for (const b of list) if (Number.isInteger(b.code) && b.code >= 1 && b.code <= 1023) seen.set(b.code, { ...(seen.get(b.code) || {}), ...b });
  return save('balises', [...seen.values()].sort(byCode));
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
