// CO - P3OPS Mobile : le « serveur » tourne dans le navigateur du téléphone.
//
// La version PC dialogue avec serveur.py par des requêtes /api/… et un flux temps réel (EventSource).
// Ici, ces requêtes sont interceptées et traitées sur place, avec un stockage dans le téléphone
// (IndexedDB). L'interface est donc exactement la même que sur PC, sans ordinateur.
import { buildXlsx } from './xlsx.js';

const KINDS = ['course', 'class', 'competitor', 'card'];
const SETTING_KEYS = ['circuits', 'baremes', 'balises'];
const DB_NAME = 'co-p3ops-mobile';

// --- Stockage (IndexedDB) ------------------------------------------------------------------------
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Stockage du téléphone indisponible.'));
    });
    // Demande au navigateur de ne pas effacer ces données quand le téléphone manque de place.
    navigator.storage?.persist?.().catch(() => {});
  }
  return dbPromise;
}

/** Exécute fn(store) dans une transaction ; renvoie ce que fn renvoie, une fois la transaction terminée. */
async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const st = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(st))
      .then((r) => (result = r))
      .catch((e) => {
        try {
          t.abort();
        } catch {}
        reject(e);
      });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Enregistrement annulé.'));
  });
}

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const now = () => Date.now() / 1000;
const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 12);

function emptyDocs() {
  return Object.fromEntries(KINDS.map((k) => [k, {}]));
}

function publicEvent(rec) {
  return { ...rec.data, id: rec.id };
}

function docsAsLists(rec) {
  return Object.fromEntries(KINDS.map((k) => [k, Object.values(rec.docs?.[k] || {})]));
}

async function listEvents() {
  const all = await tx('events', 'readonly', (st) => req(st.getAll()));
  return all
    .map((rec) => ({
      event: publicEvent(rec),
      rev: rec.rev,
      created: rec.created,
      updated: rec.updated,
      counts: Object.fromEntries(KINDS.map((k) => [k, Object.keys(rec.docs?.[k] || {}).length]).filter(([, n]) => n > 0)),
    }))
    .sort((a, b) => b.updated - a.updated);
}

async function getEvent(id) {
  const rec = await tx('events', 'readonly', (st) => req(st.get(id)));
  return rec ? { event: publicEvent(rec), rev: rec.rev, docs: docsAsLists(rec) } : null;
}

async function createEvent(data, id = null, docs = null) {
  const eid = id || newId();
  const t = now();
  const rec = { id: eid, data: { ...data, id: eid }, rev: 0, created: t, updated: t, docs: emptyDocs() };
  for (const [kind, items] of Object.entries(docs || {})) {
    if (!KINDS.includes(kind) || !Array.isArray(items)) continue;
    for (const d of items) if (d && typeof d === 'object' && d.id) rec.docs[kind][String(d.id)] = d;
  }
  await tx('events', 'readwrite', (st) => req(st.add(rec)));
  return rec.data;
}

async function exists(id) {
  return !!(await tx('events', 'readonly', (st) => req(st.getKey(id))));
}

async function applyOps(eid, ops) {
  return tx('events', 'readwrite', async (st) => {
    const rec = await req(st.get(eid));
    if (!rec) throw notFound();
    for (const op of ops) {
      if (op.kind === 'event') rec.data = op.data;
      else if (op.op === 'put') rec.docs[op.kind][op.id] = op.data;
      else delete rec.docs[op.kind][op.id];
    }
    rec.rev += 1;
    rec.updated = now();
    await req(st.put(rec));
    return rec.rev;
  });
}

async function deleteEvent(eid) {
  await tx('events', 'readwrite', (st) => req(st.delete(eid)));
}

async function listCourses() {
  const all = await tx('events', 'readonly', (st) => req(st.getAll()));
  const out = [];
  for (const rec of all) {
    for (const c of Object.values(rec.docs?.course || {})) {
      if (!c.controls?.length) continue;
      out.push({
        eventId: rec.id,
        eventName: rec.data.name || '',
        eventDate: rec.data.date || '',
        updated: rec.updated,
        course: { name: c.name, length: c.length, climb: c.climb, controls: c.controls },
      });
    }
  }
  return out.sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '') || b.updated - a.updated);
}

async function getSettings() {
  const all = await tx('settings', 'readonly', (st) => req(st.getAll()));
  return Object.fromEntries(all.map((r) => [r.key, r.data]));
}

async function putSetting(key, value) {
  await tx('settings', 'readwrite', (st) => req(st.put({ key, data: value, updated: now() })));
}

// --- Contrôle des opérations (comme serveur.py) --------------------------------------------------
function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}
function notFound(msg = 'Épreuve introuvable.') {
  return Object.assign(new Error(msg), { status: 404 });
}

function validateOps(eid, ops) {
  if (!Array.isArray(ops) || !ops.length) throw badRequest("Requête invalide : liste d'opérations vide");
  return ops.map((op) => {
    if (!op || typeof op !== 'object') throw badRequest('Requête invalide : opération invalide');
    if (op.kind === 'event') {
      if (op.op !== 'put' || !op.data || typeof op.data !== 'object') throw badRequest("Requête invalide : opération sur l'épreuve invalide");
      return { op: 'put', kind: 'event', id: eid, data: { ...op.data, id: eid } };
    }
    if (!KINDS.includes(op.kind) || !['put', 'del'].includes(op.op)) throw badRequest(`Requête invalide : type inconnu : ${op.kind}/${op.op}`);
    if (typeof op.id !== 'string' || !op.id || op.id.length > 100) throw badRequest('Requête invalide : identifiant invalide');
    if (op.op === 'put') {
      if (!op.data || typeof op.data !== 'object') throw badRequest('Requête invalide : données invalides');
      return { op: 'put', kind: op.kind, id: op.id, data: { ...op.data, id: op.id } };
    }
    return { op: 'del', kind: op.kind, id: op.id };
  });
}

// --- Diffusion en direct (onglets ouverts sur ce téléphone) ---------------------------------------
const subscribers = new Map(); // eid → Set(fn)
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('co-p3ops-mobile') : null;
channel?.addEventListener('message', (e) => deliver(e.data.eid, e.data.msg));

function deliver(eid, msg) {
  for (const fn of subscribers.get(eid) || []) setTimeout(() => fn(msg), 0);
}

function publish(eid, msg) {
  deliver(eid, msg);
  channel?.postMessage({ eid, msg });
}

function subscribe(eid, fn) {
  if (!subscribers.has(eid)) subscribers.set(eid, new Set());
  subscribers.get(eid).add(fn);
  return () => subscribers.get(eid)?.delete(fn);
}

// --- Routes /api/… ---------------------------------------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function handle(method, parts, body) {
  if (parts[0] === 'xlsx' && method === 'POST') {
    const data = buildXlsx(body?.sheets || []);
    return new Response(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), { status: 200 });
  }
  if (parts[0] === 'ping') return json({ ok: true });
  if (parts[0] === 'quitter') return json({ ok: true });
  if (parts[0] === 'info' && method === 'GET') {
    return json({ version: 'mobile', mobile: true, readonly: false, network: false, port: null, addresses: [], dataDir: 'ce téléphone' });
  }
  if (parts[0] === 'circuits' && method === 'GET') return json(await listCourses());
  if (parts[0] === 'reglages') {
    if (parts.length === 1 && method === 'GET') return json(await getSettings());
    if (parts.length === 2 && method === 'PUT') {
      if (!SETTING_KEYS.includes(parts[1])) return json({ error: 'Réglage inconnu.' }, 404);
      if (!Array.isArray(body?.value)) throw badRequest('Requête invalide : liste attendue');
      await putSetting(parts[1], body.value);
      return json({ ok: true });
    }
  }
  if (parts.length === 1 && parts[0] === 'events') {
    if (method === 'GET') return json(await listEvents());
    if (method === 'POST') {
      const ev = body?.event;
      if (!ev || typeof ev !== 'object' || !String(ev.name || '').trim()) return json({ error: "Le nom de l'épreuve est obligatoire." }, 400);
      return json({ event: await createEvent(ev) }, 201);
    }
  }
  if (parts[0] === 'import' && method === 'POST') {
    if (body?.format !== 'balise-epreuve' || !body.event || typeof body.event !== 'object') return json({ error: "Ce fichier n'est pas une épreuve CO - P3OPS." }, 400);
    let eid = String(body.event.id || '');
    if (!/^[\w-]{4,40}$/.test(eid) || (await exists(eid))) eid = null;
    return json({ event: await createEvent({ ...body.event }, eid, body.docs || {}) }, 201);
  }
  if (parts.length >= 2 && parts[0] === 'events') {
    const eid = parts[1];
    const rest = parts.slice(2);
    if (!rest.length && method === 'GET') {
      const data = await getEvent(eid);
      return data ? json(data) : json({ error: 'Épreuve introuvable.' }, 404);
    }
    if (!rest.length && method === 'DELETE') {
      if (!(await exists(eid))) return json({ error: 'Épreuve introuvable.' }, 404);
      await deleteEvent(eid);
      publish(eid, { type: 'deleted' });
      return json({ ok: true });
    }
    if (rest[0] === 'ops' && method === 'POST') {
      const ops = validateOps(eid, body?.ops);
      const rev = await applyOps(eid, ops);
      publish(eid, { type: 'ops', rev, client: String(body?.client || '').slice(0, 64), ops });
      return json({ rev });
    }
    if (rest[0] === 'sauvegarde' && method === 'POST') return json({ file: 'ce téléphone' });
  }
  return json({ error: 'Ressource inconnue.' }, 404);
}

// --- Interception de fetch() -----------------------------------------------------------------------
const realFetch = window.fetch.bind(window);
const APP_BASE = new URL('./', document.baseURI); // dossier de l'application (hébergement dans un sous-dossier possible)

window.fetch = async function (input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const parts = url.pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      return json({ error: 'Requête invalide : JSON illisible' }, 400);
    }
    try {
      return await handle(method, parts, body);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  }
  // Fichiers de l'application demandés avec un chemin absolu (ex. /modeles/…) : relatifs au dossier de l'appli.
  if (url.origin === location.origin && APP_BASE.pathname !== '/' && url.pathname.startsWith('/') && !url.pathname.startsWith(APP_BASE.pathname)) {
    return realFetch(new URL('.' + url.pathname, APP_BASE).href, init);
  }
  return realFetch(input, init);
};

// --- Flux temps réel : EventSource local -------------------------------------------------------------
const NativeEventSource = window.EventSource;

class LocalEventSource extends EventTarget {
  constructor(url) {
    super();
    const m = new URL(url, location.href).pathname.match(/^\/api\/events\/([^/]+)\/stream$/);
    if (!m) return new NativeEventSource(url);
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    const eid = decodeURIComponent(m[1]);
    const send = (msg) => {
      if (this.readyState === 2) return;
      const ev = new MessageEvent('message', { data: JSON.stringify(msg) });
      this.onmessage?.(ev);
      this.dispatchEvent(ev);
    };
    this.unsubscribe = subscribe(eid, send);
    getEvent(eid)
      .then((data) => {
        if (this.readyState === 2) return;
        if (!data) {
          this.readyState = 2;
          this.onerror?.(new Event('error'));
          return;
        }
        this.readyState = 1;
        this.onopen?.(new Event('open'));
        send({ type: 'hello', rev: data.rev });
      })
      .catch(() => this.onerror?.(new Event('error')));
  }

  close() {
    this.readyState = 2;
    this.unsubscribe?.();
  }
}

window.EventSource = LocalEventSource;
