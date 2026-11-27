// Tuiles de fond de carte (Géoplateforme de l'IGN, données ouvertes, sans clé) et mémoire hors ligne.
// Chaque tuile affichée est gardée dans le cache du navigateur : sur le terrain, sans réseau, la carte
// des zones déjà vues (ou enregistrées avec « Enregistrer la zone ») reste disponible.
import { TILE, project } from './geo.js';

export const LAYERS = {
  plan: {
    label: 'Plan IGN',
    layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
    format: 'image/png',
    maxZoom: 19,
    attribution: '© IGN – Plan IGN',
  },
  photo: {
    label: 'Photo aérienne',
    layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
    format: 'image/jpeg',
    maxZoom: 19,
    attribution: '© IGN – Photographies aériennes',
  },
};

const CACHE = 'p3ops-carte-v1';
const MAX_LIVE = 400; // images gardées prêtes en mémoire
const live = new Map(); // clé → { url (objet), state: 'ok' | 'loading' | 'error' }
const listeners = new Set();

export function tileUrl(layerId, z, x, y) {
  const L = LAYERS[layerId];
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${L.layer}&STYLE=normal&FORMAT=${encodeURIComponent(L.format)}&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
}

export const tileKey = (layerId, z, x, y) => `${layerId}/${z}/${x}/${y}`;

export function onTiles(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let notifyPending = false;
function notify() {
  if (notifyPending) return;
  notifyPending = true;
  requestAnimationFrame(() => {
    notifyPending = false;
    for (const fn of listeners) fn();
  });
}

function openCache() {
  return 'caches' in self ? caches.open(CACHE).catch(() => null) : Promise.resolve(null);
}

async function fetchTile(layerId, z, x, y, { store = true } = {}) {
  const url = tileUrl(layerId, z, x, y);
  const cache = await openCache();
  let res = cache ? await cache.match(url).catch(() => null) : null;
  if (!res) {
    res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`tuile ${res.status}`);
    if (cache && store) await cache.put(url, res.clone()).catch(() => {});
  }
  return res.blob();
}

/** Tuile prête à afficher (URL d'objet), ou null si elle est en cours de chargement / indisponible. */
export function getTile(layerId, z, x, y) {
  const key = tileKey(layerId, z, x, y);
  const t = live.get(key);
  if (t) {
    live.delete(key); // plus récemment utilisée
    live.set(key, t);
    return t;
  }
  const entry = { state: 'loading', url: null };
  live.set(key, entry);
  fetchTile(layerId, z, x, y)
    .then((blob) => {
      entry.url = URL.createObjectURL(blob);
      entry.state = 'ok';
    })
    .catch(() => {
      entry.state = 'error';
      setTimeout(() => live.get(key) === entry && live.delete(key), 15000); // nouvel essai plus tard
    })
    .finally(notify);
  while (live.size > MAX_LIVE) {
    const [k, old] = live.entries().next().value;
    if (old.url) URL.revokeObjectURL(old.url);
    live.delete(k);
  }
  return entry;
}

/** Tuile déjà prête en mémoire (sans lancer de chargement). */
export function peekTile(layerId, z, x, y) {
  const t = live.get(tileKey(layerId, z, x, y));
  return t && t.state === 'ok' ? t : null;
}

/** Tuiles de la zone (bornes en lat/lon) pour les niveaux zMin..zMax. */
export function tilesInArea(bounds, zMin, zMax) {
  const list = [];
  for (let z = zMin; z <= zMax; z++) {
    const a = project(bounds.north, bounds.west, z);
    const b = project(bounds.south, bounds.east, z);
    for (let x = Math.floor(a.x / TILE); x <= Math.floor(b.x / TILE); x++)
      for (let y = Math.floor(a.y / TILE); y <= Math.floor(b.y / TILE); y++) list.push({ z, x, y });
  }
  return list;
}

/** Enregistre une zone pour l'utiliser sans réseau. onProgress(fait, total, erreurs). */
export async function downloadArea(layerId, tiles, onProgress, signal) {
  let done = 0;
  let errors = 0;
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const t = queue.shift();
      try {
        await fetchTile(layerId, t.z, t.x, t.y);
      } catch {
        errors++;
      }
      done++;
      onProgress?.(done, tiles.length, errors);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { done, errors };
}

/** Nombre de tuiles déjà gardées pour le hors ligne. */
export async function cachedCount() {
  const cache = await openCache();
  if (!cache) return null;
  return (await cache.keys()).length;
}
