// Préférences locales du poste (non partagées entre postes).
import { bus } from './bus.js';

const KEY = 'balise.prefs';
const DEFAULTS = { autoPrint: false, sound: true, showRunning: true, displayInterval: 12 };

let prefs = { ...DEFAULTS };
try {
  prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {}

export function getPref(key) {
  return prefs[key];
}

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  bus.emit('prefs', prefs);
}
