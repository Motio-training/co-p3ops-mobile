// Itinéraires à pied entre la position GPS et les postes, « à travers champs » : on suit routes et chemins
// quand c'est plus rapide, sinon on coupe à travers champs ou sous-bois praticables (voir terrain.js).
// Plusieurs postes : temps de marche entre chaque paire de points, puis ordre de passage le plus rapide
// (calcul exact jusqu'à 10 postes, au-delà ordre approché).
// Jamais de trajet infranchissable : sans données de terrain (zone trop grande, ou pas de réseau et zone
// jamais enregistrée), on suit le réseau de routes et chemins de l'IGN ; si c'est impossible aussi, aucun
// tracé (seulement la distance et la direction).
import { distance } from './geo.js';
import { boundsAround, buildGrid, cellOf, cellPath, dijkstra, latLonOf, loadTerrain, smoothPath, spanM } from './terrain.js';

const MAX_SPAN = 9000; // m : au-delà, zone trop grande pour un calcul à travers champs
const MAX_CELLS = 450000;
const OFF_TRAIL = 0.8; // m/s pour les trajets à vol d'oiseau

const pause = () => new Promise((r) => setTimeout(r, 0));

/** Étape sans tracé possible : on garde seulement la distance (pour l'ordre de passage). */
function noLeg(a, b) {
  const d = distance(a, b);
  return { legs: [], distance: d, duration: d / OFF_TRAIL, none: true };
}

// Secours : itinéraire piéton sur routes et chemins (service d'itinéraire de la Géoplateforme de l'IGN)
const SERVICE = 'https://data.geopf.fr/navigation/itineraire';
const netCache = new Map();
async function networkLeg(a, b, signal) {
  const k = `${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
  if (netCache.has(k)) return netCache.get(k);
  try {
    const url =
      `${SERVICE}?resource=bdtopo-osrm&profile=pedestrian&optimization=shortest` +
      `&start=${a.lon.toFixed(6)},${a.lat.toFixed(6)}&end=${b.lon.toFixed(6)},${b.lat.toFixed(6)}` +
      '&geometryFormat=geojson&getSteps=false&distanceUnit=meter&timeUnit=second';
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    const line = (d.geometry?.coordinates || []).map(([lon, lat]) => ({ lat, lon }));
    if (line.length < 2) throw new Error('vide');
    const s = line[0];
    const e = line[line.length - 1];
    const head = distance(a, s);
    const tail = distance(e, b);
    const r = {
      legs: [...(head > 3 ? [{ coords: [a, s], offTrail: true }] : []), { coords: line, offTrail: false }, ...(tail > 3 ? [{ coords: [e, b], offTrail: true }] : [])],
      distance: (d.distance ?? 0) + head + tail,
      duration: (d.duration ?? (d.distance ?? 0) / 1.25) + (head + tail) / OFF_TRAIL,
      network: true,
    };
    netCache.set(k, r);
    return r;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
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
  if (spanM(bounds) > MAX_SPAN) reason = 'Postes trop éloignés pour un itinéraire à travers champs : itinéraire par les routes et chemins.';
  else {
    try {
      const data = await loadTerrain(bounds, { onProgress: (d, t) => onProgress?.('terrain', d, t), signal });
      const wM = distance({ lat: bounds.north, lon: bounds.west }, { lat: bounds.north, lon: bounds.east });
      const hM = distance({ lat: bounds.north, lon: bounds.west }, { lat: bounds.south, lon: bounds.west });
      const cs = Math.max(4, Math.sqrt((wM * hM) / MAX_CELLS));
      grid = buildGrid(bounds, data, cs);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      reason = 'Terrain de la zone indisponible (pas de réseau et zone pas enregistrée) : itinéraire par les routes et chemins.';
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
  // Paires sans trajet sur la grille : réseau de routes et chemins de l'IGN
  const net = new Map();
  const missing = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || (runs && Number.isFinite(runs[i].time[cells[j]]))) continue;
      if (i < j) missing.push([i, j]);
    }
  if (missing.length && missing.length <= 45) {
    let done = 0;
    const queue = [...missing];
    const worker = async () => {
      while (queue.length) {
        const [i, j] = queue.shift();
        const r = await networkLeg(nodes[i], nodes[j], signal);
        net.set(`${i}>${j}`, r);
        onProgress?.('reseau', ++done, missing.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  const netLeg = (i, j) => {
    const r = net.get(`${i}>${j}`);
    if (r) return r;
    const rev = net.get(`${j}>${i}`);
    return rev ? { ...rev, legs: [...rev.legs].reverse().map((l) => ({ ...l, coords: [...l.coords].reverse() })) } : null;
  };
  const cost = (i, j) => {
    const t = runs ? runs[i].time[cells[j]] : Infinity;
    if (Number.isFinite(t)) return t;
    const r = netLeg(i, j);
    return r ? r.duration : distance(nodes[i], nodes[j]) / OFF_TRAIL;
  };
  const order = solveOrder(cost, k, back);

  // Tracé de chaque étape
  const leg = (i, j) => {
    if (!runs || !Number.isFinite(runs[i].time[cells[j]])) return netLeg(i, j) || noLeg(nodes[i], nodes[j]);
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
    offline: legs.some((l) => l.none),
    network: legs.some((l) => l.network),
    reason,
  };
}

export function fmtDuration(s) {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
