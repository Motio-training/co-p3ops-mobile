// Heures et durées. Les heures sont stockées en secondes depuis minuit.
export const DAY = 86400;
export const HALF_DAY = 43200;

const pad = (n) => String(n).padStart(2, '0');

export function fmtClock(s) {
  if (s == null || !Number.isFinite(s)) return '';
  let t = Math.round(s);
  t = ((t % DAY) + DAY) % DAY;
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

export function fmtClockShort(s) {
  return fmtClock(s).slice(0, 5);
}

export function fmtDuration(s) {
  if (s == null || !Number.isFinite(s)) return '';
  const neg = s < 0;
  let t = Math.abs(Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const str = h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  return (neg ? '-' : '') + str;
}

export function fmtBehind(s) {
  if (s == null || s <= 0) return '';
  return '+' + fmtDuration(s);
}

/**
 * Lit une heure saisie : « 10:30 », « 10:30:15 », « 10h30 », « 1030 », « 103015 ».
 * Renvoie null si vide, NaN si invalide.
 */
export function parseClock(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  let parts;
  if (/^\d{3,6}$/.test(s)) {
    const p = s.length <= 4 ? s.padStart(4, '0') : s.padStart(6, '0');
    parts = p.length === 4 ? [p.slice(0, 2), p.slice(2)] : [p.slice(0, 2), p.slice(2, 4), p.slice(4)];
  } else {
    parts = s.split(/[:h.,\s]+/i).filter(Boolean);
  }
  if (parts.length === 1 && /^\d{1,2}$/.test(parts[0])) parts.push('0');
  if (parts.length < 2 || parts.length > 3) return NaN;
  const [h, m, sec = 0] = parts.map(Number);
  if (![h, m, sec].every(Number.isInteger)) return NaN;
  if (h > 47 || m > 59 || sec > 59 || h < 0 || m < 0 || sec < 0) return NaN;
  return h * 3600 + m * 60 + sec;
}

/** Durée « mm:ss » ou « h:mm:ss » → secondes. */
export function parseDuration(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (!parts.every((x) => Number.isInteger(x) && x >= 0)) return NaN;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

export function nowClock() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** Ramène une heure 12 h (SI-Card 5) sur la journée, en la plaçant après l'heure zéro. */
export function resolve12h(t, zeroTime) {
  if (t == null) return null;
  let c = t % HALF_DAY;
  const ref = (zeroTime ?? 0) - 3600;
  while (c < ref) c += HALF_DAY;
  return c;
}
