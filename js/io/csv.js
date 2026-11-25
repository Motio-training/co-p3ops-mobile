// Lecture/écriture CSV et correspondance des colonnes pour l'import des inscrits.
import { norm } from '../core/util.js';
import { parseClock } from '../core/time.js';

function countOutsideQuotes(line, d) {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const scores = [';', ',', '\t'].map((d) => [d, countOutsideQuotes(line, d)]);
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : ';';
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  const starts = []; // n° de ligne du fichier où commence chaque ligne
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      starts.push(rowLine);
      line++;
      rowLine = line;
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
    starts.push(rowLine);
  }
  const keep = rows.map((r, i) => i).filter((i) => rows[i].some((c) => c.trim() !== ''));
  const clean = keep.map((i) => rows[i]);
  return { delimiter, headers: (clean[0] || []).map((h) => h.trim()), rows: clean.slice(1), lines: keep.slice(1).map((i) => starts[i]) };
}

export function toCsv(rows, delimiter = ';') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(delimiter)).join('\r\n');
}

// Champs importables, avec les intitulés de colonnes reconnus automatiquement
// (y compris ceux des exports CSV de SportSoftware OE, en français et en anglais).
export const ENTRY_FIELDS = [
  { key: 'lastName', label: 'Nom', exact: ['nom', 'surname', 'last name', 'lastname', 'family name', 'family', 'nom de famille'] },
  { key: 'firstName', label: 'Prénom', exact: ['prenom', 'first name', 'firstname', 'given name', 'given'] },
  {
    key: 'club',
    label: 'Club',
    exact: ['club', 'nom club', 'nom du club', 'club name', 'cl.name', 'organisation', 'organization', 'equipe', 'team'],
    contains: ['club'],
    exclude: ['n° club', 'no club', 'n club', 'club no', 'club no.', 'numero club'],
  },
  {
    key: 'className',
    label: 'Catégorie',
    exact: ['categorie', 'cat', 'cat.', 'class', 'classe', 'court', 'short', 'category', 'class (short)', 'catg. court', 'catg court', 'catg.', 'catg'],
    contains: ['categ', 'catg'],
    exclude: ['no catg.', 'no catg', 'n° catg.', 'n° catg', 'no catg. inscription', "catg. d'inscription (court)", "catg. d'inscription (long)", 'catg. long'],
  },
  {
    key: 'card',
    label: 'N° de puce',
    exact: ['puce', 'n° puce', 'no puce', 'numero puce', 'num puce', 'chip', 'chipno', 'chip no', 'si', 'si card', 'sicard', 'si-card', 'n° si', 'carte', 'card', 'control card'],
    contains: ['puce', 'chip', 'sicard'],
  },
  {
    key: 'bib',
    label: 'Dossard',
    exact: ['dossard', 'n° dossard', 'bib', 'stno', 'n° dep.', 'n° dep', 'start no', 'startnumber', 'start number', 'doss.', 'doss'],
    contains: ['dossard'],
  },
  { key: 'startTime', label: 'Heure de départ', exact: ['depart', 'heure de depart', 'heure depart', 'start', 'start time', 'starttime'] },
  {
    key: 'licence',
    label: 'N° de licence',
    exact: ['licence', 'license', 'n° licence', 'no licence', 'numero licence', 'database id', 'ident. base de donnees'],
    contains: ['licen'],
  },
  { key: 'rented', label: 'Puce louée', exact: ['louee', 'puce louee', 'rented', 'location'], contains: ['louee'] },
  // Courses au score militaires
  {
    key: 'section',
    label: 'Section',
    scoreOnly: true,
    exact: ['section', 'no club', 'n° club', 'no. club', 'club no.', 'club no', 'unite', 'compagnie', 'peloton', 'groupe'],
    contains: ['section'],
  },
  {
    key: 'firstControl',
    label: '1re balise imposée',
    scoreOnly: true,
    exact: ['1re balise', '1ere balise', 'premiere balise', 'balise imposee', 'premier poste', '1er poste', 'poste de depart', 'balise de depart'],
    contains: ['balise'],
  },
];

export function entryFields(score) {
  return ENTRY_FIELDS.filter((f) => score || !f.scoreOnly);
}

/**
 * Devine la correspondance colonnes → champs. Les colonnes qui contiennent des données
 * sont préférées aux colonnes vides portant le même intitulé.
 * Dans un export SportSoftware « OE Score », la colonne « Depart » contient la 1re balise
 * imposée (petit nombre), pas une heure : elle est reconnue d'après son contenu.
 */
export function guessMapping(headers, rows = [], { score = false } = {}) {
  const H = headers.map(norm);
  const sample = (i) =>
    rows
      .slice(0, 300)
      .map((r) => (r[i] ?? '').trim())
      .filter(Boolean);
  const hasData = (i) => sample(i).length > 0;
  const controlCodes = (i) => {
    const v = sample(i);
    return v.length > 0 && v.every((x) => /^\d{1,4}$/.test(x) && Number(x) > 0 && Number(x) < 1024);
  };
  const map = {};
  const taken = new Set();
  const pick = (test) => {
    const idx = H.map((h, i) => i).filter((i) => !taken.has(i) && test(H[i], i));
    return idx.find(hasData) ?? idx[0] ?? -1;
  };
  for (const f of entryFields(score)) {
    let idx = pick((h) => f.exact.includes(h));
    if (idx < 0 && f.contains) idx = pick((h) => !(f.exclude || []).includes(h) && f.contains.some((c) => h.includes(c)));
    map[f.key] = idx;
    if (idx >= 0) taken.add(idx);
  }
  // Une colonne « Départ » remplie de numéros de postes n'est pas une heure de départ.
  if (map.startTime >= 0 && controlCodes(map.startTime)) {
    if (score && map.firstControl < 0) map.firstControl = map.startTime;
    else taken.delete(map.startTime);
    map.startTime = -1;
  }
  if (score && map.firstControl < 0) {
    const idx = H.findIndex((h, i) => !taken.has(i) && ['region', 'depart'].includes(h) && controlCodes(i));
    if (idx >= 0) {
      map.firstControl = idx;
      taken.add(idx);
    }
  }
  // Export OE (FR) : la seconde colonne « Nom », après « N° club », contient le club.
  if (map.club < 0) {
    const second = H.findIndex((h, i) => h === 'nom' && i !== map.lastName && !taken.has(i));
    if (second >= 0) map.club = second;
  }
  for (const f of ENTRY_FIELDS) if (!(f.key in map)) map[f.key] = -1;
  return map;
}

const TRUTHY = new Set(['x', '1', 'oui', 'o', 'yes', 'y', 'true', 'vrai']);

/** Transforme une ligne CSV en valeurs de coureur selon la correspondance choisie. */
export function rowToEntry(row, map) {
  const get = (k) => (map[k] >= 0 ? (row[map[k]] ?? '').trim() : '');
  const cardDigits = get('card').replace(/\D/g, '');
  const start = parseClock(get('startTime'));
  const first = get('firstControl').replace(/\D/g, '');
  return {
    lastName: get('lastName'),
    firstName: get('firstName'),
    club: get('club'),
    className: get('className'),
    card: cardDigits ? Number(cardDigits) || null : null,
    bib: get('bib'),
    startTime: Number.isNaN(start) ? null : start,
    licence: get('licence'),
    rented: TRUTHY.has(norm(get('rented'))),
    section: get('section'),
    firstControl: first ? Number(first) : null,
  };
}
