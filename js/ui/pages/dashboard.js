// Tableau de bord de l'épreuve.
import { html, useState } from '../../lib.js';
import { getDerived, put, updateEvent } from '../../core/store.js';
import { compareText, formatDate, personName, plural } from '../../core/util.js';
import { fmtClock } from '../../core/time.js';
import { exportEventFile } from '../../io/reports.js';
import { Button, Card, EmptyState, Icon, PageHeader, Stat } from '../components.js';
import { go, useStation, useStore } from '../hooks.js';
import { EventModal, START_MODES } from './event-form.js';

export function DashboardPage() {
  const s = useStore();
  const st = useStation();
  const d = getDerived();
  const [editing, setEditing] = useState(false);
  const ev = s.event;
  const id = s.eventId;
  const stats = d.stats;

  const comps = [...s.competitors.values()];
  const classesNoCourse = [...s.classes.values()].filter((c) => !s.courses.has(c.courseId));
  const noCard = comps.filter((c) => !c.card).length;
  const withStart = comps.filter((c) => c.startTime != null).length;
  const running = comps
    .filter((c) => d.results.get(c.id).status === 'RUN')
    .sort((a, b) => (a.startTime ?? 1e9) - (b.startTime ?? 1e9) || compareText(a.lastName, b.lastName));

  const steps = [
    {
      page: 'circuits',
      label: 'Circuits',
      done: s.courses.size > 0,
      text: s.courses.size ? plural(s.courses.size, 'circuit', 'circuits') : 'Importez les circuits (IOF XML) ou créez-les',
    },
    {
      page: 'categories',
      label: 'Catégories',
      done: s.classes.size > 0 && !classesNoCourse.length,
      warn: classesNoCourse.length > 0,
      text: !s.classes.size
        ? 'Créez les catégories et associez-les à un circuit'
        : classesNoCourse.length
          ? `${plural(classesNoCourse.length, 'catégorie', 'catégories')} sans circuit`
          : plural(s.classes.size, 'catégorie', 'catégories'),
    },
    {
      page: 'coureurs',
      label: 'Coureurs',
      done: comps.length > 0,
      warn: comps.length > 0 && (noCard > 0 || d.noClass.length > 0),
      text: !comps.length
        ? 'Importez la liste des inscrits (CSV, IOF XML) ou saisissez-les'
        : [plural(comps.length, 'inscrit', 'inscrits'), noCard && `${noCard} sans puce`, d.noClass.length && `${d.noClass.length} sans catégorie`]
            .filter(Boolean)
            .join(' · '),
    },
    {
      page: 'departs',
      label: 'Départs',
      done: ev.startMode !== 'list' ? true : comps.length > 0 && withStart === comps.length,
      optional: ev.startMode !== 'list',
      text: ev.startMode !== 'list' ? 'Départ au boîtier : liste de départ facultative' : `${withStart} / ${comps.length} heures de départ attribuées`,
    },
    {
      page: 'lecture',
      label: 'Boîtier de lecture',
      done: st.connected,
      text: st.connected ? `${st.info?.model || 'Boîtier'} connecté${st.simulated ? ' (simulation)' : ''}` : 'Branchez la station maître et connectez-la',
    },
  ];

  const classRows = [...s.classes.values()]
    .sort((a, b) => compareText(a.name, b.name))
    .map((cls) => {
      const rows = d.classes.get(cls.id)?.rows || [];
      const count = (st) => rows.filter((r) => r.res.status === st).length;
      return { cls, total: rows.length, ok: count('OK'), mp: count('MP') + count('DNF') + count('DSQ'), run: count('RUN'), dns: count('DNS') };
    });

  const mode = START_MODES.find((m) => m.value === ev.startMode) || START_MODES[0];

  return html`
    <${PageHeader} title=${ev.name} subtitle=${[formatDate(ev.date), ev.place, ev.organizer].filter(Boolean).join(' · ')}>
      <${Button} icon="download" onClick=${exportEventFile} title="Télécharger une copie complète de l'épreuve">Exporter l'épreuve</${Button}>
      <${Button} icon="edit" onClick=${() => setEditing(true)}>Modifier</${Button}>
    <//>

    <div class="stats">
      <${Stat} label="Inscrits" value=${stats.total} icon="users" onClick=${() => go(`e/${id}/coureurs`)} />
      <${Stat} label="En forêt" value=${stats.running} icon="tree" kind=${stats.running ? 'info' : ''} hint=${stats.dns ? `${stats.dns} non partant${stats.dns > 1 ? 's' : ''}` : ''} />
      <${Stat} label="Arrivés" value=${stats.finished} icon="flag" />
      <${Stat} label="Classés" value=${stats.ok} icon="check" kind="ok" onClick=${() => go(`e/${id}/resultats`)} />
      <${Stat} label="PM · Abandons" value=${stats.mp + stats.dnf + stats.dsq} icon="alert" kind=${stats.mp + stats.dnf + stats.dsq ? 'err' : ''} />
      <${Stat} label="Puces à traiter" value=${stats.unassigned} icon="chip" kind=${stats.unassigned ? 'warn' : ''} onClick=${() => go(`e/${id}/lecture`)} />
    </div>

    <div class="grid-2">
      <${Card} title="Préparation">
        <ol class="steps">
          ${steps.map(
            (step, i) => html`<li class=${'step' + (step.done ? ' done' : '') + (step.warn ? ' warn' : '')}>
              <a href=${`#/e/${id}/${step.page}`}>
                <span class="step-mark">${step.warn ? html`<${Icon} name="alert" size=${14} />` : step.done ? html`<${Icon} name="check" size=${14} />` : i + 1}</span>
                <span class="step-text"><strong>${step.label}</strong><span>${step.text}</span></span>
                <${Icon} name="chevronRight" size=${16} />
              </a>
            </li>`
          )}
        </ol>
      <//>
      <${Card} title="Réglages de l'épreuve" actions=${html`<${Button} small icon="edit" onClick=${() => setEditing(true)}>Modifier</${Button}>`}>
        <dl class="facts">
          <dt>Date</dt><dd>${formatDate(ev.date) || '—'}</dd>
          <dt>Heure zéro</dt><dd class="mono">${fmtClock(ev.zeroTime) || '—'}</dd>
          <dt>Départ</dt><dd><strong>${mode.label}</strong><br /><span class="muted small">${mode.text}</span></dd>
          <dt>Lieu</dt><dd>${ev.place || '—'}</dd>
          <dt>Organisateur</dt><dd>${ev.organizer || '—'}</dd>
        </dl>
      <//>
    </div>

    <${Card} title=${`Coureurs en forêt (${running.length})`} pad=${false} class="mt">
      ${running.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Nom</th><th>Club</th><th>Catégorie</th><th class="num">Puce</th><th class="num">Départ</th><th></th></tr></thead>
            <tbody>
              ${running.slice(0, 200).map(
                (c) => html`<tr key=${c.id}>
                  <td><strong>${personName(c)}</strong></td>
                  <td>${c.club}</td>
                  <td>${s.classes.get(c.classId)?.name || html`<span class="muted">—</span>`}</td>
                  <td class="num mono">${c.card || '—'}</td>
                  <td class="num mono">${fmtClock(c.startTime) || '—'}</td>
                  <td class="actions"><${Button} small onClick=${() => put('competitor', { ...c, status: 'DNS' })} title="Marquer comme non partant">Non partant</${Button}></td>
                </tr>`
              )}
            </tbody>
          </table></div>
          ${running.length > 200 && html`<p class="muted small pad">… et ${running.length - 200} autres.</p>`}`
        : html`<${EmptyState} icon="tree" title="Personne en forêt" text=${comps.length ? 'Tous les coureurs inscrits sont arrivés ou non partants.' : "Aucun coureur inscrit pour l'instant."} />`}
    <//>

    ${classRows.length > 0 &&
    html`<${Card} title="Avancement par catégorie" pad=${false} class="mt">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Catégorie</th><th>Circuit</th><th class="num">Inscrits</th><th class="num">Classés</th><th class="num">PM · Ab.</th><th class="num">En forêt</th><th class="num">Non part.</th><th style="width:30%">Progression</th></tr></thead>
        <tbody>
          ${classRows.map((r) => {
            const done = r.total ? Math.round(((r.ok + r.mp + r.dns) / r.total) * 100) : 0;
            return html`<tr key=${r.cls.id} class="clickable" onClick=${() => go(`e/${id}/resultats/${r.cls.id}`)}>
              <td><strong>${r.cls.name}</strong></td>
              <td>${s.courses.get(r.cls.courseId)?.name || html`<span class="text-warn">aucun</span>`}</td>
              <td class="num">${r.total}</td>
              <td class="num">${r.ok}</td>
              <td class="num">${r.mp || ''}</td>
              <td class="num">${r.run || ''}</td>
              <td class="num">${r.dns || ''}</td>
              <td><div class="progress"><div style=${`width:${done}%`}></div></div></td>
            </tr>`;
          })}
        </tbody>
      </table></div>
    <//>`}

    ${editing &&
    html`<${EventModal}
      title="Modifier l'épreuve"
      submitLabel="Enregistrer"
      initial=${ev}
      onClose=${() => setEditing(false)}
      onSubmit=${(data) => {
        updateEvent(data);
        setEditing(false);
      }}
    />`}
  `;
}
