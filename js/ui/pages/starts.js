// Départs : tirage au sort des heures de départ et listes de départ.
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { mutate, put, putOp, store } from '../../core/store.js';
import { compareText, personName } from '../../core/util.js';
import { fmtClock } from '../../core/time.js';
import { DRAW_MODES, INTERVALS, drawStartTimes } from '../../domain/startlist.js';
import { exportStartListCsv, printHtml, startListHtml } from '../../io/reports.js';
import { Button, Card, EmptyState, Menu, PageHeader, Segmented, TimeInput } from '../components.js';
import { useStore } from '../hooks.js';
import { sortedClasses } from './classes.js';

function classComps(clsId) {
  return [...store.competitors.values()].filter((c) => c.classId === clsId && c.status !== 'DNS');
}

function drawOps(cls) {
  const comps = classComps(cls.id);
  const first = cls.firstStart ?? store.event?.zeroTime ?? 36000;
  const times = drawStartTimes(comps, { first, interval: cls.interval ?? 120, mode: cls.drawMode || 'random' });
  const byId = new Map(comps.map((c) => [c.id, c]));
  return times.map((t) => putOp('competitor', { ...byId.get(t.id), startTime: t.startTime }));
}

export function StartsPage() {
  const s = useStore();
  const [view, setView] = useState('class');
  const classes = sortedClasses();
  const ev = s.event;

  const drawOne = async (cls) => {
    const comps = classComps(cls.id);
    if (!comps.length) return toast(`Aucun coureur en ${cls.name}.`, 'info');
    if (comps.some((c) => c.startTime != null)) {
      const ok = await confirmDialog({ title: `Tirage ${cls.name}`, message: `Les heures de départ actuelles des ${comps.length} coureurs de ${cls.name} seront remplacées.`, confirmLabel: 'Tirer au sort' });
      if (!ok) return;
    }
    mutate(drawOps(cls));
    toast(`Heures de départ attribuées en ${cls.name}.`, 'success');
  };

  const drawAll = async () => {
    const targets = classes.filter((c) => classComps(c.id).length);
    if (!targets.length) return toast('Aucun coureur à placer.', 'info');
    const ok = await confirmDialog({ title: 'Tirer toutes les catégories', message: `Attribuer les heures de départ dans ${targets.length} catégories ? Les heures existantes seront remplacées.`, confirmLabel: 'Tout tirer au sort' });
    if (!ok) return;
    mutate(targets.flatMap(drawOps));
    toast('Heures de départ attribuées.', 'success');
  };

  const clearAll = async () => {
    const withTime = [...s.competitors.values()].filter((c) => c.startTime != null);
    if (!withTime.length) return;
    const ok = await confirmDialog({ title: 'Effacer les heures de départ', message: `Effacer les heures de départ des ${withTime.length} coureurs ?`, confirmLabel: 'Effacer', danger: true });
    if (ok) mutate(withTime.map((c) => putOp('competitor', { ...c, startTime: null })));
  };

  const comps = [...s.competitors.values()];
  const byTime = comps.filter((c) => c.startTime != null).sort((a, b) => a.startTime - b.startTime || compareText(a.lastName, b.lastName));

  return html`
    <${PageHeader} title="Départs" subtitle=${ev.startMode === 'list' ? "L'heure de départ de chaque coureur est celle de la liste de départ." : 'Départ au boîtier : la liste de départ est facultative (utile pour l\'appel en grille).'}>
      <${Menu}
        label="Imprimer / exporter"
        items=${[
          { label: 'Liste par catégorie', icon: 'printer', onClick: () => printHtml(startListHtml({})) },
          { label: 'Liste par heure (appel au départ)', icon: 'printer', onClick: () => printHtml(startListHtml({ byTime: true })) },
          { label: 'Exporter (CSV)', icon: 'download', onClick: exportStartListCsv },
          { separator: true },
          { label: 'Effacer toutes les heures', icon: 'trash', danger: true, onClick: clearAll },
        ]}
      />
      <${Button} icon="shuffle" variant="primary" onClick=${drawAll} disabled=${!classes.length}>Tout tirer au sort</${Button}>
    <//>

    ${!classes.length
      ? html`<div class="card"><${EmptyState} icon="clock" title="Aucune catégorie" text="Créez d'abord les catégories et inscrivez les coureurs." /></div>`
      : html`<${Card} title="Paramètres du tirage" pad=${false}>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Catégorie</th><th class="num">Coureurs</th><th>Premier départ</th><th>Intervalle</th><th>Méthode</th><th class="num">Dernier départ</th><th></th></tr></thead>
            <tbody>
              ${classes.map((cls) => {
                const n = classComps(cls.id).length;
                const first = cls.firstStart ?? ev.zeroTime;
                const last = n ? first + (n - 1) * (cls.interval ?? 120) : null;
                return html`<tr key=${cls.id}>
                  <td><strong>${cls.name}</strong></td>
                  <td class="num">${n}</td>
                  <td><${TimeInput} class="input-sm w-time" value=${cls.firstStart ?? null} placeholder=${fmtClock(ev.zeroTime)} onChange=${(v) => put('class', { ...cls, firstStart: v })} /></td>
                  <td>
                    <select class="input input-sm" value=${cls.interval ?? 120} onChange=${(e) => put('class', { ...cls, interval: Number(e.target.value) })}>
                      ${INTERVALS.map((i) => html`<option value=${i.value}>${i.label}</option>`)}
                    </select>
                  </td>
                  <td>
                    <select class="input input-sm" value=${cls.drawMode || 'random'} onChange=${(e) => put('class', { ...cls, drawMode: e.target.value })}>
                      ${DRAW_MODES.map((m) => html`<option value=${m.value}>${m.label}</option>`)}
                    </select>
                  </td>
                  <td class="num mono">${fmtClock(last)}</td>
                  <td class="actions"><${Button} small icon="shuffle" onClick=${() => drawOne(cls)} disabled=${!n}>Tirer</${Button}></td>
                </tr>`;
              })}
            </tbody>
          </table></div>
        <//>

        <div class="section-head mt">
          <h2>Liste de départ</h2>
          <${Segmented} value=${view} onChange=${setView} options=${[{ value: 'class', label: 'Par catégorie' }, { value: 'time', label: 'Par heure' }]} />
        </div>
        ${!byTime.length
          ? html`<div class="card"><${EmptyState} icon="clock" title="Aucune heure de départ attribuée" text="Réglez le premier départ et l'intervalle de chaque catégorie, puis lancez le tirage au sort." /></div>`
          : view === 'time'
            ? html`<div class="card"><div class="table-wrap"><table class="table">
                <thead><tr><th class="num">Départ</th><th>Nom</th><th>Club</th><th>Catégorie</th><th class="num">Puce</th></tr></thead>
                <tbody>${byTime.slice(0, 500).map(
                  (c) => html`<tr key=${c.id}><td class="num mono">${fmtClock(c.startTime)}</td><td><strong>${personName(c)}</strong></td><td>${c.club}</td><td>${s.classes.get(c.classId)?.name || ''}</td><td class="num mono">${c.card || ''}</td></tr>`
                )}</tbody>
              </table></div></div>`
            : html`<div class="start-columns">
                ${classes.map((cls) => {
                  const list = comps.filter((c) => c.classId === cls.id).sort((a, b) => (a.startTime ?? 1e9) - (b.startTime ?? 1e9));
                  if (!list.length) return null;
                  return html`<div class="card start-class" key=${cls.id}>
                    <header class="card-head"><h2>${cls.name}</h2><span class="muted small">${list.length} coureur${list.length > 1 ? 's' : ''}</span></header>
                    <table class="table table-tight">
                      <tbody>${list.map(
                        (c) => html`<tr class=${c.status === 'DNS' ? 'dim' : ''}><td class="num mono">${fmtClock(c.startTime) || '—'}</td><td>${personName(c)}</td><td class="muted">${c.club}</td></tr>`
                      )}</tbody>
                    </table>
                  </div>`;
                })}
              </div>`}`}
  `;
}
