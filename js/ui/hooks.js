// Hooks d'interface : abonnement au magasin, au boîtier, aux préférences, au routeur.
import { useEffect, useReducer, useState } from '../lib.js';
import { store, subscribe } from '../core/store.js';
import { station } from '../sportident/station.js';
import { bus } from '../core/bus.js';
import { getPref, setPref } from '../core/prefs.js';
import { loadSettings, settings } from '../core/settings.js';

/** Re-rend le composant à chaque modification de l'épreuve. */
export function useStore() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => subscribe(force), []);
  return store;
}

export function useStation() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    const evs = ['state', 'card-reading', 'card', 'card-error'];
    evs.forEach((t) => station.addEventListener(t, force));
    return () => evs.forEach((t) => station.removeEventListener(t, force));
  }, []);
  return station;
}

/** Réglages de l'application (circuits, barèmes), chargés à la demande. */
export function useSettings() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    const off = bus.on('settings', force);
    loadSettings();
    return off;
  }, []);
  return settings;
}

export function useBus(type, fn, deps = []) {
  useEffect(() => bus.on(type, fn), deps);
}

export function usePref(key) {
  const [value, setValue] = useState(getPref(key));
  useEffect(() => bus.on('prefs', (p) => setValue(p[key])), [key]);
  return [value, (v) => setPref(key, v)];
}

function parseHash() {
  return location.hash
    .replace(/^#\/?/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}

export function go(path) {
  location.hash = '#/' + path;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
