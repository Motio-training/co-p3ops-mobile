// Écran d'affichage des résultats (téléviseur, second écran, tablette…).
// Course au score : podium des 3 premiers, classement des autres, et en bas la dernière puce lue.
// Course en ligne : résultats par catégorie.
import { html, useEffect, useRef, useState } from '../../lib.js';
import { getDerived, openEvent } from '../../core/store.js';
import { personName } from '../../core/util.js';
import { fmtDuration } from '../../core/time.js';
import { STATUS_LABEL, isScoreMode, sectionLabel } from '../../domain/results.js';
import { Icon, Logo } from '../icons.js';
import { Spinner } from '../components.js';
import { useNow, useStore } from '../hooks.js';
import { getPref } from '../../core/prefs.js';

function useSize() {
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const f = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, []);
  return size;
}

/** Le curseur et le bouton plein écran disparaissent après 3 s sans mouvement de souris. */
function useChrome() {
  const [chrome, setChrome] = useState(true);
  useEffect(() => {
    let t;
    const f = () => {
      setChrome(true);
      clearTimeout(t);
      t = setTimeout(() => setChrome(false), 3000);
    };
    f();
    addEventListener('mousemove', f);
    return () => {
      clearTimeout(t);
      removeEventListener('mousemove', f);
    };
  }, []);
  return chrome;
}

/** Page affichée, qui change toutes les N secondes quand tout ne tient pas sur l'écran. */
function useRotation() {
  const [page, setPage] = useState(0);
  const pagesRef = useRef(1);
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % Math.max(1, pagesRef.current)), (getPref('displayInterval') || 12) * 1000);
    return () => clearInterval(t);
  }, []);
  return [page, pagesRef];
}

const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
const sectionOf = (comp) => sectionLabel(String(comp.section || '').trim());

export function DisplayPage({ eventId }) {
  const s = useStore();
  useEffect(() => {
    openEvent(eventId);
  }, [eventId]);
  if (s.status !== 'ready' || s.eventId !== eventId) {
    return html`<div class="display display-center">${s.status === 'error' ? html`<p>${s.error}</p>` : html`<${Spinner} label="Chargement…" />`}</div>`;
  }
  return isScoreMode(s.event) ? html`<${ScoreDisplay} />` : html`<${ClassicDisplay} />`;
}

// --- Course au score ---------------------------------------------------------------------------------
function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function PodiumStep({ row, rank }) {
  if (!row) return html`<div class=${'podium-step empty p' + rank}><div class="podium-block"><span class="podium-place">${rank}</span></div></div>`;
  return html`<div class=${'podium-step p' + rank}>
    <div class="podium-person">
      <strong>${personName(row.comp)}</strong>
      <span>${sectionOf(row.comp)}</span>
    </div>
    <div class="podium-block">
      <span class="podium-place">${row.place}</span>
      <span class="podium-note">${row.res.note}<small>/20</small></span>
      <span class="podium-time mono">${fmtDuration(row.res.time)}</span>
    </div>
  </div>`;
}

/** Bandeau du bas : la dernière puce passée dans le lecteur. */
function LastRead() {
  const s = useStore();
  const d = getDerived();
  const latest = [...s.cards.values()].sort((a, b) => b.readAt - a.readAt)[0];
  if (!latest) {
    return html`<footer class="last-read idle"><div class="last-who"><span class="last-label">Dernière puce lue</span><span>En attente de la première arrivée…</span></div></footer>`;
  }
  const comp = latest.competitorId ? s.competitors.get(latest.competitorId) : null;
  const res = comp && d.readsByComp.get(comp.id)?.id === latest.id ? d.results.get(comp.id) : null;
  const at = new Date(latest.readAt).toLocaleTimeString('fr-FR').slice(0, 5);
  if (!res) {
    return html`<footer class="last-read unknown" key=${latest.id}>
      <div class="last-who"><span class="last-label">Dernière puce lue · ${at}</span><strong>Puce ${latest.number}</strong><span>À traiter à la table de lecture</span></div>
    </footer>`;
  }
  const ok = res.status === 'OK' && res.note != null;
  // 1re balise : celle poinçonnée en premier par le coureur, en vert si c'est la balise imposée, en rouge sinon
  const first = res.first || {};
  const firstClass = first.ok === true ? 'last-good' : first.ok === false ? 'last-bad' : '';
  return html`<footer class="last-read" key=${latest.id}>
    <div class="last-who">
      <span class="last-label">Dernière puce lue · ${at}</span>
      <strong>${personName(comp)}</strong>
      <span>${sectionOf(comp)} · Puce <span class="mono">${latest.number}</span></span>
    </div>
    <div class="last-fact"><span>Balises validées</span><b>${res.validated ?? 0} / ${res.totalControls}</b></div>
    <div class="last-fact wide">
      <span>Postes manquants</span>
      ${res.missing.length ? html`<b class="last-missing">${res.missing.map((c) => html`<span class="d-chip">${c}</span>`)}</b>` : html`<b class="last-none">aucun</b>`}
    </div>
    <div class="last-fact">
      <span>Première balise</span>
      <b class=${firstClass}>${first.punched ?? '—'}</b>
      ${first.ok === false && first.expected != null && html`<small class="last-expected">imposée : ${first.expected}</small>`}
    </div>
    <div class="last-fact"><span>Temps</span><b class="mono">${res.time != null ? fmtDuration(res.time) : '—'}</b></div>
    <div class=${'last-note' + (ok ? '' : ' bad')}>${ok ? html`${res.note}<small>/20</small>` : html`<span class="last-status">${STATUS_LABEL[res.status]}</span>`}</div>
  </footer>`;
}

function ScoreDisplay() {
  const d = getDerived();
  const { w, h } = useSize();
  const chrome = useChrome();
  const [page, pagesRef] = useRotation();

  // Classement général : meilleure note, puis meilleur temps (les non-arrivés n'apparaissent pas)
  const rows = d.overall.rows.filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS');
  const podium = rows.filter((r) => r.place != null).slice(0, 3);
  const rest = rows.filter((r) => !podium.includes(r));
  const cols = w >= 1700 ? 3 : w >= 1100 ? 2 : 1;
  const rowH = h >= 1000 ? 48 : 42;
  const podiumH = h >= 900 ? 300 : 260;
  const perCol = Math.max(3, Math.floor((h - podiumH - 130 - 40) / (rowH + 4)));
  const pages = chunk(rest, perCol * cols);
  pagesRef.current = pages.length;
  const current = pages[page % Math.max(1, pages.length)] || [];

  return html`<div class=${'display score-display' + (chrome ? '' : ' no-cursor')}>
    <button class=${'display-fs floating' + (chrome ? '' : ' hidden')} onClick=${toggleFs} title="Plein écran"><${Icon} name="maximize" size=${20} /></button>
    <section class="podium" style=${`height:${podiumH}px`}>
      ${rows.length
        ? html`<${PodiumStep} row=${podium[1]} rank=${2} /><${PodiumStep} row=${podium[0]} rank=${1} /><${PodiumStep} row=${podium[2]} rank=${3} />`
        : html`<div class="display-empty">Le classement s'affichera ici dès les premières arrivées.</div>`}
    </section>
    <main class="rank-list" style=${`grid-template-columns:repeat(${cols},1fr)`}>
      ${chunk(current, perCol).map(
        (col, ci) => html`<div class="rank-col" key=${page + '-' + ci}>
          ${col.map(
            (row) => html`<div class="rank-row" style=${`height:${rowH}px`} key=${row.comp.id}>
              <span class="d-pl">${row.place ?? ''}</span>
              <span class="d-name">${personName(row.comp)}<small>${sectionOf(row.comp)}</small></span>
              <span class="d-sub mono">${row.res.status === 'OK' ? fmtDuration(row.res.time) : ''}</span>
              <span class="d-time mono">${row.res.status === 'OK' && row.res.note != null
                ? html`${row.res.note}<small class="d-unit">/20</small>`
                : html`<span class="d-st">${STATUS_LABEL[row.res.status]}</span>`}</span>
            </div>`
          )}
        </div>`
      )}
      ${pages.length > 1 && html`<span class="display-pages corner">${(page % pages.length) + 1} / ${pages.length}</span>`}
    </main>
    <${LastRead} />
  </div>`;
}

// --- Course en ligne ---------------------------------------------------------------------------------
function ClassicDisplay() {
  const s = useStore();
  const now = useNow(1000);
  const { w, h } = useSize();
  const chrome = useChrome();
  const [page, pagesRef] = useRotation();
  const d = getDerived();
  const cols = w >= 1700 ? 3 : w >= 1050 ? 2 : 1;
  const rowH = w >= 1700 ? 44 : 40;
  const perCol = Math.max(5, Math.floor((h - 96 - 64 - 44) / rowH)); // hauteur utile en lignes
  const HEAD = 1.5; // hauteur d'un titre de catégorie, en lignes
  const GAP = 0.6; // espace entre deux catégories

  // Remplissage des colonnes (plusieurs petites catégories par colonne), puis des pages
  const columns = [];
  let col = [];
  let used = 0;
  for (const g of d.groups) {
    const cls = g;
    const rows = g.rows.filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS');
    let i = 0;
    while (i < rows.length) {
      const room = Math.floor(perCol - used - HEAD);
      if (col.length && room < Math.min(3, rows.length - i)) {
        columns.push(col);
        col = [];
        used = 0;
        continue;
      }
      const take = Math.max(1, Math.min(rows.length - i, room));
      col.push({ cls, rows: rows.slice(i, i + take), part: i > 0, total: rows.length });
      used += HEAD + take + GAP;
      i += take;
    }
  }
  if (col.length) columns.push(col);
  const pages = [];
  for (let i = 0; i < columns.length; i += cols) pages.push(columns.slice(i, i + cols));
  pagesRef.current = pages.length;
  const current = pages[page % Math.max(1, pages.length)] || [];

  const latest = [...s.cards.values()]
    .filter((r) => r.competitorId && s.competitors.has(r.competitorId) && d.readsByComp.get(r.competitorId)?.id === r.id)
    .sort((a, b) => b.readAt - a.readAt)
    .slice(0, 6);

  return html`<div class=${'display' + (chrome ? '' : ' no-cursor')}>
    <header class="display-head">
      <div class="display-brand"><${Logo} size=${34} /><div><h1>${s.event.name}</h1><span>Résultats provisoires</span></div></div>
      <div class="display-right">
        ${pages.length > 1 && html`<span class="display-pages">${(page % pages.length) + 1} / ${pages.length}</span>`}
        <span class="display-clock mono">${new Date(now).toLocaleTimeString('fr-FR')}</span>
        <button class=${'display-fs' + (chrome ? '' : ' hidden')} onClick=${toggleFs} title="Plein écran"><${Icon} name="maximize" size=${20} /></button>
      </div>
    </header>
    <main class="display-grid" style=${`grid-template-columns:repeat(${cols},1fr)`}>
      ${current.length
        ? current.map(
            (column, ci) => html`<div class="display-col" key=${page + '-' + ci}>
              ${column.map(
                (chunkItem) => html`<section class="display-class" key=${chunkItem.cls.id + (chunkItem.part ? '-suite' : '')}>
                  <h2>${chunkItem.cls.name}${chunkItem.part ? html`<small>(suite)</small>` : ''}<span>${chunkItem.total}</span></h2>
                  <table>
                    <tbody>
                      ${chunkItem.rows.map(
                        (row) => html`<tr style=${`height:${rowH}px`}>
                          <td class="d-pl">${row.place ?? ''}</td>
                          <td class="d-name">${personName(row.comp)}<small>${row.comp.club}</small></td>
                          <td class="d-time mono">
                            ${row.res.status === 'OK' && row.comp.nc && html`<span class="d-st">NC </span>`}
                            ${row.res.status === 'OK' ? fmtDuration(row.res.time) : html`<span class="d-st">${STATUS_LABEL[row.res.status]}</span>`}
                          </td>
                        </tr>`
                      )}
                    </tbody>
                  </table>
                </section>`
              )}
            </div>`
          )
        : html`<div class="display-empty">Les résultats s'afficheront ici dès les premières arrivées.</div>`}
    </main>
    <footer class="display-ticker">
      <span class="ticker-label">Dernières arrivées</span>
      ${latest.map((r) => {
        const c = s.competitors.get(r.competitorId);
        const res = d.results.get(c.id);
        const row = d.rowByComp.get(c.id);
        const detail = [s.classes.get(c.classId)?.name, res.status === 'OK' ? fmtDuration(res.time) : STATUS_LABEL[res.status], row?.place && (row.place === 1 ? '1er' : `${row.place}e`)]
          .filter(Boolean)
          .join(' · ');
        return html`<span class="ticker-item" key=${r.id}><b>${personName(c)}</b> ${detail}</span>`;
      })}
    </footer>
  </div>`;
}
