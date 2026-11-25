// Réglages de l'application, communs à toutes les courses : bibliothèque de circuits et barèmes.
// Ils sont enregistrés par le serveur (table « settings ») ; chaque course garde sa propre copie
// du circuit et du barème choisis, pour que ses notes ne changent pas après coup.
import { api } from './api.js';
import { bus } from './bus.js';
import { norm, uid } from './util.js';
import { DEFAULT_SCORING } from '../domain/scoring.js';

export const settings = { loaded: false, error: null, circuits: [], baremes: [] };

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
      Object.assign(settings, { loaded: true, error: null, circuits, baremes });
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
