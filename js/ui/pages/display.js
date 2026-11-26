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
// Podium fixe en haut, liste des autres arrivés qui défile, et en bas le bandeau du coureur affiché :
// le dernier qui a passé (ou repassé) sa puce, ou celui sur lequel on a cliqué. Les flèches du bandeau
// permettent de revenir aux coureurs précédents, puis de revenir vers le plus récent.

const Chevron = ({ dir }) =>
  html`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d=${dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} /></svg>`;

function PodiumStep({ row, rank, selected, onPick }) {
  if (!row) {
    return html`<div class=${'podium-step empty p' + rank}>
      <div class="podium-person"><span class="podium-rank">${rank}</span></div>
      <div class="podium-block"></div>
    </div>`;
  }
  return html`<button type="button" class=${'podium-step p' + rank + (selected ? ' selected' : '')} onClick=${() => onPick(row.comp.id)} title="Afficher dans le bandeau">
    <div class="podium-person">
      <span class="podium-rank">${row.place}</span>
      <strong>${personName(row.comp)}</strong>
      <span>${sectionOf(row.comp)}</span>
    </div>
    <div class="podium-block">
      <span class="podium-time mono">${fmtDuration(row.res.time)}</span>
      <span class="podium-note">${row.res.note}<small>/20</small></span>
    </div>
  </button>`;
}

/** Coureur concerné par une lecture : celui de la lecture, sinon le seul inscrit avec ce numéro de puce. */
function compForRead(s, read) {
  if (!read) return null;
  if (read.competitorId && s.competitors.has(read.competitorId)) return read.competitorId;
  const owners = [...s.competitors.values()].filter((c) => Number(c.card) === Number(read.number));
  return owners.length === 1 ? owners[0].id : null;
}

/**
 * Historique du bandeau, du plus ancien au plus récent : chaque lecture de puce (et la dernière
 * relecture), plus les coureurs choisis d'un clic sur l'écran.
 */
function bannerHistory(s, picks) {
  const items = [];
  for (const r of s.cards.values()) {
    if (r.archived) continue;
    items.push({ key: 'r' + r.id, t: r.readAt, readId: r.id, kind: 'read' });
    if (r.rereadAt) items.push({ key: 'rr' + r.id + r.rereadAt, t: r.rereadAt, readId: r.id, kind: 'reread' });
  }
  for (const p of picks) items.push({ key: p.key, t: p.t, compId: p.compId, kind: 'pick' });
  return items.sort((a, b) => a.t - b.t);
}

/** Bandeau du bas : le coureur affiché, avec flèches précédent / suivant. */
function Banner({ item, index, count, onPrev, onNext }) {
  const s = useStore();
  const d = getDerived();
  const frame = (content, cls = '') => html`<footer class=${'last-read' + cls} key=${item ? item.key : 'idle'}>
    <button type="button" class="last-nav" onClick=${onPrev} disabled=${!count || index <= 0} title="Coureur précédent"><${Chevron} dir="left" /></button>
    ${content}
    <button type="button" class="last-nav" onClick=${onNext} disabled=${!count || index >= count - 1} title="Coureur suivant"><${Chevron} dir="right" /></button>
    ${count > 1 && html`<span class="last-pos">${index + 1} / ${count}</span>`}
  </footer>`;

  if (!item) return frame(html`<div class="last-who"><span class="last-label">Dernière puce lue</span><span>En attente de la première arrivée…</span></div>`, ' idle');

  const read = item.readId ? s.cards.get(item.readId) : null;
  const compId = item.compId || compForRead(s, read);
  const comp = compId ? s.competitors.get(compId) : null;
  const active = comp ? d.readsByComp.get(comp.id) : null;
  const res = active ? d.results.get(comp.id) : null;
  const clock = (t) => new Date(t).toLocaleTimeString('fr-FR').slice(0, 5);
  const label =
    item.kind === 'pick'
      ? `Coureur sélectionné${active ? ` · puce lue à ${clock(active.rereadAt || active.readAt)}` : ''}`
      : item.kind === 'reread'
        ? `Puce relue · ${clock(item.t)}`
        : `Puce lue · ${clock(item.t)}`;

  if (!res) {
    return frame(
      html`<div class="last-who"><span class="last-label">${label}</span><strong>Puce ${read?.number ?? '—'}</strong><span>À traiter à la table de lecture</span></div>`,
      ' unknown'
    );
  }
  const ok = res.status === 'OK' && res.note != null;
  // 1re balise : celle poinçonnée en premier par le coureur, en vert si c'est la balise imposée, en rouge sinon
  const first = res.first || {};
  const firstClass = first.ok === true ? 'last-good' : first.ok === false ? 'last-bad' : '';
  return frame(html`
    <div class="last-who">
      <span class="last-label">${label}</span>
      <strong>${personName(comp)}</strong>
      <span>${sectionOf(comp)} · Puce <span class="mono">${active.number}</span></span>
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
  `);
}

function ScoreDisplay() {
  const s = useStore();
  const d = getDerived();
  const { w, h } = useSize();
  const chrome = useChrome();
  const [picks, setPicks] = useState([]); // coureurs choisis d'un clic
  const [pos, setPos] = useState(null); // position dans l'historique du bandeau (null : le plus récent)

  const history = bannerHistory(s, picks);
  const lastKey = history.length ? history[history.length - 1].key : '';
  // Une nouvelle lecture (ou un clic) ramène le bandeau sur le plus récent.
  useEffect(() => setPos(null), [lastKey]);
  const index = pos == null ? history.length - 1 : Math.min(pos, history.length - 1);
  const item = history[index] || null;
  const shownComp = item ? item.compId || compForRead(s, item.readId ? s.cards.get(item.readId) : null) : null;

  const pick = (compId) => setPicks((list) => [...list.slice(-199), { key: `p${Date.now()}-${list.length}`, t: Date.now(), compId }]);
  const prev = () => setPos(Math.max(0, index - 1));
  const next = () => setPos(index + 1 >= history.length - 1 ? null : index + 1);

  // Classement général : meilleure note, puis meilleur temps (les non-arrivés n'apparaissent pas)
  const rows = d.overall.rows.filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS');
  const podium = rows.filter((r) => r.place != null).slice(0, 3);
  const rest = rows.filter((r) => !podium.includes(r));
  // Tailles proportionnelles à l'écran (tablette, PC, téléviseur)
  const cols = w >= 1700 ? 3 : w >= 1000 ? 2 : 1;
  const rowH = Math.round(Math.min(70, Math.max(40, h * 0.055)));
  const podiumH = Math.round(Math.min(460, Math.max(220, h * 0.36)));
  // Compteurs : arrivés et encore sur le circuit (personnes inscrites avec une puce)
  const comps = [...s.competitors.values()].filter((c) => (c.lastName || c.firstName) && c.card && c.status !== 'DNS');
  const out = comps.filter((c) => !d.readsByComp.has(c.id)).length;

  return html`<div class=${'display score-display' + (chrome ? '' : ' no-cursor')} style=${`--row-h:${rowH}px`}>
    <button class=${'display-fs floating' + (chrome ? '' : ' hidden')} onClick=${toggleFs} title="Plein écran"><${Icon} name="maximize" size=${20} /></button>
    <div class="display-count">
      <span><b>${rows.length}</b> arrivé${rows.length > 1 ? 's' : ''}</span>
      ${comps.length > 0 && html`<span class=${out ? 'on-course' : 'all-in'}>${out ? html`<b>${out}</b> sur le circuit` : 'Tout le monde est rentré'}</span>`}
    </div>
    <section class="podium" style=${`height:${podiumH}px`}>
      ${rows.length
        ? [2, 1, 3].map(
            (rank) => html`<${PodiumStep} key=${rank} row=${podium[rank - 1]} rank=${rank} selected=${!!podium[rank - 1] && podium[rank - 1].comp.id === shownComp} onPick=${pick} />`
          )
        : html`<div class="display-empty">Le classement s'affichera ici dès les premières arrivées.</div>`}
    </section>
    <main class="rank-list" style=${`grid-template-columns:repeat(${cols},minmax(0,1fr))`}>
      ${rest.length > 0 &&
      Array.from(
        { length: Math.min(cols, rest.length) },
        (_, i) => html`<div class="rank-head" key=${'h' + i}><span class="d-pl">Rg</span><span class="d-name">Nom · section</span><span class="d-sub">Temps</span><span class="d-time">Note</span></div>`
      )}
      ${rest.map(
        (row) => html`<button type="button" key=${row.comp.id} class=${'rank-row' + (row.comp.id === shownComp ? ' selected' : '')} onClick=${() => pick(row.comp.id)}>
          <span class="d-pl">${row.place ?? ''}</span>
          <span class="d-name">${personName(row.comp)}<small>${sectionOf(row.comp)}</small></span>
          <span class="d-sub mono">${row.res.status === 'OK' ? fmtDuration(row.res.time) : ''}</span>
          <span class="d-time mono">${row.res.status === 'OK' && row.res.note != null
            ? html`${row.res.note}<small class="d-unit">/20</small>`
            : html`<span class="d-st">${STATUS_LABEL[row.res.status]}</span>`}</span>
        </button>`
      )}
    </main>
    <${Banner} item=${item} index=${index} count=${history.length} onPrev=${prev} onNext=${next} />
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
