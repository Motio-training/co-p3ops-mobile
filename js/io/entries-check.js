// Contrôle strict du fichier d'inscription d'une course au score (Nom ; Prénom ; Section ; 1re balise ; Puce).
// Le fichier n'est enregistré que s'il ne contient aucune erreur : sinon, la liste des cases à corriger
// est affichée, l'utilisateur corrige le fichier puis le réimporte.
import { norm } from '../core/util.js';
import { guessMapping } from './csv.js';

export const SCORE_COLUMNS = [
  { key: 'lastName', label: 'Nom' },
  { key: 'firstName', label: 'Prénom' },
  { key: 'section', label: 'Section' },
  { key: 'firstControl', label: '1re balise' },
  { key: 'card', label: 'Puce' },
];

const MAX_CARD = 16777215; // plus grand numéro de puce SportIdent
const MAX_CODE = 1023; // plus grand numéro de balise SportIdent

const clean = (v) => String(v ?? '').replace(/[  ]/g, ' ').trim();

/**
 * csv : résultat de parseCsv. Renvoie { errors, warnings, entries, named, nameless, sections }.
 * Chaque erreur : { line, column, value, message }.
 */
export function checkScoreFile(csv) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const map = guessMapping(csv.headers, csv.rows, { score: true });
  const missingCols = SCORE_COLUMNS.filter((c) => !(map[c.key] >= 0));
  if (missingCols.length) {
    for (const c of missingCols) {
      errors.push({ line: 1, column: c.label, value: '', message: `Colonne « ${c.label} » introuvable. Utilisez le « Fichier d'inscription CO » (colonnes Nom ; Prénom ; Section ; 1re balise ; Puce).` });
    }
    return { errors, warnings, entries, named: [], nameless: [], sections: [], map };
  }

  const seenCard = new Map(); // "puce|1re balise" → ligne
  const seenPerson = new Map(); // "nom|prénom|section" → ligne
  csv.rows.forEach((row, i) => {
    const line = csv.lines?.[i] ?? i + 2;
    const get = (k) => clean(row[map[k]]);
    const lastName = get('lastName');
    const firstName = get('firstName');
    const section = get('section');
    const firstText = get('firstControl');
    const cardText = get('card').replace(/\s/g, '');
    const err = (column, value, message) => errors.push({ line, column, value, message });
    const rowErrors = errors.length;

    // Puce : obligatoire, chiffres uniquement
    let card = null;
    if (!cardText) err('Puce', '', 'Numéro de puce manquant.');
    else if (!/^\d+$/.test(cardText)) err('Puce', cardText, "Le numéro de puce ne doit contenir que des chiffres.");
    else if (Number(cardText) < 1 || Number(cardText) > MAX_CARD) err('Puce', cardText, "Ce numéro de puce n'existe pas.");
    else card = Number(cardText);

    // 1re balise : obligatoire, numéro de balise
    let firstControl = null;
    if (!firstText) err('1re balise', '', '1re balise manquante.');
    else if (!/^\d+$/.test(firstText)) err('1re balise', firstText, 'La 1re balise doit être un numéro (chiffres uniquement).');
    else if (Number(firstText) < 1 || Number(firstText) > MAX_CODE) err('1re balise', firstText, `Numéro de balise impossible (1 à ${MAX_CODE}).`);
    else firstControl = Number(firstText);

    // Nom, prénom, section : tous les trois, ou aucun (puce sans nom, à compléter à la lecture)
    if (lastName || firstName || section) {
      if (!lastName) err('Nom', '', 'Nom manquant (prénom ou section renseigné).');
      if (!firstName) err('Prénom', '', 'Prénom manquant (nom ou section renseigné).');
      if (!section) err('Section', '', 'Section manquante.');
      if (/\d/.test(lastName)) err('Nom', lastName, 'Le nom contient des chiffres : colonnes décalées ?');
      if (/\d/.test(firstName)) err('Prénom', firstName, 'Le prénom contient des chiffres : colonnes décalées ?');
      if (section.length > 40) err('Section', section, 'Section trop longue (40 caractères au plus).');
    }

    if (card != null && firstControl != null) {
      const k = `${card}|${firstControl}`;
      if (seenCard.has(k)) err('Puce', cardText, `Puce ${card} avec la 1re balise ${firstControl} déjà présente ligne ${seenCard.get(k)}.`);
      else seenCard.set(k, line);
    }
    if (lastName && firstName) {
      const k = `${norm(lastName)}|${norm(firstName)}|${norm(section)}`;
      if (seenPerson.has(k)) warnings.push({ line, column: 'Nom', value: `${lastName} ${firstName}`, message: `Même nom, prénom et section que la ligne ${seenPerson.get(k)}.` });
      else seenPerson.set(k, line);
    }
    if (errors.length === rowErrors) entries.push({ line, lastName, firstName, section, firstControl, card });
  });

  if (!csv.rows.length) errors.push({ line: 2, column: '', value: '', message: 'Le fichier ne contient aucune ligne.' });

  const named = entries.filter((e) => e.lastName);
  const nameless = entries.filter((e) => !e.lastName);
  const bySection = new Map();
  for (const e of named) bySection.set(e.section, (bySection.get(e.section) || 0) + 1);
  const sections = [...bySection].sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }));
  return { errors, warnings, entries, named, nameless, sections, map };
}
