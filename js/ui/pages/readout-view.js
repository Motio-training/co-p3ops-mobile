// Affichage d'une lecture de puce : résultat, temps intermédiaires, attribution.
import { html, useState } from '../../lib.js';
import { confirmDialog } from '../../core/bus.js';
import { delOp, getDerived, mutate, put, store } from '../../core/store.js';
import { norm, ordinal, personName } from '../../core/util.js';
import { fmtBehind, fmtClock, fmtDuration } from '../../core/time.js';
import { cardTimes, isScoreMode, sectionLabel, suggestCourses } from '../../domain/results.js';
import { CARD_LABELS } from '../../sportident/constants.js';
import { archiveRead, assignRead, courseFromRead, createCompetitorFromRead } from '../../core/readout.js';
import { printTicket } from '../../io/reports.js';
import { Badge, Button, Field, Icon, Modal, SearchInput, StatusPill } from '../components.js';
import { ClubDatalist, CompetitorModal } from './competitors.js';
import { sortedClasses } from './classes.js';

// Heure incohérente (horloge de boîtier mal réglée) : on n'affiche pas de durée négative.
const dur = (v) => (v == null ? '' : v < 0 ? '?' : fmtDuration(v));

export function SplitsTable({ res, compact }) {
  if (!res.splits.length && !res.extra.length) return null;
  const score = isScoreMode(store.event);
  const clockIssue = res.splits.some((sp) => sp.time == null || sp.cumul < 0 || sp.leg < 0);
  return html`<div class=${'splits' + (compact ? ' compact' : '')}>
    <table class="table table-tight">
      <thead><tr><th class="num">#</th><th class="num">${score ? 'Balise' : 'Poste'}</th><th class="num">Heure</th><th class="num">Cumul</th><th class="num">Partiel</th>${!score && html`<th class="num">Rg</th>`}</tr></thead>
      <tbody>
        <tr class="muted"><td class="num">D</td><td></td><td class="num mono">${fmtClock(res.start)}</td><td></td><td></td>${!score && html`<td></td>`}</tr>
        ${res.splits.map((sp) =>
          sp.missing
            ? html`<tr class="row-missing"><td class="num">${sp.n}</td><td class="num"><strong>${sp.code}</strong></td><td colspan="4">Poste manquant</td></tr>`
            : html`<tr>
                <td class="num">${sp.n}</td>
                <td class="num"><strong>${sp.code}</strong>${score && sp.n === 1 && res.first?.expected != null
                  ? html` <span class=${res.first.ok ? 'text-ok' : 'text-err'} title=${res.first.ok ? '1re balise respectée' : `1re balise imposée : ${res.first.expected}`}>${res.first.ok ? '✓' : '✗'}</span>`
                  : ''}</td>
                <td class="num mono muted">${sp.time == null ? 'sans heure' : fmtClock(sp.time)}</td>
                <td class="num mono">${dur(sp.cumul)}</td>
                <td class=${'num mono' + (sp.legRank === 1 ? ' best' : '')}>${dur(sp.leg)}</td>
                ${!score && html`<td class="num muted">${sp.legRank || ''}</td>`}
              </tr>`
        )}
        <tr class="row-finish">
          <td class="num">A</td><td></td>
          <td class="num mono muted">${fmtClock(res.finish)}</td>
          <td class="num mono"><strong>${fmtDuration(res.time)}</strong></td>
          <td class=${'num mono' + (res.finishLegRank === 1 ? ' best' : '')}>${dur(res.finishLeg)}</td>
          ${!score && html`<td class="num muted">${res.finishLegRank || ''}</td>`}
        </tr>
      </tbody>
    </table>
    ${clockIssue &&
    html`<p class="extra small muted">« ? » ou « sans heure » : horloge de boîtier non réglée. Les temps intermédiaires concernés sont faux, mais le temps total et la note ne sont pas affectés.</p>`}
    ${res.extra.length > 0 &&
    html`<p class="extra small muted">${score ? 'Poinçons non comptés (hors circuit ou en double)' : 'Postes supplémentaires (hors circuit)'} : ${res.extra.map((p) => html`<span class="chip chip-sm">${p.code}</span>`)}</p>`}
  </div>`;
}

/** Détail de la note /20 (course au score). */
export function ScoreSummary({ res }) {
  const sc = res.score;
  return html`<div class="score-summary">
    <div class="score-line">
      <span>Balises validées</span>
      <strong class=${res.missing.length ? 'text-err' : 'text-ok'}>${res.validated ?? 0} / ${res.totalControls}</strong>
    </div>
    ${res.first?.expected != null &&
    html`<div class="score-line">
      <span>1re balise imposée : <b class="mono">${res.first.expected}</b></span>
      <strong class=${res.first.ok ? 'text-ok' : 'text-err'}>${res.first.ok ? 'respectée' : `non respectée (${res.first.punched ?? 'aucune'} en premier)`}</strong>
    </div>`}
    ${res.missing.length > 0 &&
    html`<div class="score-line"><span>Balises manquantes</span><span class="chips">${res.missing.map((c) => html`<span class="chip chip-sm chip-err">${c}</span>`)}</span></div>`}
    ${sc &&
    html`<div class="score-calc">
      <div class="score-line"><span>Note de temps (${fmtDuration(res.time)})</span><span class="mono">${sc.base}</span></div>
      ${sc.penalties.map((p) => html`<div class="score-line text-err"><span>${p.label}</span><span class="mono">−${p.points}</span></div>`)}
      <div class="score-line score-total"><span>Note finale</span><span class="mono">${sc.note} / 20${sc.raw < sc.note ? ' (plancher)' : ''}</span></div>
    </div>`}
  </div>`;
}

function PunchList({ read }) {
  const t = cardTimes(read, store.event?.zeroTime);
  return html`<div class="punches">
    <span class="chip chip-start" title=${fmtClock(t.start)}>D ${fmtClock(t.start).slice(0, 5)}</span>
    ${t.punches.map((p, i) => html`<span class="chip" key=${i} title=${fmtClock(p.time)}>${p.code}</span>`)}
    <span class="chip chip-finish" title=${fmtClock(t.finish)}>A ${fmtClock(t.finish).slice(0, 5)}</span>
  </div>`;
}

/** Recherche d'un coureur pour lui attribuer une lecture. */
function AssignSearch({ read, onDone }) {
  const [q, setQ] = useState('');
  const d = getDerived();
  const nq = norm(q);
  const comps = [...store.competitors.values()];
  let list = nq
    ? comps.filter((c) => norm(`${c.lastName} ${c.firstName} ${c.club} ${c.section || ''} ${c.card || ''} ${c.bib || ''}`).includes(nq))
    : comps.filter((c) => Number(c.card) === read.number);
  list = list
    .sort((a, b) => (Number(b.card) === read.number) - (Number(a.card) === read.number) || d.readsByComp.has(a.id) - d.readsByComp.has(b.id))
    .slice(0, 8);
  const pick = async (c) => {
    const prev = d.readsByComp.get(c.id);
    if (prev && prev.id !== read.id) {
      const ok = await confirmDialog({
        title: 'Remplacer la lecture',
        message: `${personName(c)} a déjà une lecture (puce ${prev.number}, lue à ${new Date(prev.readAt).toLocaleTimeString('fr-FR')}). La remplacer par celle-ci ?`,
        confirmLabel: 'Remplacer',
      });
      if (!ok) return;
    }
    assignRead(read.id, c.id);
    onDone?.();
  };
  return html`<div class="assign">
    <${SearchInput} value=${q} onInput=${setQ} placeholder="Nom, section, puce…" autoFocus />
    <div class="assign-list">
      ${list.map((c) => {
        const has = d.readsByComp.get(c.id);
        return html`<button type="button" class="assign-item" key=${c.id} onClick=${() => pick(c)}>
          <span><strong>${personName(c)}</strong><small>${[store.classes.get(c.classId)?.name, c.section ? sectionLabel(c.section) : c.club, c.firstControl != null && `1re balise ${c.firstControl}`].filter(Boolean).join(' · ')}</small></span>
          <span class="assign-tags">
            ${c.card ? html`<span class="mono small">${c.card}</span>` : html`<${Badge} kind="muted">sans puce<//>`}
            ${has && has.id !== read.id && html`<${Badge} kind="warn">déjà lu<//>`}
          </span>
        </button>`;
      })}
      ${!list.length && html`<p class="muted small pad">${nq ? 'Personne trouvé.' : 'Tapez un nom pour rechercher.'}</p>`}
    </div>
  </div>`;
}

function QuickCreate({ read, suggestedClassId }) {
  const score = isScoreMode(store.event);
  const classes = sortedClasses();
  const [f, setF] = useState({ lastName: '', firstName: '', club: '', section: '', classId: suggestedClassId || (classes.length === 1 ? classes[0].id : '') });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.lastName.trim() || f.firstName.trim();
  return html`<form
    class="quick-create"
    onSubmit=${(e) => {
      e.preventDefault();
      if (valid) createCompetitorFromRead(read.id, { ...f, lastName: f.lastName.trim(), firstName: f.firstName.trim(), club: f.club.trim(), section: f.section.trim() });
    }}
  >
    <${ClubDatalist} />
    <div class="form-grid">
      <${Field} label="Nom"><input class="input" value=${f.lastName} onInput=${set('lastName')} /><//>
      <${Field} label="Prénom"><input class="input" value=${f.firstName} onInput=${set('firstName')} /><//>
      ${score
        ? html`<${Field} label="Section"><input class="input" list="sections" value=${f.section} onInput=${set('section')} /><//>`
        : html`<${Field} label="Club"><input class="input" list="clubs" value=${f.club} onInput=${set('club')} /><//>`}
      <${Field} label="Catégorie">
        <select class="input" value=${f.classId} onChange=${set('classId')}>
          <option value="">— Aucune —</option>
          ${classes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      <//>
    </div>
    <${Button} type="submit" variant="primary" icon="userPlus" disabled=${!valid}>Créer avec la puce ${read.number}</${Button}>
  </form>`;
}

/** Saisie rapide du nom d'une personne importée sans nom (puce attribuée sur place). */
function NameForm({ comp }) {
  const [f, setF] = useState({ lastName: '', firstName: '', section: comp.section || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.lastName.trim() || f.firstName.trim();
  return html`<form
    class="name-form"
    onSubmit=${(e) => {
      e.preventDefault();
      if (valid) put('competitor', { ...comp, lastName: f.lastName.trim(), firstName: f.firstName.trim(), section: f.section.trim() });
    }}
  >
    <${ClubDatalist} />
    <div class="name-form-head"><${Icon} name="userPlus" size=${18} /> <strong>Qui avait cette puce ?</strong> <span class="muted small">Complétez le nom pour l'export.</span></div>
    <div class="name-form-grid">
      <input class="input" placeholder="Nom" value=${f.lastName} onInput=${set('lastName')} autoFocus />
      <input class="input" placeholder="Prénom" value=${f.firstName} onInput=${set('firstName')} />
      <input class="input" placeholder="Section" list="sections" value=${f.section} onInput=${set('section')} />
      <${Button} type="submit" variant="primary" disabled=${!valid}>Enregistrer</${Button}>
    </div>
  </form>`;
}

function ReferenceCourseButton({ read }) {
  const courses = [...store.courses.values()];
  const n = new Set(read.punches.map((p) => p.code)).size;
  const create = async () => {
    const target = courses.length === 1 ? courses[0] : null;
    if (target?.controls?.length) {
      const ok = await confirmDialog({
        title: 'Remplacer les balises du circuit',
        message: `Le circuit « ${target.name} » a déjà ${target.controls.length} balises. Les remplacer par les ${n} balises de la puce ${read.number} ?`,
        confirmLabel: 'Remplacer',
      });
      if (!ok) return;
    }
    courseFromRead(read.id, target?.id || null);
  };
  return html`<${Button} icon="route" onClick=${create} title="Enregistrer les balises poinçonnées comme balises du circuit">Définir le circuit avec cette puce (${n} balises)</${Button}>`;
}

function UnknownRead({ read }) {
  const d = getDerived();
  const score = isScoreMode(store.event);
  const suggestions = suggestCourses(read, store);
  const best = suggestions[0];
  const owners = [...store.competitors.values()].filter((c) => Number(c.card) === read.number);
  let title = 'Puce inconnue';
  let text = "Aucune personne inscrite n'a ce numéro de puce. Attribuez la lecture à quelqu'un ou créez la personne.";
  if (read.note === 'conflict' && owners[0]) {
    const prev = d.readsByComp.get(owners[0].id);
    title = 'Puce déjà lue';
    text = `Cette puce appartient à ${personName(owners[0])}, qui a déjà une lecture${prev ? ` (à ${new Date(prev.readAt).toLocaleTimeString('fr-FR')})` : ''}. Puce prêtée ou seconde course ?`;
  } else if (owners.length > 1) {
    title = 'Puce partagée';
    text = `Plusieurs lignes ont la puce ${read.number} : ${owners.map((o) => `${personName(o)}${o.firstControl != null ? ` (1re balise ${o.firstControl})` : ''}`).join(', ')}. Choisissez la bonne.`;
  }
  return html`<div class="read-card read-unknown">
    <div class="read-meta">Puce <b class="mono">${read.number}</b> · ${CARD_LABELS[read.type] || read.type} · lue à ${new Date(read.readAt).toLocaleTimeString('fr-FR')}</div>
    <div class="read-top">
      <div><h2 class="read-name"><${Icon} name="alert" size=${22} /> ${title}</h2><p class="read-sub">${text}</p></div>
    </div>
    ${best &&
    html`<p class="suggest">
      <${Icon} name="route" size=${16} />
      ${best.missing === 0
        ? html`Toutes les balises du circuit <strong>${best.course.name}</strong> sont présentes`
        : html`Circuit le plus proche : <strong>${best.course.name}</strong> (${best.missing} balise${best.missing > 1 ? 's' : ''} manquante${best.missing > 1 ? 's' : ''})`}
      ${!score && best.classes.length > 0 && html` — catégorie${best.classes.length > 1 ? 's' : ''} ${best.classes.map((c) => c.name).join(', ')}`}
    </p>`}
    <${PunchList} read=${read} />
    <div class="grid-2 mt">
      <div><h3 class="h3">Attribuer à une personne inscrite</h3><${AssignSearch} read=${read} /></div>
      <div><h3 class="h3">Nouvelle personne</h3><${QuickCreate} read=${read} key=${read.id} suggestedClassId=${!score && best?.missing === 0 ? best.classes[0]?.id : ''} /></div>
    </div>
    <div class="read-actions">
      <${ReferenceCourseButton} read=${read} />
      <span class="spacer"></span>
      <${Button} icon="x" onClick=${() => archiveRead(read.id)} title="Retirer de la liste « à traiter » sans supprimer">Ignorer cette lecture</${Button}>
      <${Button}
        variant="ghost-danger"
        icon="trash"
        onClick=${async () => {
          if (await confirmDialog({ title: 'Supprimer la lecture', message: `Supprimer définitivement la lecture de la puce ${read.number} ?`, confirmLabel: 'Supprimer', danger: true }))
            mutate([delOp('card', read.id)]);
        }}
      >Supprimer</${Button}>
    </div>
  </div>`;
}

export function ReadDetail({ readId }) {
  const [editComp, setEditComp] = useState(null);
  const [reassign, setReassign] = useState(false);
  const read = store.cards.get(readId);
  if (!read) return null;
  const d = getDerived();
  const score = isScoreMode(store.event);
  const comp = read.competitorId ? store.competitors.get(read.competitorId) : null;
  if (!comp) return html`<${UnknownRead} read=${read} key=${read.id} />`;

  const active = d.readsByComp.get(comp.id)?.id === read.id;
  const res = d.results.get(comp.id);
  const row = d.rowByComp.get(comp.id);
  const cls = store.classes.get(comp.classId);
  const ranked = row?.ranked || 0;
  const st = res.status;
  const named = comp.lastName || comp.firstName;
  const tone = st !== 'OK' ? st.toLowerCase() : score && (res.missing.length || res.first?.ok === false) ? 'mp' : 'ok';
  const sub = score
    ? [comp.section ? sectionLabel(comp.section) : 'Section inconnue', comp.firstControl != null && `1re balise imposée ${comp.firstControl}`].filter(Boolean)
    : [cls?.name || 'Sans catégorie', comp.club, store.courses.get(cls?.courseId)?.name && `circuit ${store.courses.get(cls.courseId).name}`].filter(Boolean);

  return html`<div class=${'read-card read-' + tone}>
    <div class="read-meta">
      Puce <b class="mono">${read.number}</b> · ${CARD_LABELS[read.type] || read.type} · lue à ${new Date(read.readAt).toLocaleTimeString('fr-FR')}
      ${read.source === 'simulation' && html` · <${Badge} kind="info">simulation<//>`}
      ${!active && html` · <${Badge} kind="warn">ancienne lecture<//>`}
    </div>
    <div class="read-top">
      <div>
        <h2 class="read-name">${named ? personName(comp) : html`<span class="muted">Personne sans nom</span>`}</h2>
        <p class="read-sub">${sub.join(' · ')}</p>
      </div>
      <div class="read-result">
        ${score && st === 'OK'
          ? html`<div class="read-note"><span class="mono">${res.note}</span><small>/20</small></div>
              <div class="read-rank"><span class="mono">${fmtDuration(res.time)}</span> · ${res.validated}/${res.totalControls} balises</div>`
          : html`<${StatusPill} status=${st} nc=${comp.nc} />
              <div class="read-time mono">${res.time != null ? fmtDuration(res.time) : '—'}</div>`}
        ${row?.place != null && html`<div class="read-rank">${ordinal(row.place)} sur ${ranked}${!score && row.behind > 0 ? html` · <span class="mono">${fmtBehind(row.behind)}</span>` : ''}</div>`}
      </div>
    </div>
    ${!named && html`<${NameForm} comp=${comp} key=${comp.id} />`}
    ${!score && res.missing.length > 0 && html`<div class="alert alert-err"><${Icon} name="alert" /> <span>Poste${res.missing.length > 1 ? 's' : ''} manquant${res.missing.length > 1 ? 's' : ''} : <strong>${res.missing.join(', ')}</strong></span></div>`}
    ${st === 'DNF' && html`<div class="alert alert-warn"><${Icon} name="alert" /> <span>Pas de poinçon d'arrivée : saisissez l'heure d'arrivée dans la fiche pour calculer ${score ? 'la note' : 'le temps'}.</span></div>`}
    ${comp.rented && html`<div class="alert alert-info"><${Icon} name="chip" /> <span>Puce prêtée : <strong>à récupérer</strong>.</span></div>`}
    ${res.warnings.filter((w) => w !== 'Aucune catégorie').map((w) => html`<div class="alert alert-warn"><${Icon} name="info" /> <span>${w}</span></div>`)}
    ${score && html`<${ScoreSummary} res=${res} />`}
    <${SplitsTable} res=${res} />
    <div class="read-actions">
      <${Button} icon="printer" onClick=${() => printTicket(read.id)}>Imprimer le ticket</${Button}>
      <${Button} icon="edit" onClick=${() => setEditComp(comp)}>Fiche</${Button}>
      <${Button} icon="link" onClick=${() => setReassign(true)}>Attribuer à quelqu'un d'autre</${Button}>
      ${score && (!res.totalControls || res.extra.length > 0) && html`<${ReferenceCourseButton} read=${read} />`}
    </div>
    ${editComp && html`<${CompetitorModal} comp=${editComp} onClose=${() => setEditComp(null)} />`}
    ${reassign &&
    html`<${Modal} title=${`Attribuer la puce ${read.number} à…`} onClose=${() => setReassign(false)}>
      <${AssignSearch} read=${read} onDone=${() => setReassign(false)} />
    <//>`}
  </div>`;
}
