// Coureurs : inscriptions, import CSV / IOF XML, fiche coureur.
import { html, useMemo, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { delOp, getDerived, mutate, put, putOp, store } from '../../core/store.js';
import { compareText, norm, personName, pickFile, readFileText, uid } from '../../core/util.js';
import { fmtClock, fmtDuration } from '../../core/time.js';
import { entryFields, guessMapping, parseCsv, rowToEntry } from '../../io/csv.js';
import { parseEntries } from '../../io/iof.js';
import { exportCompetitorsCsv } from '../../io/reports.js';
import { unassignRead } from '../../core/readout.js';
import { isScoreMode, sectionLabel } from '../../domain/results.js';
import { Badge, Button, EmptyState, Field, Menu, Modal, PageHeader, SearchInput, StatusPill, TimeInput } from '../components.js';
import { useStore } from '../hooks.js';
import { sortedClasses } from './classes.js';
import { SplitsTable, ScoreSummary } from './readout-view.js';
import { downloadBlankFile } from './guide.js';
import { ScoreImportModal } from './import-check.js';

export const EMPTY_COMPETITOR = {
  firstName: '',
  lastName: '',
  club: '',
  section: '',
  firstControl: null,
  classId: '',
  card: null,
  bib: '',
  startTime: null,
  status: '',
  nc: false,
  rented: false,
  licence: '',
  manualStart: null,
  manualFinish: null,
};

function uniqueSorted(values) {
  const set = new Map();
  for (const v of values) if (v) set.set(norm(v), v);
  return [...set.values()].sort(compareText);
}

export function ClubDatalist() {
  return html`<datalist id="clubs">${uniqueSorted([...store.competitors.values()].map((c) => c.club)).map((c) => html`<option value=${c} />`)}</datalist>
    <datalist id="sections">${uniqueSorted([...store.competitors.values()].map((c) => c.section)).map((c) => html`<option value=${c} />`)}</datalist>`;
}

export function CompetitorModal({ comp, onClose, defaults = {} }) {
  const score = isScoreMode(store.event);
  const [c, setC] = useState({ ...EMPTY_COMPETITOR, classId: sortedClasses()[0]?.id || '', ...defaults, ...(comp || {}) });
  const [cardText, setCardText] = useState(c.card ? String(c.card) : '');
  const [firstText, setFirstText] = useState(c.firstControl != null ? String(c.firstControl) : '');
  const set = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  const d = getDerived();
  const read = comp ? d.readsByComp.get(comp.id) : null;
  const res = comp ? d.results.get(comp.id) : null;
  const cardNum = cardText.replace(/\D/g, '') ? Number(cardText.replace(/\D/g, '')) : null;
  const sameCard = cardNum ? [...store.competitors.values()].filter((o) => o.id !== comp?.id && Number(o.card) === cardNum) : [];
  const valid = (c.lastName.trim() || c.firstName.trim() || cardNum) && (!cardText.trim() || cardNum);

  const save = (again) => {
    if (!valid) return;
    const first = firstText.replace(/\D/g, '');
    const doc = {
      ...c,
      id: comp?.id || uid(),
      card: cardNum,
      firstControl: first ? Number(first) : null,
      lastName: c.lastName.trim(),
      firstName: c.firstName.trim(),
      club: c.club.trim(),
      section: String(c.section || '').trim(),
      createdAt: comp?.createdAt || Date.now(),
    };
    put('competitor', doc);
    if (again === true) {
      toast(`${personName(doc)} ajouté(e).`, 'success');
      setC({ ...EMPTY_COMPETITOR, classId: c.classId, club: c.club, section: c.section });
      setCardText('');
      setFirstText('');
      setTimeout(() => document.querySelector('.modal input')?.focus(), 30);
    } else onClose();
  };

  const del = async () => {
    const ok = await confirmDialog({ title: 'Supprimer', message: `Supprimer ${personName(comp)} ? Sa lecture de puce éventuelle restera disponible dans « Puces à traiter ».`, confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const ops = [delOp('competitor', comp.id)];
    for (const r of store.cards.values()) if (r.competitorId === comp.id) ops.push(putOp('card', { ...r, competitorId: null, archived: false }));
    mutate(ops);
    onClose();
  };

  return html`<${Modal}
    title=${comp ? personName(comp) : score ? 'Nouveau personnel' : 'Nouveau coureur'}
    size="lg"
    onClose=${onClose}
    onSubmit=${() => save(false)}
    footer=${html`
      ${comp && html`<${Button} variant="ghost-danger" icon="trash" onClick=${del}>Supprimer</${Button}>`}
      <span class="spacer"></span>
      <${Button} onClick=${onClose}>Annuler</${Button}>
      ${!comp && html`<${Button} onClick=${() => save(true)} disabled=${!valid}>Enregistrer et ajouter un autre</${Button}>`}
      <${Button} type="submit" variant="primary" disabled=${!valid}>Enregistrer</${Button}>`}
  >
    <${ClubDatalist} />
    <div class="form-grid">
      <${Field} label="Nom"><input class="input" value=${c.lastName} onInput=${(e) => set('lastName')(e.target.value)} /><//>
      <${Field} label="Prénom"><input class="input" value=${c.firstName} onInput=${(e) => set('firstName')(e.target.value)} /><//>
      ${score
        ? html`<${Field} label="Section"><input class="input" list="sections" value=${c.section} onInput=${(e) => set('section')(e.target.value)} placeholder="Ex. : 311" /><//>
            <${Field} label="1re balise imposée" hint="Balise indiquée par la flèche violine">
              <input class="input mono" value=${firstText} inputmode="numeric" onInput=${(e) => setFirstText(e.target.value)} placeholder="Ex. : 48" />
            <//>`
        : html`<${Field} label="Club"><input class="input" list="clubs" value=${c.club} onInput=${(e) => set('club')(e.target.value)} /><//>`}
      <${Field} label="Catégorie">
        <select class="input" value=${c.classId} onChange=${(e) => set('classId')(e.target.value)}>
          <option value="">— Aucune —</option>
          ${sortedClasses().map((cl) => html`<option value=${cl.id}>${cl.name}</option>`)}
        </select>
      <//>
      <${Field} label="N° de puce SportIdent" error=${cardText.trim() && !cardNum ? 'Numéro invalide' : ''} hint=${sameCard.length ? `Même puce que ${sameCard.map(personName).join(', ')}` : ''}>
        <input class="input mono" value=${cardText} inputmode="numeric" onInput=${(e) => setCardText(e.target.value)} placeholder="Ex. : 8123456" />
      <//>
      <${Field} label="Heure de départ"><${TimeInput} value=${c.startTime} onChange=${set('startTime')} /><//>
      ${!score && html`<${Field} label="Dossard"><input class="input" value=${c.bib} onInput=${(e) => set('bib')(e.target.value)} /><//>`}
      ${!score && html`<${Field} label="N° de licence"><input class="input" value=${c.licence} onInput=${(e) => set('licence')(e.target.value)} /><//>`}
    </div>
    <div class="check-row">
      <label class="check"><input type="checkbox" checked=${c.rented} onChange=${(e) => set('rented')(e.target.checked)} /><span>Puce prêtée (à récupérer à l'arrivée)</span></label>
      <label class="check"><input type="checkbox" checked=${c.nc} onChange=${(e) => set('nc')(e.target.checked)} /><span>Hors classement (NC)</span></label>
    </div>
    <${Field} label="Statut" class="mt">
      <select class="input" value=${c.status} onChange=${(e) => set('status')(e.target.value)}>
        <option value="">Normal (calculé d'après la puce)</option>
        <option value="DNS">${score ? 'Absent / non partant' : 'Non partant'}</option>
        <option value="DNF">Abandon</option>
        <option value="DSQ">Disqualifié</option>
      </select>
    <//>

    ${comp &&
    html`<details class="disclosure" open=${!!read}>
      <summary>Résultat et corrections</summary>
      <div class="result-line">
        <${StatusPill} status=${res.status} nc=${comp.nc} />
        ${score && res.note != null && html`<span class="big-time">${res.note} / 20</span>`}
        <span class="mono big-time">${res.time != null ? fmtDuration(res.time) : '—'}</span>
        <span class="muted">Départ ${fmtClock(res.start) || '—'} · Arrivée ${fmtClock(res.finish) || '—'}</span>
        ${read && html`<${Button} small icon="unlink" onClick=${() => unassignRead(read.id)} title="La lecture redevient « à traiter »">Dissocier la lecture</${Button}>`}
      </div>
      ${res.warnings.map((w) => html`<p class="text-warn small">${w}</p>`)}
      ${score && read && html`<${ScoreSummary} res=${res} />`}
      ${read && html`<${SplitsTable} res=${res} compact />`}
      <div class="form-grid mt">
        <${Field} label="Départ corrigé" hint="Remplace l'heure de départ calculée"><${TimeInput} value=${c.manualStart} onChange=${set('manualStart')} placeholder="—" /><//>
        <${Field} label="Arrivée corrigée" hint="Ex. : arrivée non poinçonnée"><${TimeInput} value=${c.manualFinish} onChange=${set('manualFinish')} placeholder="—" /><//>
      </div>
    </details>`}
  <//>`;
}

// --- Import --------------------------------------------------------------------------------
export function ImportModal({ source, onClose, onDone }) {
  const score = isScoreMode(store.event);
  const isCsv = source.kind === 'csv';
  const fields = entryFields(score);
  const [map, setMap] = useState(isCsv ? guessMapping(source.headers, source.rows, { score }) : null);
  const [skipDup, setSkipDup] = useState(true);
  const entries = useMemo(() => (isCsv ? source.rows.map((r) => rowToEntry(r, map)) : source.entries), [map]);
  const named = entries.filter((e) => e.lastName || e.firstName);
  const nameless = entries.filter((e) => !e.lastName && !e.firstName && e.card);
  const [withNameless, setWithNameless] = useState(nameless.length > 0);
  const valid = withNameless ? [...named, ...nameless] : named;

  const existingKey = new Set(
    [...store.competitors.values()].map((c) => (c.lastName || c.firstName ? `${norm(c.lastName)}|${norm(c.firstName)}|${norm(c.club)}|${norm(c.section)}` : `#${c.card}`))
  );
  const keyOf = (e) => (e.lastName || e.firstName ? `${norm(e.lastName)}|${norm(e.firstName)}|${norm(e.club)}|${norm(e.section)}` : `#${e.card}`);
  const isDup = (e) => existingKey.has(keyOf(e));
  const toImport = valid.filter((e) => !(skipDup && isDup(e)));
  const classByName = new Map([...store.classes.values()].map((c) => [norm(c.name), c]));
  const newClasses = [...new Set(toImport.map((e) => e.className).filter((n) => n && !classByName.has(norm(n))))];
  const counts = new Map();
  for (const e of valid) if (e.card) counts.set(e.card, (counts.get(e.card) || 0) + 1);
  const dupCards = [...counts].filter(([, n]) => n > 1).map(([c]) => c);
  const sections = score ? [...new Set(toImport.map((e) => e.section).filter(Boolean))].sort(compareText) : [];

  const doImport = () => {
    const ops = [];
    const defaultCourse = [...store.courses.values()][0]?.id || '';
    for (const name of newClasses) {
      const cls = { id: uid(), name, courseId: score ? defaultCourse : '', interval: 120, drawMode: 'random' };
      classByName.set(norm(name), cls);
      ops.push(putOp('class', cls));
    }
    let fallbackClass = '';
    if (toImport.some((e) => !e.className)) {
      fallbackClass = [...store.classes.values()][0]?.id || '';
      if (!fallbackClass && score) {
        const cls = { id: uid(), name: 'Course', courseId: defaultCourse, interval: 120, drawMode: 'random' };
        ops.push(putOp('class', cls));
        fallbackClass = cls.id;
      }
    }
    const now = Date.now();
    for (const e of toImport) {
      const { className, ...rest } = e;
      ops.push(putOp('competitor', { ...EMPTY_COMPETITOR, ...rest, id: uid(), classId: classByName.get(norm(className))?.id || fallbackClass, createdAt: now }));
    }
    mutate(ops);
    toast(`${toImport.length} ${score ? 'personnel(s)' : 'coureur(s)'} importé(s)${newClasses.length && !score ? `, ${newClasses.length} catégorie(s) créée(s) — pensez à leur associer un circuit` : ''}.`, 'success');
    onDone?.();
    onClose();
  };

  return html`<${Modal}
    title=${score ? 'Importer les inscriptions' : 'Importer des coureurs'}
    size="xl"
    onClose=${onClose}
    footer=${html`<span class="muted small">${toImport.length} à importer${valid.length - toImport.length ? ` · ${valid.length - toImport.length} déjà présents` : ''}${
      sections.length ? ` · sections : ${sections.join(', ')}` : ''
    }</span>
      <span class="spacer"></span>
      <${Button} onClick=${onClose}>Annuler</${Button}>
      <${Button} variant="primary" icon="upload" disabled=${!toImport.length} onClick=${doImport}>Importer</${Button}>`}
  >
    ${isCsv &&
    html`<p class="muted small">Vérifiez la correspondance des colonnes de votre fichier (${source.rows.length} lignes, séparateur « ${source.delimiter === '\t' ? 'tabulation' : source.delimiter} »).</p>
      <div class="mapping">
        ${fields.map(
          (f) => html`<${Field} label=${f.label}>
            <select class="input input-sm" value=${map[f.key]} onChange=${(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
              <option value="-1">— ignorer —</option>
              ${source.headers.map((h, i) => html`<option value=${i}>${colName(i)} · ${h || `Colonne ${i + 1}`}</option>`)}
            </select>
          <//>`
        )}
      </div>`}
    <div class="check-col mb">
      <label class="check"><input type="checkbox" checked=${skipDup} onChange=${(e) => setSkipDup(e.target.checked)} /><span>Ignorer les personnes déjà inscrites</span></label>
      ${nameless.length > 0 &&
      html`<label class="check"><input type="checkbox" checked=${withNameless} onChange=${(e) => setWithNameless(e.target.checked)} />
        <span>Importer aussi les <strong>${nameless.length} puces sans nom</strong> (le nom se complète au moment de la lecture)</span></label>`}
    </div>
    ${dupCards.length > 0 &&
    html`<div class="alert alert-warn small">Numéros de puce en double dans le fichier : ${dupCards.join(', ')}. À la lecture, CO - P3OPS choisira la bonne ligne d'après la 1re balise poinçonnée, sinon il vous demandera.</div>`}
    <div class="table-wrap bordered preview"><table class="table">
      <thead><tr><th>Nom</th><th>Prénom</th>${score ? html`<th>Section</th><th class="num">1re balise</th>` : html`<th>Club</th>`}<th>Catégorie</th><th class="num">Puce</th>${!score && html`<th class="num">Départ</th>`}</tr></thead>
      <tbody>
        ${valid.slice(0, 8).map(
          (e) => html`<tr class=${skipDup && isDup(e) ? 'dim' : ''}>
            <td>${e.lastName || html`<span class="muted">—</span>`}</td><td>${e.firstName}</td>
            ${score ? html`<td>${e.section}</td><td class="num mono">${e.firstControl ?? ''}</td>` : html`<td>${e.club}</td>`}
            <td>${e.className}</td>
            <td class="num mono">${e.card || ''}${e.rented ? ' (L)' : ''}</td>${!score && html`<td class="num mono">${fmtClock(e.startTime)}</td>`}
          </tr>`
        )}
      </tbody>
    </table></div>
    ${valid.length > 8 && html`<p class="muted small">… et ${valid.length - 8} autres lignes.</p>`}
  <//>`;
}

function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Import d'un fichier d'inscrits : contrôle strict en course au score, correspondance des colonnes sinon. */
export function EntriesImportModal({ source, onClose, onChange }) {
  if (isScoreMode(store.event) && source.kind === 'csv') {
    const retry = async () => {
      const src = await chooseEntriesFile();
      if (src) onChange(src);
    };
    return html`<${ScoreImportModal} source=${source} onClose=${onClose} onRetry=${retry} />`;
  }
  return html`<${ImportModal} source=${source} onClose=${onClose} />`;
}

/** Ouvre un fichier d'inscrits et renvoie la source à passer à ImportModal (ou null). */
export async function chooseEntriesFile() {
  const file = await pickFile('.csv,.txt,.xml,text/csv,text/xml');
  if (!file) return null;
  try {
    const text = await readFileText(file);
    if (/^\s*</.test(text)) return { kind: 'xml', entries: parseEntries(text), fileName: file.name };
    const csv = parseCsv(text);
    if (!csv.rows.length) throw new Error('Le fichier ne contient aucune ligne.');
    return { kind: 'csv', ...csv, fileName: file.name };
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
}

// --- Page ----------------------------------------------------------------------------------
const PAGE = 250;

export function CompetitorsPage() {
  const s = useStore();
  const d = getDerived();
  const score = isScoreMode(s.event);
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const classes = sortedClasses();
  const sections = score ? uniqueSorted([...s.competitors.values()].map((c) => c.section)) : [];
  const word = score ? ['personnel', 'personnels'] : ['coureur', 'coureurs'];

  const nq = norm(q);
  const list = [...s.competitors.values()]
    .filter((c) => {
      if (!classFilter) return true;
      if (classFilter === '__none') return !s.classes.has(c.classId);
      if (classFilter === '__nosec') return !String(c.section || '').trim();
      if (classFilter.startsWith('sec:')) return String(c.section || '').trim() === classFilter.slice(4);
      return c.classId === classFilter;
    })
    .filter((c) => !nq || norm(`${c.lastName} ${c.firstName} ${c.club} ${c.section || ''} ${c.card || ''} ${c.bib || ''} ${c.licence || ''}`).includes(nq))
    .sort((a, b) => compareText(a.lastName || '~', b.lastName || '~') || compareText(a.firstName, b.firstName) || (a.card || 0) - (b.card || 0));

  const importFile = async () => {
    const src = await chooseEntriesFile();
    if (src) setImporting(src);
  };

  return html`
    <${PageHeader} title=${score ? 'Personnels' : 'Coureurs'} subtitle=${`${s.competitors.size} inscrit${s.competitors.size > 1 ? 's' : ''}`}>
      <${Menu}
        label="Importer / exporter"
        items=${[
          { label: 'Importer un fichier (CSV, IOF XML)', icon: 'upload', onClick: importFile },
          score && { label: "Télécharger le Fichier d'inscription CO (vierge)", icon: 'download', onClick: downloadBlankFile },
          { label: 'Exporter la liste (CSV)', icon: 'download', onClick: exportCompetitorsCsv },
        ]}
      />
      <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>${score ? 'Nouveau personnel' : 'Nouveau coureur'}</${Button}>
    <//>
    ${s.competitors.size === 0
      ? html`<div class="card"><${EmptyState} icon="users" title=${`Aucun ${word[0]} inscrit`} text="Importez le fichier des inscriptions (CSV, export SportSoftware ou IOF XML), ou ajoutez les personnes une par une.">
          <${Button} icon="upload" onClick=${importFile}>Importer un fichier</${Button}>
          <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Ajouter</${Button}>
        <//></div>`
      : html`<div class="card">
          <div class="toolbar">
            <${SearchInput} value=${q} onInput=${(v) => { setQ(v); setLimit(PAGE); }} placeholder="Nom, section, puce…" />
            <select class="input input-auto" value=${classFilter} onChange=${(e) => setClassFilter(e.target.value)}>
              ${score
                ? html`<option value="">Toutes les sections</option>
                    ${sections.map((k) => html`<option value=${'sec:' + k}>${sectionLabel(k)}</option>`)}
                    <option value="__nosec">Sans section</option>`
                : html`<option value="">Toutes les catégories</option>
                    ${classes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
                    ${d.noClass.length > 0 && html`<option value="__none">Sans catégorie (${d.noClass.length})</option>`}`}
            </select>
            <span class="muted small">${list.length} affiché${list.length > 1 ? 's' : ''}</span>
          </div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Nom</th>${score ? html`<th>Section</th><th class="num">1re balise</th>` : html`<th>Club</th><th>Catégorie</th>`}<th class="num">Puce</th><th class="num">Départ</th><th>Résultat</th></tr></thead>
            <tbody>
              ${list.slice(0, limit).map((c) => {
                const res = d.results.get(c.id);
                const cls = s.classes.get(c.classId);
                const named = c.lastName || c.firstName;
                return html`<tr key=${c.id} class="clickable" onClick=${() => setEditing(c)}>
                  <td>${named ? html`<strong>${personName(c)}</strong>` : html`<span class="muted">Sans nom</span>`}</td>
                  ${score
                    ? html`<td>${c.section ? sectionLabel(c.section) : html`<span class="muted">—</span>`}</td><td class="num mono">${c.firstControl ?? ''}</td>`
                    : html`<td>${c.club}</td><td>${cls ? cls.name : html`<span class="text-warn">—</span>`}</td>`}
                  <td class="num mono">${c.card || html`<span class="text-warn">—</span>`}${c.rented ? html` <${Badge} kind="info" title="Puce prêtée">L<//>` : ''}</td>
                  <td class="num mono">${fmtClock(c.startTime)}</td>
                  <td>
                    <${StatusPill} status=${res.status} nc=${c.nc} />
                    ${score && res.note != null ? html` <strong>${res.note}/20</strong>` : ''}
                    ${res.time != null && res.status !== 'RUN' ? html` <span class="mono">${fmtDuration(res.time)}</span>` : ''}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table></div>
          ${list.length > limit && html`<div class="pad center"><${Button} onClick=${() => setLimit(limit + PAGE * 4)}>Afficher plus (${list.length - limit} restants)</${Button}></div>`}
          ${!list.length && html`<${EmptyState} icon="search" title="Aucun résultat" text="Personne ne correspond à cette recherche." />`}
        </div>`}
    ${editing && html`<${CompetitorModal} comp=${editing === 'new' ? null : editing} defaults=${classFilter && !classFilter.startsWith('__') && !classFilter.startsWith('sec:') ? { classId: classFilter } : classFilter.startsWith('sec:') ? { section: classFilter.slice(4) } : {}} onClose=${() => setEditing(null)} />`}
    ${importing && html`<${EntriesImportModal} source=${importing} onChange=${setImporting} onClose=${() => setImporting(null)} />`}
  `;
}
