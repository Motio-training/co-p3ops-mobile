// Accès à l'API du serveur local.

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Le serveur CO - P3OPS ne répond pas. Est-il toujours lancé ?');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

const ev = (id) => `/api/events/${encodeURIComponent(id)}`;

export const api = {
  info: () => request('GET', '/api/info'),
  listEvents: () => request('GET', '/api/events'),
  createEvent: (event) => request('POST', '/api/events', { event }),
  getEvent: (id) => request('GET', ev(id)),
  deleteEvent: (id) => request('DELETE', ev(id)),
  sendOps: (id, client, ops) => request('POST', `${ev(id)}/ops`, { client, ops }),
  backup: (id) => request('POST', `${ev(id)}/sauvegarde`, {}),
  importEvent: (payload) => request('POST', '/api/import', payload),
  quit: () => request('POST', '/api/quitter', {}),
  listCourses: () => request('GET', '/api/circuits'),
  getSettings: () => request('GET', '/api/reglages'),
  putSetting: (key, value) => request('PUT', `/api/reglages/${encodeURIComponent(key)}`, { value }),
};

/** Signal de présence : le serveur s'arrête seul quand plus aucune fenêtre ne l'utilise. */
export function startHeartbeat() {
  const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
  ping();
  setInterval(ping, 20000);
}

/** Flux temps réel des modifications d'une épreuve (Server-Sent Events). */
export function openStream(id, { onMessage, onOpen, onError }) {
  const es = new EventSource(`${ev(id)}/stream`);
  es.onopen = () => onOpen?.();
  es.onerror = () => onError?.();
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  return () => es.close();
}
