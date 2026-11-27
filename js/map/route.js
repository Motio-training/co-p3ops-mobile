// Itinéraires à pied entre la position GPS et les postes, « à travers champs » : on suit routes et chemins
// quand c'est plus rapide, sinon on coupe à travers champs ou sous-bois praticables (voir terrain.js).
// Plusieurs postes : temps de marche entre chaque paire de points, puis ordre de passage le plus rapide
// (calcul exact jusqu'à 10 postes, au-delà ordre approché). Sans données de terrain (pas de réseau et zone
// jamais enregistrée) : trajets à vol d'oiseau.
import { distance } from './geo.js';
import { boundsAround, buildGrid, cellOf, cellPath, dijkstra, latLonOf, loadTerrain, smoothPath, spanM } from './terrain.js';

const MAX_SPAN = 9000; // m : au-delà, zone trop grande pour un calcul à travers champs
const MAX_CELLS = 450000;
const OFF_TRAIL = 0.8; // m/s pour les trajets à vol d'oiseau

const pause = () => new Promise((r) => setTimeout(r, 0));

function straightLeg(a, b) {
  const d = distance(a, b);
  return { legs: [{ coords: [a, b], offTrail: true }], distance: d, duration: d / OFF_TRAIL, straight: true };
}

/** Ordre de visite le plus rapide de k points depuis le nœud 0 (cost(i, j) entre nœuds 0..k). */
function solveOrder(cost, k, back) {
  if (k <= 10) {
    const FULL = 1 << k;
    const dp = new Float64Array(FULL * k).fill(Infinity);
    const prev = new Int16Array(FULL * k).fill(-1);
    for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = cost(0, j + 1);
    for (let mask = 1; mask < FULL; mask++)
      for (let j = 0; j < k; j++) {
        const cur = dp[mask * k + j];
        if (!(mask & (1 << j)) || cur === Infinity) continue;
        for (let m = 0; m < k; m++) {
          if (mask & (1 << m)) continue;
          const nm = mask | (1 << m);
          const c = cur + cost(j + 1, m + 1);
          if (c < dp[nm * k + m]) {
            dp[nm * k + m] = c;
            prev[nm * k + m] = j;
          }
        }
      }
    let best = Infinity;
    let last = 0;
    for (let j = 0; j < k; j++) {
      const c = dp[(FULL - 1) * k + j] + (back ? cost(j + 1, 0) : 0);
      if (c < best) {
        best = c;
        last = j;
      }
    }
    const order = [];
    let mask = FULL - 1;
    let j = last;
    while (j >= 0) {
      order.unshift(j);
      const p = prev[mask * k + j];
      mask &= ~(1 << j);
      j = p;
    }
    return order;
  }
  // Au-delà de 10 postes : plus proche voisin puis améliorations 2-opt
  let order = [];
  const left = new Set(Array.from({ length: k }, (_, i) => i));
  let cur = 0;
  while (left.size) {
    let bestJ = null;
    for (const j of left) if (bestJ == null || cost(cur, j + 1) < cost(cur, bestJ + 1)) bestJ = j;
    order.push(bestJ);
    left.delete(bestJ);
    cur = bestJ + 1;
  }
  const total = (o) => o.reduce((s, j, i) => s + cost(i ? o[i - 1] + 1 : 0, j + 1), 0) + (back ? cost(o[o.length - 1] + 1, 0) : 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < order.length - 1; a++)
      for (let b = a + 1; b < order.length; b++) {
        const o = [...order.slice(0, a), ...order.slice(a, b + 1).reverse(), ...order.slice(b + 1)];
        if (total(o) + 1e-6 < total(order)) {
          order = o;
          improved = true;
        }
      }
  }
  return order;
}

/**
 * Itinéraire le plus rapide depuis `start` par tous les `points` ({ code, lat, lon }).
 * back = true : retour au point de départ.
 * onProgress(étape, fait, total) ; étape : 'terrain' (téléchargement) ou 'calcul'.
 * Renvoie { order, legs: [{ legs: [{coords, offTrail}], distance, duration, to }], distance, duration,
 *           offline, reason }.
 */
export async function planTour(start, points, { back = false, onProgress, signal } = {}) {
  const nodes = [start, ...points];
  const k = points.length;
  let grid = null;
  let reason = null;
  const bounds = boundsAround(nodes, Math.max(250, spanM(boundsAround(nodes, 0)) * 0.2));
  if (spanM(bounds) > MAX_SPAN) reason = 'Postes trop éloignés pour un itinéraire à travers champs : trajets à vol d’oiseau.';
  else {
    try {
      const data = await loadTerrain(bounds, { onProgress: (d, t) => onProgress?.('terrain', d, t), signal });
      const wM = distance({ lat: bounds.north, lon: bounds.west }, { lat: bounds.north, lon: bounds.east });
      const hM = distance({ lat: bounds.north, lon: bounds.west }, { lat: bounds.south, lon: bounds.west });
      const cs = Math.max(4, Math.sqrt((wM * hM) / MAX_CELLS));
      grid = buildGrid(bounds, data, cs);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      reason = 'Pas de réseau et zone pas encore enregistrée : trajets à vol d’oiseau.';
    }
  }

  // Temps de marche entre chaque paire de points
  let runs = null;
  let cells = null;
  if (grid) {
    cells = nodes.map((p) => cellOf(grid, p));
    runs = [];
    for (let i = 0; i < nodes.length; i++) {
      await pause();
      if (signal?.aborted) throw new DOMException('annulé', 'AbortError');
      runs.push(dijkstra(grid, cells[i], cells.filter((_, j) => j !== i)));
      onProgress?.('calcul', i + 1, nodes.length);
    }
  }
  const cost = (i, j) => {
    const t = runs ? runs[i].time[cells[j]] : Infinity;
    return Number.isFinite(t) ? t : distance(nodes[i], nodes[j]) / OFF_TRAIL;
  };
  const order = solveOrder(cost, k, back);

  // Tracé de chaque étape
  const leg = (i, j) => {
    if (!runs || !Number.isFinite(runs[i].time[cells[j]])) return straightLeg(nodes[i], nodes[j]);
    const path = cellPath(runs[i].prev, cells[i], cells[j]);
    const sm = smoothPath(grid, path);
    const a = latLonOf(grid, cells[i]);
    const b = latLonOf(grid, cells[j]);
    const head = distance(nodes[i], a);
    const tail = distance(b, nodes[j]);
    const segs = [...(head > 1 ? [{ coords: [nodes[i], a], offTrail: true }] : []), ...sm.segs, ...(tail > 1 ? [{ coords: [b, nodes[j]], offTrail: true }] : [])];
    return { legs: segs, distance: sm.distance + head + tail, duration: sm.duration + (head + tail) / OFF_TRAIL };
  };
  const legs = [];
  let from = 0;
  for (const j of order) {
    legs.push({ ...leg(from, j + 1), to: points[j] });
    from = j + 1;
  }
  if (back && order.length) legs.push({ ...leg(from, 0), to: null });
  return {
    order: order.map((j) => points[j]),
    legs,
    distance: legs.reduce((s, l) => s + l.distance, 0),
    duration: legs.reduce((s, l) => s + l.duration, 0),
    offline: !grid || legs.some((l) => l.straight),
    reason,
  };
}

export function fmtDuration(s) {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
