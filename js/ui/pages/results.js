// Résultats par catégorie (ou par section), temps intermédiaires, impressions et exports.
import { html, useState } from '../../lib.js';
import { getDerived, store } from '../../core/store.js';
import { isScoreMode } from '../../domain/results.js';
import { openExportPreview } from './export-preview.js';
import { toast } from '../../core/bus.js';
import { personName } from '../../core/util.js';
import { fmtBehind, fmtDuration } from '../../core/time.js';
import {
  exportExcel,
  exportResultsCsv,
  exportResultsHtml,
  exportResultsXml,
  exportSplitsHtml,
  printHtml,
  resultsHtml,
  splitsHtml,
} from '../../io/reports.js';
import { Button, EmptyState, Menu, PageHeader, Segmented, StatusPill, Toggle } from '../components.js';
import { go, usePref, useStore } from '../hooks.js';
import { CompetitorModal } from './competitors.js';

const km = (m) => (m ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : '');

/** Export Excel : en mode score, aperçu du tableau (remarques modifiables) avant le téléchargement. */
export async function runExcelExport() {
  if (isScoreMode(store.event)) return openExportPreview();
  try {
    await exportExcel();
    toast('Fichier Excel téléchargé (dossier Téléchargements).', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function ResultTable({ rows, onOpen }) {
  return html`<div class="table-wrap"><table class="table results-table">
    <thead><tr><th class="num w-pl">Pl.</th><th>Nom</th><th>Club</th><th class="num">Temps</th><th class="num">Écart</th><th></th></tr></thead>
    <tbody>
      ${rows.map(
        (row) => html`<tr key=${row.comp.id} class=${'clickable' + (row.res.status === 'RUN' ? ' dim' : '')} onClick=${() => onOpen(row.comp)}>
          <td class="num w-pl"><strong>${row.place ?? ''}</strong></td>
          <td><strong>${personName(row.comp)}</strong></td>
          <td>${row.comp.club}</td>
          <td class="num mono">${row.res.status === 'RUN' ? '' : fmtDuration(row.res.time)}</td>
          <td class="num mono muted">${row.place != null ? fmtBehind(row.behind) : ''}</td>
          <td class="w-status">${(row.res.status !== 'OK' || row.comp.nc) && html`<${StatusPill} status=${row.res.status} nc=${row.comp.nc} />`}</td>
        </tr>`
      )}
    </tbody>
  </table></div>`;
}

function ScoreTable({ rows, onOpen }) {
  return html`<div class="table-wrap"><table class="table results-table">
    <thead><tr><th class="num w-pl">Pl.</th><th>Nom</th><th class="num">Temps</th><th class="num">Balises</th><th class="num">1re balise</th><th class="num">Note /20</th><th></th></tr></thead>
    <tbody>
      ${rows.map(({ comp, res, place }) => {
        const named = comp.lastName || comp.firstName;
        return html`<tr key=${comp.id} class=${'clickable' + (res.status === 'RUN' ? ' dim' : '')} onClick=${() => onOpen(comp)}>
          <td class="num w-pl"><strong>${place ?? ''}</strong></td>
          <td>${named ? html`<strong>${personName(comp)}</strong>` : html`<span class="text-warn">${personName(comp)}</span>`}</td>
          <td class="num mono">${res.status === 'RUN' ? '' : fmtDuration(res.time)}</td>
          <td class="num">${res.validated != null ? html`<span class=${res.missing.length ? 'text-err' : ''}>${res.validated}/${res.totalControls}</span>` : ''}</td>
          <td class="num">${res.first?.expected != null ? html`<span class=${res.first.ok ? 'text-ok' : 'text-err'}>${res.first.ok ? '✓' : '✗'} ${res.first.expected}</span>` : ''}</td>
          <td class="num"><strong class="note">${res.note ?? ''}</strong></td>
          <td class="w-status">${(res.status !== 'OK' || comp.nc) && html`<${StatusPill} status=${res.status} nc=${comp.nc} />`}</td>
        </tr>`;
      })}
    </tbody>
  </table></div>`;
}

function SplitTable({ rows, course, onOpen }) {
  const controls = course?.controls || [];
  return html`<div class="table-wrap"><table class="table splits-grid">
    <thead><tr>
      <th class="num w-pl">Pl.</th><th class="sticky-name">Nom</th><th class="num">Temps</th>
      ${controls.map((c, i) => html`<th class="num" key=${i}>${i + 1}<br /><span class="muted">${c}</span></th>`)}
      <th class="num">A</th>
    </tr></thead>
    <tbody>
      ${rows.map(
        (row) => html`<tr key=${row.comp.id} class="clickable" onClick=${() => onOpen(row.comp)}>
          <td class="num w-pl"><strong>${row.place ?? ''}</strong></td>
          <td class="sticky-name"><strong>${personName(row.comp)}</strong><br /><small class="muted">${row.comp.club}</small></td>
          <td class="num mono">${row.res.status === 'OK' ? fmtDuration(row.res.time) : html`<${StatusPill} status=${row.res.status} nc=${row.comp.nc} />`}</td>
          ${controls.map((_, i) => {
            const sp = row.res.splits[i];
            if (!sp || sp.missing) return html`<td class="num text-err">—</td>`;
            return html`<td class="num mono split-cell">
              <span>${fmtDuration(sp.cumul)}</span>
              <small class=${sp.legRank === 1 ? 'best' : 'muted'}>${fmtDuration(sp.leg)}${sp.legRank ? ` (${sp.legRank})` : ''}</small>
            </td>`;
          })}
          <td class="num mono split-cell">
            <span>${fmtDuration(row.res.time)}</span>
            <small class=${row.res.finishLegRank === 1 ? 'best' : 'muted'}>${fmtDuration(row.res.finishLeg)}</small>
          </td>
        </tr>`
      )}
    </tbody>
  </table></div>`;
}

export function ResultsPage({ sub }) {
  const s = useStore();
  const d = getDerived();
  const score = d.score;
  const [modeState, setMode] = useState('results');
  const mode = score ? 'results' : modeState;
  const [showRunning, setShowRunning] = usePref('showRunning');
  const [editComp, setEditComp] = useState(null);
  const groups = d.groups;
  const selected = sub && groups.some((g) => g.id === sub) ? sub : null;
  const shown = selected ? groups.filter((g) => g.id === selected) : groups;
  const ids = selected ? [selected] : null;
  const filterRows = (rows) =>
    rows.filter(
      (r) =>
        r.res.status !== 'DNS' &&
        (!score || r.comp.lastName || r.comp.firstName || r.res.readId) &&
        (mode === 'splits' ? r.res.status !== 'RUN' : showRunning || r.res.status !== 'RUN')
    );

  const openDisplay = () => window.open(`#/ecran/${s.eventId}`, `balise-ecran-${s.eventId}`);
  const label = score ? 'section' : 'catégorie';

  return html`
    <${PageHeader} title=${score ? 'Résultats et notes' : 'Résultats'} subtitle="Mis à jour en direct à chaque lecture de puce.">
      ${!score &&
      html`<${Segmented}
        value=${mode}
        onChange=${setMode}
        options=${[
          { value: 'results', label: 'Classement', icon: 'list' },
          { value: 'splits', label: 'Temps intermédiaires', icon: 'clock' },
        ]}
      />`}
      <${Menu}
        label="Imprimer / exporter"
        items=${[
          { label: selected ? `Imprimer cette ${label}` : 'Imprimer les résultats', icon: 'printer', onClick: () => printHtml(resultsHtml({ classIds: ids })) },
          !score && { label: 'Imprimer les temps intermédiaires', icon: 'printer', onClick: () => printHtml(splitsHtml({ classIds: ids })) },
          { separator: true },
          { label: score ? 'Exporter les notes (Excel, un onglet par section)' : 'Exporter en Excel', icon: 'download', onClick: runExcelExport },
          { label: 'Exporter en page web (HTML)', icon: 'download', onClick: () => exportResultsHtml({ classIds: ids }) },
          !score && { label: 'Exporter les intermédiaires (HTML)', icon: 'download', onClick: () => exportSplitsHtml({ classIds: ids }) },
          { label: 'Exporter en tableur (CSV)', icon: 'download', onClick: exportResultsCsv },
          !score && { label: 'Exporter en IOF XML 3.0', icon: 'download', onClick: exportResultsXml },
        ]}
      />
      ${score && html`<${Button} icon="download" variant="primary" onClick=${runExcelExport}>Export Excel</${Button}>`}
      <${Button} icon="monitor" onClick=${openDisplay} title="Ouvrir l'écran de résultats (à placer sur un téléviseur ou un second écran)">Écran d'affichage</${Button}>
    <//>
    ${!groups.length
      ? html`<div class="card"><${EmptyState} icon="trophy" title=${`Aucune ${label}`} text="Les résultats apparaîtront ici dès les premières lectures." /></div>`
      : html`<div class="results-layout">
          <nav class="class-nav">
            <button type="button" class=${!selected ? 'active' : ''} onClick=${() => go(`e/${s.eventId}/resultats`)}>
              <span>${score ? 'Toutes les sections' : 'Toutes les catégories'}</span>
            </button>
            ${groups.map((g) => {
              const rows = g.rows.filter((r) => !score || r.comp.lastName || r.comp.firstName || r.res.readId);
              const done = rows.filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS').length;
              const total = rows.filter((r) => r.res.status !== 'DNS').length;
              return html`<button type="button" key=${g.id} class=${selected === g.id ? 'active' : ''} onClick=${() => go(`e/${s.eventId}/resultats/${encodeURIComponent(g.id)}`)}>
                <span>${g.name}</span><small>${done}/${total}</small>
              </button>`;
            })}
            ${mode === 'results' && html`<div class="class-nav-foot"><${Toggle} checked=${showRunning} onChange=${setShowRunning} label=${score ? 'Non encore lus' : 'Coureurs en forêt'} /></div>`}
          </nav>
          <div class="results-main">
            ${shown.map((g) => {
              const rows = filterRows(g.rows);
              const course = s.courses.get(g.courseId);
              if (!selected && !rows.length) return null;
              const info = score
                ? [`${g.ranked} noté${g.ranked > 1 ? 's' : ''}`]
                : [course?.name && `Circuit ${course.name}`, km(course?.length), course?.climb && `${course.climb} m`, course?.controls?.length && `${course.controls.length} postes`, `${g.ranked} classé${g.ranked > 1 ? 's' : ''}`];
              return html`<section class="card result-class" key=${g.id}>
                <header class="card-head">
                  <h2>${g.name}</h2>
                  <span class="muted small">${info.filter(Boolean).join(' · ')}</span>
                </header>
                ${rows.length
                  ? score
                    ? html`<${ScoreTable} rows=${rows} onOpen=${setEditComp} />`
                    : mode === 'splits'
                      ? html`<${SplitTable} rows=${rows} course=${course} onOpen=${setEditComp} />`
                      : html`<${ResultTable} rows=${rows} onOpen=${setEditComp} />`
                  : html`<${EmptyState} icon="trophy" title="Pas encore de résultat" text="Personne de ce groupe n'a été lu." />`}
              </section>`;
            })}
            ${!selected && shown.every((g) => !filterRows(g.rows).length) &&
            html`<div class="card"><${EmptyState} icon="trophy" title="Pas encore de résultat" text="Les résultats apparaîtront ici dès les premières lectures de puces." /></div>`}
          </div>
        </div>`}
    ${editComp && html`<${CompetitorModal} comp=${editComp} onClose=${() => setEditComp(null)} />`}
  `;
}
