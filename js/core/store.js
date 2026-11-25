// État de l'épreuve ouverte, synchronisé en temps réel avec le serveur.
//
// Chaque modification est appliquée localement tout de suite (interface réactive),
// puis envoyée au serveur. Les modifications faites depuis un autre onglet ou un
// autre poste arrivent par le flux temps réel.
import { api, openStream } from './api.js';
import { bus, toast } from './bus.js';
import { uid } from './util.js';
import { computeAll } from '../domain/results.js';

export const CLIENT_ID = uid();
export const KINDS = { course: 'courses', class: 'classes', competitor: 'competitors', card: 'cards' };

export const store = {
  eventId: null,
  event: null,
  rev: 0,
  version: 0,
  status: 'idle', // idle | loading | ready | error
  error: null,
  live: false,
  readonly: false,
  courses: new Map(),
  classes: new Map(),
  competitors: new Map(),
  cards: new Map(),
};

const listeners = new Set();
let scheduled = false;
let closeStream = null;
let sendChain = Promise.resolve();
let refetching = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  store.version++;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const fn of [...listeners]) fn();
  });
}

let derivedCache = { version: -1, value: null };
/** Résultats calculés (mis en cache tant que l'état ne change pas). */
export function getDerived() {
  if (derivedCache.version !== store.version) derivedCache = { version: store.version, value: computeAll(store) };
  return derivedCache.value;
}

function load(data) {
  store.event = data.event;
  store.rev = data.rev;
  for (const [kind, key] of Object.entries(KINDS)) {
    const m = new Map();
    for (const d of data.docs?.[kind] || []) m.set(d.id, d);
    store[key] = m;
  }
}

export async function initInfo() {
  try {
    const info = await api.info();
    store.readonly = !!info.readonly;
    store.serverInfo = info;
  } catch {}
}

export async function openEvent(id) {
  if (store.eventId === id && (store.status === 'ready' || store.status === 'loading')) return;
  closeEvent();
  store.eventId = id;
  store.status = 'loading';
  notify();
  try {
    const data = await api.getEvent(id);
    if (store.eventId !== id) return;
    load(data);
    store.status = 'ready';
    store.error = null;
    closeStream = openStream(id, {
      onMessage: onRemote,
      onOpen: () => {
        store.live = true;
        notify();
      },
      onError: () => {
        store.live = false;
        notify();
      },
    });
  } catch (e) {
    if (store.eventId !== id) return;
    store.status = 'error';
    store.error = e.message;
  }
  notify();
}

export function closeEvent() {
  closeStream?.();
  closeStream = null;
  store.eventId = null;
  store.event = null;
  store.status = 'idle';
  store.live = false;
  for (const key of Object.values(KINDS)) store[key] = new Map();
  notify();
}

async function refetch() {
  if (refetching || !store.eventId) return;
  refetching = true;
  const id = store.eventId;
  try {
    await sendChain;
    const data = await api.getEvent(id);
    if (store.eventId === id) {
      load(data);
      notify();
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    refetching = false;
  }
}

function onRemote(msg) {
  if (msg.type === 'hello') {
    if (msg.rev !== store.rev) refetch();
    return;
  }
  if (msg.type === 'deleted') {
    store.status = 'error';
    store.error = 'Cette épreuve a été supprimée.';
    notify();
    return;
  }
  if (msg.type !== 'ops') return;
  if (msg.rev <= store.rev) return;
  if (msg.rev > store.rev + 1) {
    refetch();
    return;
  }
  store.rev = msg.rev;
  if (msg.client !== CLIENT_ID) {
    applyOps(msg.ops);
    bus.emit('remote-ops', msg.ops);
  }
  notify();
}

function applyOps(ops) {
  for (const op of ops) {
    if (op.kind === 'event') {
      if (op.op === 'put') store.event = { ...op.data, id: store.eventId };
      continue;
    }
    const map = store[KINDS[op.kind]];
    if (!map) continue;
    if (op.op === 'put') map.set(op.id, op.data);
    else if (op.op === 'del') map.delete(op.id);
  }
}

/** Applique un lot de modifications (localement puis sur le serveur). */
export function mutate(ops) {
  if (!store.eventId || !ops.length) return Promise.resolve();
  if (store.readonly) {
    toast('Ce poste est en consultation seule.', 'warning');
    return Promise.resolve();
  }
  applyOps(ops);
  notify();
  const id = store.eventId;
  sendChain = sendChain
    .then(() => api.sendOps(id, CLIENT_ID, ops))
    .catch((err) => {
      toast(`Enregistrement impossible : ${err.message}`, 'error');
      refetch();
    });
  return sendChain;
}

export const putOp = (kind, doc) => ({ op: 'put', kind, id: doc.id, data: doc });
export const delOp = (kind, id) => ({ op: 'del', kind, id });

export function put(kind, doc) {
  return mutate([putOp(kind, doc)]);
}

export function putMany(kind, docs) {
  return mutate(docs.map((d) => putOp(kind, d)));
}

export function remove(kind, id) {
  return mutate([delOp(kind, id)]);
}

export function updateEvent(patch) {
  return mutate([{ op: 'put', kind: 'event', id: store.eventId, data: { ...store.event, ...patch } }]);
}

export const list = (key) => [...store[key].values()];
