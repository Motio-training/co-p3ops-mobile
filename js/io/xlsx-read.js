// Lecture d'un classeur Excel (.xlsx) dans le navigateur, sans bibliothèque : un .xlsx est un ZIP
// de fichiers XML. On lit la première feuille et on renvoie un tableau comme pour un fichier CSV
// ({ headers, rows, lines }), compatible avec les fichiers enregistrés par Excel (2007 et plus
// récents), OpenOffice et LibreOffice.

/** Vrai si les octets ressemblent à un fichier ZIP (donc .xlsx, .ods, .docx…). */
export function looksLikeZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// --- ZIP --------------------------------------------------------------------------------------------
function readZipEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name.replace(/^\/+/, ''), { method, crc, compSize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, dv };
}

/** Données décompressées d'un fichier du ZIP. Méthode « deflate » : enveloppée en gzip pour DecompressionStream. */
async function entryBytes(bytes, zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const dv = zip.dv;
  const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
  const data = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('Compression du classeur non prise en charge.');
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur est trop ancien pour lire les fichiers Excel : mettez Chrome ou Edge à jour, ou enregistrez le fichier au format CSV.');
  }
  const gz = new Uint8Array(10 + data.length + 8);
  gz.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff], 0);
  gz.set(data, 10);
  const tail = new DataView(gz.buffer, 10 + data.length, 8);
  tail.setUint32(0, e.crc, true);
  tail.setUint32(4, e.size >>> 0, true);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function entryXml(bytes, zip, name) {
  const data = await entryBytes(bytes, zip, name);
  if (!data) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`Classeur abîmé (${name}).`);
  return doc;
}

const all = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const first = (node, tag) => node.getElementsByTagNameNS('*', tag)[0] || null;

/** Texte d'un élément de texte riche (<si>, <is>) : les <t> des morceaux, sans les indications phonétiques. */
function richText(node) {
  if (!node) return '';
  let s = '';
  for (const t of all(node, 't')) {
    if (t.parentNode && t.parentNode.localName === 'rPh') continue;
    s += t.textContent;
  }
  return s;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref || '')?.[0]?.toUpperCase() || '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Nombre écrit par le tableur (« 2421051 », « 48.0 », « 2.421051E6 ») → texte lisible (« 2421051 »). */
function numberText(v) {
  const t = String(v).trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e9) / 1e9);
}

/** Première feuille d'un classeur .xlsx → { headers, rows, lines, sheetName }. */
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = readZipEntries(bytes);
  if (!zip.entries.has('xl/workbook.xml')) {
    if (zip.entries.has('content.xml')) throw new Error('Fichier OpenOffice (.ods) : enregistrez-le au format Excel (.xlsx) puis réimportez-le.');
    throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
  }

  // Première feuille du classeur (ordre des onglets)
  const wb = await entryXml(bytes, zip, 'xl/workbook.xml');
  const sheet = first(wb, 'sheet');
  let path = 'xl/worksheets/sheet1.xml';
  const rid = sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet?.getAttribute('r:id');
  const rels = await entryXml(bytes, zip, 'xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    const rel = all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }

  const sstDoc = await entryXml(bytes, zip, 'xl/sharedStrings.xml');
  const shared = sstDoc ? all(sstDoc, 'si').map(richText) : [];

  const ws = await entryXml(bytes, zip, path);
  if (!ws) throw new Error('Feuille introuvable dans le classeur.');
  const table = [];
  let nextRow = 1;
  for (const row of all(ws, 'row')) {
    const r = Number(row.getAttribute('r')) || nextRow;
    nextRow = r + 1;
    const cells = [];
    let nextCol = 0;
    for (const c of [...row.children].filter((x) => x.localName === 'c')) {
      const ref = c.getAttribute('r');
      const ci = ref ? colIndex(ref) : nextCol;
      nextCol = ci + 1;
      const type = c.getAttribute('t');
      const v = first(c, 'v')?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = richText(first(c, 'is'));
      else if (type === 'str' || type === 'e') value = v;
      else if (type === 'b') value = v === '1' ? 'VRAI' : 'FAUX';
      else value = numberText(v);
      cells[ci] = value;
    }
    table.push({ r, cells: Array.from(cells, (x) => (x == null ? '' : String(x))) });
  }

  // Comme pour un CSV : on ignore les lignes vides ; la première ligne remplie donne les en-têtes.
  const filled = table.filter((t) => t.cells.some((x) => x.trim() !== ''));
  const width = Math.max(0, ...filled.map((t) => t.cells.length));
  const pad = (cells) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
  return {
    delimiter: 'xlsx',
    sheetName: sheet?.getAttribute('name') || '',
    headers: filled.length ? pad(filled[0].cells).map((h) => h.trim()) : [],
    rows: filled.slice(1).map((t) => pad(t.cells)),
    lines: filled.slice(1).map((t) => t.r),
  };
}
