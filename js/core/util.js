// Petits utilitaires partagés.

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Texte normalisé pour la recherche : minuscules, sans accents. */
export function norm(s) {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function compareText(a, b) {
  return (a || '').localeCompare(b || '', 'fr', { numeric: true, sensitivity: 'base' });
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slug(s) {
  return (
    norm(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'epreuve'
  );
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ouvre le sélecteur de fichier ; renvoie le fichier choisi ou null. */
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// Page de code DOS 850 (exports CSV de SportSoftware), octets 0x80 à 0xFF.
const CP850 =
  '\xc7\xfc\xe9\xe2\xe4\xe0\xe5\xe7\xea\xeb\xe8\xef\xee\xec\xc4\xc5\xc9\xe6\xc6\xf4\xf6\xf2\xfb\xf9\xff\xd6\xdc\xf8\xa3\xd8\xd7ƒ' +
  '\xe1\xed\xf3\xfa\xf1\xd1\xaa\xba\xbf\xae\xac\xbd\xbc\xa1\xab\xbb░▒▓│┤\xc1\xc2\xc0\xa9╣║╗╝\xa2\xa5┐' +
  '└┴┬├─┼\xe3\xc3╚╔╩╦╠═╬\xa4\xf0\xd0\xca\xcb\xc8ı\xcd\xce\xcf┘┌█▄\xa6\xcc▀' +
  '\xd3\xdf\xd4\xd2\xf5\xd5\xb5\xfe\xde\xda\xdb\xd9\xfd\xdd\xaf\xb4\xad\xb1‗\xbe\xb6\xa7\xf7\xb8\xb0\xa8\xb7\xb9\xb3\xb2■\xa0';

// Caractères attendus dans des noms français : sert à choisir le bon encodage.
const LIKELY = new Set('éèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇœŒ’€ñÑ');

function decodeCp850(bytes) {
  let s = '';
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
  return s;
}

/**
 * Décode un texte qui n'est pas de l'UTF-8. Chaque ligne est lue en Windows-1252 (Excel)
 * ou en CP850 (SportSoftware), selon celle qui donne des lettres accentuées plausibles :
 * certains fichiers mélangent les deux (en-tête SportSoftware, noms retouchés dans Excel).
 */
export function decodeLegacy(bytes) {
  const win = new TextDecoder('windows-1252');
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lines.push(bytes.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  const score = (s) => [...s].reduce((n, c) => n + (LIKELY.has(c) ? 1 : 0), 0);
  const decoded = lines.map((line) => {
    if (!line.some((b) => b >= 0x80)) return { text: win.decode(line), pref: 0 };
    const a = win.decode(line);
    const b = decodeCp850(line);
    return { a, b, pref: score(b) - score(a) };
  });
  const majority = decoded.reduce((n, d) => n + Math.sign(d.pref), 0) > 0;
  return decoded.map((d) => d.text ?? (d.pref > 0 || (d.pref === 0 && majority) ? d.b : d.a)).join('');
}

/** Lit un fichier texte : UTF-8, sinon Windows-1252 / CP850 (détection ligne par ligne). */
export async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return decodeLegacy(new Uint8Array(buf));
  }
}

export function personName(c) {
  if (!c) return '';
  return [(c.lastName || '').toUpperCase(), c.firstName || ''].filter(Boolean).join(' ') || (c.card ? `Puce ${c.card} (sans nom)` : '(sans nom)');
}

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ordinal(n) {
  return n === 1 ? '1er' : `${n}e`;
}
