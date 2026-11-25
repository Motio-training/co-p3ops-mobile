// Documents imprimables / exportables : résultats, temps intermédiaires, listes de départ, tickets.
import { getDerived, store } from '../core/store.js';
import { escapeHtml as e, compareText, formatDate, personName, slug, downloadFile } from '../core/util.js';
import { fmtBehind, fmtClock, fmtDuration } from '../core/time.js';
import { STATUS_LABEL, isScoreMode, sectionLabel } from '../domain/results.js';
import { toCsv } from './csv.js';
import { resultListXml } from './iof.js';

const BASE_CSS = `
*{box-sizing:border-box}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:10pt;color:#111;margin:0;padding:0}
@media screen{body{padding:24px;max-width:1100px;margin:0 auto;background:#fff}}
h1{font-size:17pt;margin:0 0 1mm}
.sub{color:#555;margin:0 0 6mm;font-size:9.5pt}
.cls{margin:0 0 6mm}
.cls h2{font-size:12pt;margin:0 0 1.5mm;padding:0 0 1mm;border-bottom:1.5pt solid #e8590c;display:flex;justify-content:space-between;align-items:baseline;break-after:avoid}
.cls h2 small{font-weight:400;color:#555;font-size:9pt}
table{width:100%;border-collapse:collapse}
table.res{table-layout:fixed}
table.res td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{text-align:left;font-size:8.5pt;color:#555;font-weight:600;border-bottom:.6pt solid #999;padding:1mm 1.5mm}
td{padding:.9mm 1.5mm;border-bottom:.3pt solid #ddd;vertical-align:top}
tr{break-inside:avoid}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:#777}
.st{font-size:8.5pt;font-weight:600}
.st-mp,.st-dnf,.st-dsq{color:#b42318}
.footer{margin-top:8mm;font-size:8pt;color:#888;border-top:.3pt solid #ccc;padding-top:2mm}
`;

const PAGE_A4 = '@page{size:A4;margin:12mm 12mm 14mm}';
const PAGE_LANDSCAPE = '@page{size:A4 landscape;margin:10mm}';

export function documentHtml(title, body, css = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

function header(title) {
  const ev = store.event || {};
  const bits = [formatDate(ev.date), ev.place, ev.organizer].filter(Boolean).map(e).join(' · ');
  return `<h1>${e(ev.name || '')} — ${e(title)}</h1><p class="sub">${bits}</p>`;
}

function footer() {
  return `<div class="footer">Édité le ${new Date().toLocaleString('fr-FR')} · CO - P3OPS</div>`;
}

function sortedClasses(classIds) {
  const list = [...store.classes.values()].filter((c) => !classIds || classIds.includes(c.id));
  return list.sort((a, b) => compareText(a.name, b.name));
}

function courseInfo(course) {
  if (!course) return '';
  const bits = [course.name];
  if (course.length) bits.push(`${(course.length / 1000).toFixed(1).replace('.', ',')} km`);
  if (course.climb) bits.push(`${course.climb} m`);
  if (course.controls?.length) bits.push(`${course.controls.length} postes`);
  return bits.join(' · ');
}

function placeCell(row) {
  if (row.place != null) return `${row.place}`;
  if (row.res.status === 'OK' && row.comp.nc) return 'NC';
  return '';
}

function statusCell(row) {
  const st = row.res.status;
  if (st === 'OK') return row.comp.nc ? '<span class="st">NC</span>' : '';
  return `<span class="st st-${st.toLowerCase()}">${e(STATUS_LABEL[st])}</span>`;
}

// --- Résultats ------------------------------------------------------------------------
export function resultsHtml({ classIds = null, includeRunning = false } = {}) {
  const d = getDerived();
  const score = isScoreMode(store.event);
  let body = header(score ? 'Notes' : 'Résultats');
  for (const g of d.groups.filter((g) => !classIds || classIds.includes(g.id))) {
    const rows = g.rows.filter((r) => includeRunning || (r.res.status !== 'RUN' && r.res.status !== 'DNS'));
    if (!rows.length) continue;
    const info = score ? '' : `${courseInfo(store.courses.get(g.courseId))} · `;
    body += `<section class="cls"><h2>${e(g.name)} <small>${e(info)}${g.ranked} classé${g.ranked > 1 ? 's' : ''}</small></h2>`;
    if (score) {
      body += `<table class="res"><colgroup><col style="width:7%"><col style="width:41%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:16%"></colgroup><thead><tr><th class="num">Pl.</th><th>Nom</th><th class="num">Temps</th><th class="num">Balises</th><th class="num">Note /20</th><th></th></tr></thead><tbody>`;
      for (const row of rows) {
        const r = row.res;
        body += `<tr><td class="num">${placeCell(row)}</td><td>${e(personName(row.comp))}</td><td class="num">${fmtDuration(r.time)}</td><td class="num">${
          r.validated != null ? `${r.validated}/${r.totalControls}` : ''
        }</td><td class="num"><b>${r.note ?? ''}</b></td><td>${statusCell(row)}</td></tr>`;
      }
    } else {
      body += `<table class="res"><colgroup><col style="width:7%"><col style="width:37%"><col style="width:30%"><col style="width:10%"><col style="width:9%"><col style="width:7%"></colgroup><thead><tr><th class="num">Pl.</th><th>Nom</th><th>Club</th><th class="num">Temps</th><th class="num">Écart</th><th></th></tr></thead><tbody>`;
      for (const row of rows) {
        body += `<tr><td class="num">${placeCell(row)}</td><td>${e(personName(row.comp))}</td><td>${e(row.comp.club)}</td><td class="num">${
          row.res.status === 'OK' || row.res.time != null ? fmtDuration(row.res.time) : ''
        }</td><td class="num muted">${row.place != null ? fmtBehind(row.behind) : ''}</td><td>${statusCell(row)}</td></tr>`;
      }
    }
    body += '</tbody></table></section>';
  }
  return documentHtml(`Résultats — ${store.event?.name || ''}`, body + footer(), PAGE_A4);
}

// --- Export Excel ------------------------------------------------------------------------
/** Remarque lisible expliquant la note ou l'absence de note. */
export function remarkFor(comp, res) {
  const bits = [];
  if (!comp.lastName && !comp.firstName) bits.push(`Nom non renseigné (puce ${comp.card ?? '?'})`);
  if (res.status === 'RUN') bits.push('Puce non lue');
  else if (res.status === 'DNS') bits.push('Absent / non partant');
  else if (res.status === 'DNF') bits.push("Arrivée non poinçonnée : saisir l'heure d'arrivée");
  else if (res.status === 'DSQ') bits.push('Disqualifié');
  else if (res.status === 'MP') bits.push(...res.warnings.filter((w) => w !== 'Aucune catégorie'));
  if (res.score) {
    for (const p of res.score.penalties) {
      const first = p.label.startsWith('1re balise') && res.first ? ` (${res.first.punched ?? 'aucune'} au lieu de ${res.first.expected})` : '';
      bits.push(`${p.label}${first} : -${p.points}`);
    }
  }
  if (comp.nc) bits.push('Hors classement');
  if (res.warnings.includes('Heure corrigée manuellement')) bits.push('Heure corrigée manuellement');
  return bits.join(' ; ');
}

async function downloadXlsx(filename, sheets) {
  const res = await fetch('/api/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, sheets }),
  });
  if (!res.ok) throw new Error(`Création du fichier Excel impossible (erreur ${res.status}).`);
  downloadFile(filename, await res.blob());
}

/** Classeur Excel des résultats : un onglet par section (score) ou par catégorie (classique). */
export function excelSheets() {
  const d = getDerived();
  const score = isScoreMode(store.event);
  const sheets = [];
  for (const g of d.groups) {
    let rows = g.rows.filter((r) => r.comp.lastName || r.comp.firstName || r.res.readId);
    if (!rows.length) continue;
    if (score) {
      rows = [...rows].sort((a, b) => compareText(a.comp.lastName || '~', b.comp.lastName || '~') || compareText(a.comp.firstName, b.comp.firstName));
      sheets.push({
        name: g.name,
        columns: [
          { title: 'Nom', width: 24 },
          { title: 'Prénom', width: 18 },
          { title: 'Temps', width: 10, type: 'duration' },
          { title: 'Balises validées', width: 15, type: 'number' },
          { title: 'Balises manquantes', width: 26 },
          { title: 'Note /20', width: 10, type: 'note' },
          { title: 'Remarques', width: 62 },
        ],
        rows: rows.map(({ comp, res }) => [
          comp.lastName || '',
          comp.firstName || '',
          res.status === 'RUN' || res.status === 'DNS' ? null : res.time,
          res.readId ? res.validated : null,
          res.readId ? res.missing.join(', ') : '',
          res.note,
          remarkFor(comp, res),
        ]),
      });
    } else {
      sheets.push({
        name: g.name,
        columns: [
          { title: 'Place', width: 8, type: 'number' },
          { title: 'Nom', width: 22 },
          { title: 'Prénom', width: 18 },
          { title: 'Club', width: 24 },
          { title: 'Temps', width: 11, type: 'duration' },
          { title: 'Statut', width: 14 },
          { title: 'Puce', width: 11, type: 'number' },
        ],
        rows: rows.map(({ comp, res, place }) => [place, comp.lastName, comp.firstName, comp.club, res.time, STATUS_LABEL[res.status], comp.card ?? null]),
      });
    }
  }
  return sheets;
}

export async function exportExcel() {
  const score = isScoreMode(store.event);
  await downloadXlsx(`${base()}-${score ? 'notes' : 'resultats'}.xlsx`, excelSheets());
}

// --- Temps intermédiaires ---------------------------------------------------------------
const SPLIT_CSS = `
.sp td,.sp th{font-size:7.5pt;padding:.6mm 1mm}
.sp td.c{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.25}
.sp td.c b{font-weight:600}
.sp .leg{color:#555}
.sp .best{color:#0a7d3e;font-weight:700}
.sp th.c{text-align:right}
`;

export function splitsHtml({ classIds = null } = {}) {
  const d = getDerived();
  let body = header('Temps intermédiaires');
  for (const cls of sortedClasses(classIds)) {
    const ranking = d.classes.get(cls.id);
    const course = store.courses.get(cls.courseId);
    const rows = (ranking?.rows || []).filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS');
    if (!rows.length || !course) continue;
    const controls = course.controls || [];
    body += `<section class="cls"><h2>${e(cls.name)} <small>${e(courseInfo(course))}</small></h2><table class="sp"><thead><tr><th class="num">Pl.</th><th>Nom</th><th class="num">Temps</th>`;
    controls.forEach((code, i) => (body += `<th class="c">${i + 1}<br><span class="muted">${code}</span></th>`));
    body += '<th class="c">A</th></tr></thead><tbody>';
    for (const row of rows) {
      body += `<tr><td class="num">${placeCell(row)}</td><td>${e(personName(row.comp))}<br><span class="muted">${e(row.comp.club)}</span></td><td class="num">${
        row.res.status === 'OK' ? fmtDuration(row.res.time) : statusCell(row)
      }</td>`;
      controls.forEach((_, i) => {
        const sp = row.res.splits[i];
        if (!sp || sp.missing) return (body += '<td class="c st-mp">—</td>');
        const best = sp.legRank === 1 ? ' best' : '';
        body += `<td class="c"><b>${fmtDuration(sp.cumul)}</b><br><span class="leg${best}">${fmtDuration(sp.leg)}${
          sp.legRank ? ` (${sp.legRank})` : ''
        }</span></td>`;
      });
      const fl = row.res.finishLeg;
      body += `<td class="c"><b>${fmtDuration(row.res.time)}</b><br><span class="leg${row.res.finishLegRank === 1 ? ' best' : ''}">${fmtDuration(fl)}</span></td></tr>`;
    }
    body += '</tbody></table></section>';
  }
  return documentHtml(`Temps intermédiaires — ${store.event?.name || ''}`, body + footer(), SPLIT_CSS + PAGE_LANDSCAPE);
}

// --- Listes de départ ------------------------------------------------------------------
export function startListHtml({ classIds = null, byTime = false } = {}) {
  let body = header('Liste de départ');
  const comps = [...store.competitors.values()].filter((c) => !classIds || classIds.includes(c.classId));
  const cmp = (a, b) => (a.startTime ?? 1e9) - (b.startTime ?? 1e9) || compareText(a.lastName, b.lastName);
  if (byTime) {
    body += '<table><thead><tr><th class="num">Départ</th><th>Nom</th><th>Club</th><th>Catégorie</th><th class="num">Puce</th><th class="num">Dossard</th></tr></thead><tbody>';
    for (const c of comps.sort(cmp)) {
      body += `<tr><td class="num">${fmtClock(c.startTime)}</td><td>${e(personName(c))}</td><td>${e(c.club)}</td><td>${e(
        store.classes.get(c.classId)?.name || ''
      )}</td><td class="num">${e(c.card || '')}</td><td class="num">${e(c.bib || '')}</td></tr>`;
    }
    body += '</tbody></table>';
  } else {
    for (const cls of sortedClasses(classIds)) {
      const list = comps.filter((c) => c.classId === cls.id).sort(cmp);
      if (!list.length) continue;
      body += `<section class="cls"><h2>${e(cls.name)} <small>${e(courseInfo(store.courses.get(cls.courseId)))} · ${list.length} coureur${
        list.length > 1 ? 's' : ''
      }</small></h2><table><thead><tr><th class="num">Départ</th><th>Nom</th><th>Club</th><th class="num">Puce</th><th class="num">Dossard</th></tr></thead><tbody>`;
      for (const c of list) {
        body += `<tr><td class="num">${fmtClock(c.startTime)}</td><td>${e(personName(c))}</td><td>${e(c.club)}</td><td class="num">${e(
          c.card || ''
        )}${c.rented ? ' <span class="muted">(louée)</span>' : ''}</td><td class="num">${e(c.bib || '')}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }
  }
  return documentHtml(`Départs — ${store.event?.name || ''}`, body + footer(), PAGE_A4);
}

// --- Ticket de temps intermédiaires (imprimante 80 mm) ------------------------------------
const TICKET_CSS = `
@page{margin:3mm}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:9.5pt;width:72mm;padding:0;margin:0 auto}
@media screen{body{padding:8px;max-width:76mm}}
.ev{font-size:8.5pt;color:#333;border-bottom:.5pt solid #000;padding-bottom:1mm;margin-bottom:1.5mm}
.name{font-size:12.5pt;font-weight:700}
.meta{font-size:8.5pt;color:#333}
.big{font-size:20pt;font-weight:700;margin:1.5mm 0 0;font-variant-numeric:tabular-nums}
.res{font-size:10pt;font-weight:600;margin-bottom:2mm}
.warn{font-weight:700;border:1pt solid #000;padding:1mm;margin:1mm 0}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
td{padding:.35mm .8mm;font-size:8.5pt;border-bottom:.2pt dotted #999}
td.r{text-align:right}
.foot{font-size:7.5pt;color:#333;margin-top:2mm}
`;

export function ticketHtml(readId) {
  const read = store.cards.get(readId);
  if (!read) return null;
  const d = getDerived();
  const comp = read.competitorId ? store.competitors.get(read.competitorId) : null;
  const ev = store.event || {};
  let body = `<div class="ev">${e(ev.name || '')}${ev.date ? ' · ' + e(new Date(ev.date + 'T12:00').toLocaleDateString('fr-FR')) : ''}</div>`;
  if (!comp) {
    body += `<div class="name">Puce ${e(read.number)}</div><div class="meta">Coureur inconnu — présentez-vous à l'arbitrage.</div>`;
    return documentHtml('Ticket', body, TICKET_CSS);
  }
  const res = d.results.get(comp.id);
  const row = d.rowByComp.get(comp.id);
  const cls = store.classes.get(comp.classId);
  const ranked = row?.ranked ?? 0;
  const score = isScoreMode(store.event);
  const group = score ? (comp.section ? sectionLabel(comp.section) : '') : cls?.name;
  body += `<div class="name">${e(personName(comp))}</div><div class="meta">${e([group, score ? '' : comp.club, `Puce ${read.number}`].filter(Boolean).join(' · '))}</div>`;
  if (score && res.note != null) {
    body += `<div class="big">${res.note} / 20</div><div class="res">Temps ${fmtDuration(res.time)} · ${res.validated}/${res.totalControls} balises</div>`;
    body += `<table><tr><td>Note de temps</td><td class="r">${res.score.base}</td></tr>${res.score.penalties
      .map((p) => `<tr><td>${e(p.label)}</td><td class="r">-${p.points}</td></tr>`)
      .join('')}<tr><td><b>Note finale</b></td><td class="r"><b>${res.note}</b></td></tr></table>`;
  } else {
    body += `<div class="big">${res.time != null ? fmtDuration(res.time) : '—'}</div>`;
    if (res.status === 'OK') body += `<div class="res">${comp.nc ? 'Hors classement' : `Classement provisoire : ${row?.place ?? '?'} / ${ranked}`}</div>`;
    else body += `<div class="res">${e(STATUS_LABEL[res.status])}</div>`;
  }
  if (res.missing.length) body += `<div class="warn">${score ? 'Balise' : 'Poste'}${res.missing.length > 1 ? 's' : ''} manquant${score ? 'e' : ''}${res.missing.length > 1 ? 's' : ''} : ${res.missing.join(', ')}</div>`;
  if (score && res.first?.ok === false) body += `<div class="warn">1re balise imposée : ${res.first.expected} (poinçonnée : ${res.first.punched ?? 'aucune'})</div>`;
  if (comp.rented) body += '<div class="warn">Puce prêtée : merci de la rendre</div>';
  body += '<table>';
  for (const sp of res.splits) {
    body += sp.missing
      ? `<tr><td>${sp.n}</td><td>${sp.code}</td><td class="r" colspan="2">manquant</td></tr>`
      : `<tr><td>${sp.n}</td><td>${sp.code}</td><td class="r">${fmtDuration(sp.cumul)}</td><td class="r">${fmtDuration(sp.leg)}</td></tr>`;
  }
  if (res.finish != null) body += `<tr><td>A</td><td></td><td class="r">${fmtDuration(res.time)}</td><td class="r">${fmtDuration(res.finishLeg)}</td></tr>`;
  body += '</table>';
  body += `<div class="foot">Départ ${fmtClock(res.start) || '—'} · Arrivée ${fmtClock(res.finish) || '—'}<br>Lu le ${new Date(read.readAt).toLocaleString(
    'fr-FR'
  )}</div>`;
  return documentHtml('Ticket', body, TICKET_CSS);
}

// --- Impression -------------------------------------------------------------------------
export function printHtml(html) {
  if (!html) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  setTimeout(() => {
    try {
      iframe.contentWindow.onafterprint = cleanup;
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      cleanup();
    }
    setTimeout(() => iframe.isConnected && iframe.remove(), 60000);
  }, 120);
}

export function printTicket(readId) {
  printHtml(ticketHtml(readId));
}

// --- Exports -----------------------------------------------------------------------------
const base = () => slug(store.event?.name);

export function exportResultsHtml(opts) {
  downloadFile(`${base()}-resultats.html`, resultsHtml(opts), 'text/html;charset=utf-8');
}

export function exportSplitsHtml(opts) {
  downloadFile(`${base()}-temps-intermediaires.html`, splitsHtml(opts), 'text/html;charset=utf-8');
}

export function exportResultsXml() {
  downloadFile(`${base()}-resultats-iof.xml`, resultListXml(store, getDerived()), 'application/xml;charset=utf-8');
}

export function exportResultsCsv() {
  const d = getDerived();
  const rows = [['Catégorie', 'Place', 'Nom', 'Prénom', 'Club', 'Puce', 'Dossard', 'Départ', 'Arrivée', 'Temps', 'Écart', 'Statut']];
  for (const cls of sortedClasses(null)) {
    for (const row of d.classes.get(cls.id)?.rows || []) {
      const { comp, res } = row;
      rows.push([
        cls.name,
        row.place ?? (res.status === 'OK' && comp.nc ? 'NC' : ''),
        comp.lastName,
        comp.firstName,
        comp.club,
        comp.card ?? '',
        comp.bib ?? '',
        fmtClock(res.start),
        fmtClock(res.finish),
        fmtDuration(res.time),
        row.place != null ? fmtBehind(row.behind) : '',
        STATUS_LABEL[res.status],
      ]);
    }
  }
  downloadFile(`${base()}-resultats.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

export function exportStartListCsv() {
  const rows = [['Départ', 'Nom', 'Prénom', 'Club', 'Catégorie', 'Puce', 'Dossard']];
  const comps = [...store.competitors.values()].sort((a, b) => (a.startTime ?? 1e9) - (b.startTime ?? 1e9));
  for (const c of comps) {
    rows.push([fmtClock(c.startTime), c.lastName, c.firstName, c.club, store.classes.get(c.classId)?.name || '', c.card ?? '', c.bib ?? '']);
  }
  downloadFile(`${base()}-departs.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

export function exportCompetitorsCsv() {
  const rows = [['Nom', 'Prénom', 'Club', 'Catégorie', 'Puce', 'Puce louée', 'Dossard', 'Départ', 'Licence']];
  for (const c of [...store.competitors.values()].sort((a, b) => compareText(a.lastName, b.lastName))) {
    rows.push([c.lastName, c.firstName, c.club, store.classes.get(c.classId)?.name || '', c.card ?? '', c.rented ? 'X' : '', c.bib ?? '', fmtClock(c.startTime), c.licence ?? '']);
  }
  downloadFile(`${base()}-coureurs.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

/** Fichier complet de l'épreuve (sauvegarde / transfert vers un autre ordinateur). */
export function exportEventFile() {
  const payload = {
    format: 'balise-epreuve',
    version: 1,
    exportedAt: new Date().toISOString(),
    event: store.event,
    docs: {
      course: [...store.courses.values()],
      class: [...store.classes.values()],
      competitor: [...store.competitors.values()],
      card: [...store.cards.values()],
    },
  };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadFile(`${base()}_${stamp}.balise.json`, JSON.stringify(payload, null, 1), 'application/json');
}
