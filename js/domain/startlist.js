// Tirage au sort des heures de départ.
import { norm } from '../core/util.js';

export const INTERVALS = [
  { value: 0, label: 'Départ en masse' },
  { value: 15, label: '15 s' },
  { value: 20, label: '20 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 90, label: '1 min 30' },
  { value: 120, label: '2 min' },
  { value: 180, label: '3 min' },
  { value: 240, label: '4 min' },
  { value: 300, label: '5 min' },
];

export const DRAW_MODES = [
  { value: 'random', label: 'Aléatoire' },
  { value: 'clubs', label: 'Aléatoire, clubs séparés' },
  { value: 'keep', label: 'Ordre de la liste' },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Évite que deux coureurs du même club partent l'un après l'autre (si possible).
function spreadClubs(list) {
  const groups = new Map();
  for (const c of list) {
    const k = norm(c.club) || `__${c.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = [];
  let prev = null;
  while (out.length < list.length) {
    let best = null;
    for (const [k, arr] of groups) {
      if (!arr.length || k === prev) continue;
      if (!best || arr.length > groups.get(best).length) best = k;
    }
    if (best == null) best = prev;
    out.push(groups.get(best).shift());
    prev = best;
  }
  return out;
}

/** Renvoie [{id, startTime}] pour les coureurs donnés. */
export function drawStartTimes(comps, { first, interval = 120, mode = 'random' }) {
  let order = mode === 'keep' ? [...comps] : shuffle(comps);
  if (mode === 'clubs') order = spreadClubs(order);
  return order.map((c, i) => ({ id: c.id, startTime: first + i * interval }));
}
