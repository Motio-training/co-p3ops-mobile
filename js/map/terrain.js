// Terrain pour les itinéraires à pied « à travers champs » : données BD TOPO de l'IGN (Géoplateforme,
// service WFS, sans clé) transformées en une grille de vitesses de marche, puis recherche du trajet le
// plus rapide sur cette grille. On peut couper un champ ou traverser un sous-bois clair ; on contourne
// l'eau, les bâtiments, les broussailles, les haies et les escarpements ; routes et chemins sont rapides.
// Les données sont gardées dans l'appareil : une fois la zone vue (ou enregistrée), plus besoin de réseau.
import { TILE, distance, project, unproject } from './geo.js';

const WFS = 'https://data.geopf.fr/wfs/ows';
const CACHE = 'p3ops-terrain-v1';
export const TERRAIN_Z = 14; // découpage des téléchargements (carrés d'environ 1,7 × 1,7 km)

// Couches utiles et attributs demandés (le reste n'est pas téléchargé)
const LAYERS = {
  vegetation: ['BDTOPO_V3:zone_de_vegetation', 'nature'],
  route: ['BDTOPO_V3:troncon_de_route', 'nature,acces_pieton,position_par_rapport_au_sol'],
  eau: ['BDTOPO_V3:surface_hydrographique', 'nature,persistance,position_par_rapport_au_sol'],
  cours: ['BDTOPO_V3:troncon_hydrographique', 'nature,persistance,position_par_rapport_au_sol,fictif'],
  bati: ['BDTOPO_V3:batiment', 'nature'],
  haie: ['BDTOPO_V3:haie', 'largeur'],
  relief: ['BDTOPO_V3:ligne_orographique', 'nature'],
  rail: ['BDTOPO_V3:troncon_de_voie_ferree', 'nature,position_par_rapport_au_sol'],
  // Cadastre : une parcelle bâtie (maison et jardin) est une propriété close, contournée
  parcelle: ['CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle', 'contenance', 'geom'],
};
// Couches indispensables : sans elles, pas d'itinéraire à travers champs (on ne traverserait pas une maison)
const REQUIRED = new Set(['route', 'eau', 'bati']);

// Vitesses de marche (m/s). 0 = infranchissable.
export const SPEED = {
  ouvert: 1.0, // champ, prairie, friche : on coupe tout droit
  chemin: 1.3,
  sentier: 1.2,
  route: 1.35,
  vegetation: {
    'Forêt ouverte': 0.8,
    Bois: 0.65,
    'Forêt fermée de feuillus': 0.6,
    'Forêt fermée mixte': 0.55,
    'Forêt fermée de conifères': 0.5,
    Peupleraie: 0.8,
    Verger: 0.85,
    Vigne: 0.55,
    'Lande ligneuse': 0.35, // broussailles
    Haie: 0.12,
  },
  vegetationAutre: 0.6,
  haie: 0.12,
  cours: 0.25, // ruisseau à franchir
  coursIntermittent: 0.5,
  eauIntermittente: 0.3,
  talus: 0.3,
  rail: 0.05,
  prive: 0.03, // propriété close (parcelle bâtie) : traversée seulement si le poste s'y trouve
  priveMaxM2: 15000, // au-delà (ferme, terrain militaire, grand domaine…), seuls les bâtiments sont évités
};

const keyOf = (x, y) => `${x}/${y}`;

/** Bornes (lat/lon) d'un carré de découpage. */
function tileBounds(x, y) {
  const nw = unproject(x * TILE, y * TILE, TERRAIN_Z);
  const se = unproject((x + 1) * TILE, (y + 1) * TILE, TERRAIN_Z);
  return { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
}

/** Carrés de découpage couvrant des bornes. */
export function terrainTiles(b) {
  const a = project(b.north, b.west, TERRAIN_Z);
  const c = project(b.south, b.east, TERRAIN_Z);
  const list = [];
  for (let x = Math.floor(a.x / TILE); x <= Math.floor(c.x / TILE); x++)
    for (let y = Math.floor(a.y / TILE); y <= Math.floor(c.y / TILE); y++) list.push({ x, y });
  return list;
}

function wfsUrl(layer, props, b, start = 0, geom = 'geometrie') {
  return (
    `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${layer}&SRSNAME=EPSG:4326` +
    `&BBOX=${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)},urn:ogc:def:crs:EPSG::4326` +
    `&OUTPUTFORMAT=application/json&COUNT=5000&STARTINDEX=${start}&PROPERTYNAME=${props},${geom}`
  );
}

async function cachedJson(url, signal) {
  const cache = 'caches' in self ? await caches.open(CACHE).catch(() => null) : null;
  let res = cache ? await cache.match(url).catch(() => null) : null;
  if (!res) {
    res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`terrain ${res.status}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
  }
  return res.json();
}

const memo = new Map(); // carré → données (pendant la session)

/** Données d'un carré : { couche: [objets GeoJSON] }. */
async function loadTile(x, y, signal) {
  const k = keyOf(x, y);
  if (memo.has(k)) return memo.get(k);
  const b = tileBounds(x, y);
  const out = {};
  let complete = true;
  for (const [name, [layer, props, geom]] of Object.entries(LAYERS)) {
    out[name] = [];
    try {
      for (let start = 0, page = 0; page < 6; page++, start += 5000) {
        const d = await cachedJson(wfsUrl(layer, props, b, start, geom), signal);
        for (const f of d.features || []) out[name].push(f);
        if ((d.features || []).length < 5000) break;
      }
    } catch (e) {
      if (e.name === 'AbortError' || REQUIRED.has(name)) throw e;
      out[name] = []; // couche secondaire indisponible : on continue sans elle
      complete = false;
    }
  }
  if (!complete) return out; // pas gardé en mémoire : nouvel essai au prochain calcul
  memo.set(k, out);
  return out;
}

/** Télécharge (ou relit dans l'appareil) le terrain des bornes. onProgress(fait, total). */
export async function loadTerrain(bounds, { onProgress, signal } = {}) {
  const tiles = terrainTiles(bounds);
  const data = Object.fromEntries(Object.keys(LAYERS).map((k) => [k, []]));
  let done = 0;
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      const d = await loadTile(t.x, t.y, signal);
      for (const k of Object.keys(data)) for (const f of d[k]) data[k].push(f);
      onProgress?.(++done, tiles.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return data;
}

/** Enregistre le terrain d'une zone pour le hors ligne (bouton « Enregistrer la zone »). */
export async function saveTerrain(bounds, onProgress, signal) {
  let errors = 0;
  const tiles = terrainTiles(bounds);
  let done = 0;
  for (const t of tiles) {
    if (signal?.aborted) break;
    try {
      await loadTile(t.x, t.y, signal);
    } catch {
      errors++;
    }
    onProgress?.(++done, tiles.length);
  }
  return { done, errors };
}

// --- Grille des vitesses ---------------------------------------------------------------------------------
/**
 * Grille couvrant `bounds` (cellules carrées de `cs` mètres).
 * speed : vitesse de marche par cellule (m/s, 0 = infranchissable) ; road : 1 sur route ou chemin.
 */
export function buildGrid(bounds, data, cs) {
  const lat0 = bounds.north;
  const lon0 = bounds.west;
  const mLat = 111320;
  const mLon = 111320 * Math.cos((((bounds.north + bounds.south) / 2) * Math.PI) / 180);
  const w = Math.max(2, Math.ceil(((bounds.east - bounds.west) * mLon) / cs));
  const h = Math.max(2, Math.ceil(((bounds.north - bounds.south) * mLat) / cs));
  const speed = new Float32Array(w * h).fill(SPEED.ouvert);
  const road = new Uint8Array(w * h);
  const gx = (lon) => ((lon - lon0) * mLon) / cs;
  const gy = (lat) => ((lat0 - lat) * mLat) / cs;

  const polygons = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);
  const lines = (geom) => (geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : []);

  // Cellules d'un polygone (règle pair-impair : les trous sont respectés)
  const fillCells = (rings, fn) => {
    const pts = rings.map((r) => r.map(([lon, lat]) => [gx(lon), gy(lat)]));
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const r of pts) for (const [, y] of r) (yMin = Math.min(yMin, y)), (yMax = Math.max(yMax, y));
    const y0 = Math.max(0, Math.floor(yMin));
    const y1 = Math.min(h - 1, Math.ceil(yMax));
    for (let row = y0; row <= y1; row++) {
      const yc = row + 0.5;
      const xs = [];
      for (const r of pts)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i];
          const [xj, yj] = r[j];
          if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - 0.5));
        const b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let col = a; col <= b; col++) fn(row * w + col);
      }
    }
  };
  const fill = (rings, value) =>
    fillCells(rings, (i) => {
      speed[i] = value;
    });

  // Tracé d'une ligne épaisse (largeur en cellules)
  const stroke = (coords, value, width = 1, isRoad = false) => {
    const r = Math.max(0, (width - 1) / 2);
    for (let i = 1; i < coords.length; i++) {
      const x1 = gx(coords[i - 1][0]);
      const y1 = gy(coords[i - 1][1]);
      const x2 = gx(coords[i][0]);
      const y2 = gy(coords[i][1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
      for (let s = 0; s <= steps; s++) {
        const x = x1 + ((x2 - x1) * s) / steps;
        const y = y1 + ((y2 - y1) * s) / steps;
        for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
          for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            if (dx * dx + dy * dy > r * r + 0.5) continue;
            const c = Math.floor(x) + dx;
            const rr = Math.floor(y) + dy;
            if (c < 0 || rr < 0 || c >= w || rr >= h) continue;
            speed[rr * w + c] = value;
            if (isRoad) road[rr * w + c] = 1;
          }
      }
    }
  };
  const cells = (m) => Math.max(1, Math.round(m / cs));
  const underground = (f) => String(f.properties?.position_par_rapport_au_sol ?? '0').startsWith('-');

  // 1. Végétation (de la plus rapide à la plus lente : la plus contraignante l'emporte)
  const veg = data.vegetation
    .map((f) => ({ f, v: SPEED.vegetation[f.properties?.nature] ?? SPEED.vegetationAutre }))
    .sort((a, b) => b.v - a.v);
  for (const { f, v } of veg) if (f.geometry) for (const p of polygons(f.geometry)) fill(p, v);
  // 2. Haies, talus et escarpements, ruisseaux
  for (const f of data.haie) if (f.geometry) for (const l of lines(f.geometry)) stroke(l, SPEED.haie, cells(Math.max(2, Number(f.properties?.largeur) || 2)));
  for (const f of data.relief) {
    if (!f.geometry) continue;
    const n = String(f.properties?.nature || '');
    const v = /escarpement|mur|falaise/i.test(n) ? 0 : SPEED.talus;
    for (const l of lines(f.geometry)) stroke(l, v, 1);
  }
  for (const f of data.cours) {
    const p = f.properties || {};
    if (!f.geometry || underground(f) || p.fictif === true || /aqueduc|conduit/i.test(p.nature || '')) continue;
    const v = /intermittent/i.test(p.persistance || '') ? SPEED.coursIntermittent : SPEED.cours;
    for (const l of lines(f.geometry)) stroke(l, v, 1);
  }
  // 3. Eau, bâtiments, voies ferrées
  for (const f of data.eau) {
    if (!f.geometry || underground(f)) continue;
    const v = /intermittent/i.test(f.properties?.persistance || '') ? SPEED.eauIntermittente : 0;
    for (const p of polygons(f.geometry)) fill(p, v);
  }
  const built = new Uint8Array(w * h);
  for (const f of data.bati)
    if (f.geometry)
      for (const p of polygons(f.geometry))
        fillCells(p, (i) => {
          speed[i] = 0;
          built[i] = 1;
        });
  // Parcelles bâties (maisons avec jardin, cours…) : propriétés closes, contournées par les rues
  for (const f of data.parcelle || []) {
    if (!f.geometry || !(Number(f.properties?.contenance) <= SPEED.priveMaxM2)) continue;
    const list = [];
    let hasBuilding = false;
    for (const p of polygons(f.geometry))
      fillCells(p, (i) => {
        list.push(i);
        if (built[i]) hasBuilding = true;
      });
    if (hasBuilding) for (const i of list) if (speed[i] > SPEED.prive) speed[i] = SPEED.prive;
  }
  for (const f of data.rail) if (f.geometry && !underground(f)) for (const l of lines(f.geometry)) stroke(l, SPEED.rail, cells(4));
  // 4. Routes et chemins (en dernier : ponts, passages). Autoroutes : infranchissables, sauf ponts.
  const roads = data.route.filter((f) => f.geometry && !underground(f));
  const nature = (f) => String(f.properties?.nature || '');
  const forbidden = (f) => /autorout|bretelle/i.test(nature(f)) || /interdit/i.test(f.properties?.acces_pieton || '');
  for (const f of roads) if (forbidden(f)) for (const l of lines(f.geometry)) stroke(l, 0, cells(12));
  for (const f of roads) {
    if (forbidden(f)) continue;
    const n = nature(f);
    const v = /sentier|escalier/i.test(n) ? SPEED.sentier : /chemin|empierr|piste/i.test(n) ? SPEED.chemin : SPEED.route;
    const width = /route|rond/i.test(n) ? cells(6) : 1;
    for (const l of lines(f.geometry)) stroke(l, v, width, true);
  }
  return { w, h, cs, speed, road, private: null, lat0, lon0, mLat, mLon };
}

export const cellOf = (g, p) => {
  const x = Math.min(g.w - 1, Math.max(0, Math.floor(((p.lon - g.lon0) * g.mLon) / g.cs)));
  const y = Math.min(g.h - 1, Math.max(0, Math.floor(((g.lat0 - p.lat) * g.mLat) / g.cs)));
  return y * g.w + x;
};
export const latLonOf = (g, i) => {
  const x = (i % g.w) + 0.5;
  const y = Math.floor(i / g.w) + 0.5;
  return { lat: g.lat0 - (y * g.cs) / g.mLat, lon: g.lon0 + (x * g.cs) / g.mLon };
};

// --- Recherche du trajet le plus rapide (Dijkstra sur 8 voisins) ------------------------------------------
class Heap {
  constructor(n) {
    this.k = new Float64Array(n);
    this.v = new Int32Array(n);
    this.size = 0;
  }
  push(key, val) {
    if (this.size >= this.k.length) {
      const k = new Float64Array(this.k.length * 2);
      k.set(this.k);
      const v = new Int32Array(this.v.length * 2);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  pop() {
    const topV = this.v[0];
    const topK = this.k[0];
    const lastK = this.k[--this.size];
    const lastV = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= lastK) break;
      this.k[i] = this.k[c];
      this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = lastK;
    this.v[i] = lastV;
    this.lastKey = topK;
    return topV;
  }
}

const NB = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Temps de marche (s) depuis la cellule `src` vers toutes les cellules, en s'arrêtant quand toutes les
 * `targets` sont atteintes. Renvoie { time: Float32Array, prev: Int32Array }.
 */
export function dijkstra(g, src, targets = []) {
  const n = g.w * g.h;
  const time = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const want = new Set(targets);
  const heap = new Heap(1 << 16);
  time[src] = 0;
  heap.push(0, src);
  const sp = g.speed;
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (want.delete(i) && !want.size && targets.length) break;
    const x = i % g.w;
    const y = (i - x) / g.w;
    const si = sp[i] || 0.05; // départ ou arrivée dans une cellule infranchissable : on en sort quand même
    for (const [dx, dy, d] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const j = ny * g.w + nx;
      if (done[j]) continue;
      let sj = sp[j];
      if (!sj) {
        if (!want.has(j)) continue;
        sj = 0.05;
      }
      // en diagonale, on ne passe pas « entre » deux cellules infranchissables
      if (d > 1 && (!sp[y * g.w + nx] || !sp[ny * g.w + x])) continue;
      const t = time[i] + d * g.cs * 0.5 * (1 / si + 1 / sj);
      if (t < time[j]) {
        time[j] = t;
        prev[j] = i;
        heap.push(t, j);
      }
    }
  }
  return { time, prev };
}

/** Chemin de cellules de src vers dst (d'après prev). */
export function cellPath(prev, src, dst) {
  const path = [];
  for (let i = dst; i !== -1 && path.length < 1e6; i = prev[i]) {
    path.push(i);
    if (i === src) break;
  }
  return path.reverse();
}

/** Temps (s) et part sur route d'un segment droit entre deux cellules (null si infranchissable). */
function segmentCost(g, a, b, real = false) {
  const ax = (a % g.w) + 0.5;
  const ay = Math.floor(a / g.w) + 0.5;
  const bx = (b % g.w) + 0.5;
  const by = Math.floor(b / g.w) + 0.5;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len * 2));
  let t = 0;
  let onRoad = 0;
  for (let s = 0; s < steps; s++) {
    const x = Math.floor(ax + ((bx - ax) * (s + 0.5)) / steps);
    const y = Math.floor(ay + ((by - ay) * (s + 0.5)) / steps);
    const i = y * g.w + x;
    let v = g.speed[i];
    if (!v && i !== a && i !== b) return null;
    // durée affichée : l'accès inévitable à un poste situé dans une propriété se fait à pied normalement
    if (real && v > 0 && v <= SPEED.prive) v = SPEED.ouvert;
    t += (len * g.cs) / steps / (v || 0.05);
    onRoad += g.road[i];
  }
  return { t, road: onRoad / steps };
}

/**
 * Lissage : remplace les marches d'escalier de la grille par des lignes droites quand c'est aussi rapide.
 * Renvoie des tronçons [{ coords, offTrail }] avec la distance et la durée.
 */
export function smoothPath(g, path) {
  if (path.length < 2) return { segs: [], distance: 0, duration: 0 };
  const keep = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    let acc = 0;
    // temps le long du chemin de la grille
    const along = [0];
    for (let j = i + 1; j < path.length && j <= i + 120; j++) {
      const c = segmentCost(g, path[j - 1], path[j]);
      acc += c ? c.t : 1e9;
      along.push(acc);
    }
    for (let j = Math.min(path.length - 1, i + 120); j > i + 1; j--) {
      const c = segmentCost(g, path[i], path[j]);
      if (c && c.t <= along[j - i] * 1.03 + 0.5) {
        best = j;
        break;
      }
    }
    keep.push(path[best]);
    i = best;
  }
  const segs = [];
  let distance = 0;
  let duration = 0;
  for (let k = 1; k < keep.length; k++) {
    const c = segmentCost(g, keep[k - 1], keep[k], true) || { t: 0, road: 0 };
    const a = latLonOf(g, keep[k - 1]);
    const b = latLonOf(g, keep[k]);
    const off = c.road < 0.6;
    const last = segs[segs.length - 1];
    if (last && last.offTrail === off) last.coords.push(b);
    else segs.push({ coords: [a, b], offTrail: off });
    distance += Math.hypot((b.lat - a.lat) * g.mLat, (b.lon - a.lon) * g.mLon);
    duration += c.t;
  }
  return { segs, distance, duration };
}

/** Bornes englobant des points, avec une marge (m). */
export function boundsAround(points, marginM) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const dLat = marginM / 111320;
  const dLon = marginM / (111320 * Math.cos(((lats[0] || 0) * Math.PI) / 180));
  return { north: Math.max(...lats) + dLat, south: Math.min(...lats) - dLat, west: Math.min(...lons) - dLon, east: Math.max(...lons) + dLon };
}

export function spanM(b) {
  return distance({ lat: b.north, lon: b.west }, { lat: b.south, lon: b.east });
}
