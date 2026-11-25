// Lecture des puces : connexion du boîtier, dernière lecture, historique, puces à traiter.
import { html, useEffect, useRef, useState } from '../../lib.js';
import { getDerived, store } from '../../core/store.js';
import { toast } from '../../core/bus.js';
import { personName, plural } from '../../core/util.js';
import { fmtDuration } from '../../core/time.js';
import { readout } from '../../core/readout.js';
import { unlockAudio } from '../../core/sound.js';
import { MODE_READOUT } from '../../sportident/constants.js';
import { Station, humanError, station } from '../../sportident/station.js';
import { SimulatedPort } from '../../sportident/simulator.js';
import { simulatedCard } from '../../domain/simulate.js';
import { Badge, Button, Card, EmptyState, Icon, Menu, PageHeader, Spinner, StatusPill, Toggle } from '../components.js';
import { useBus, usePref, useStation, useStore } from '../hooks.js';
import { ReadDetail } from './readout-view.js';
import { preparationChecks } from './guide.js';
import { isScoreMode } from '../../domain/results.js';
import { go } from '../hooks.js';

async function connectReal(anyPort = false) {
  unlockAudio();
  try {
    await station.choosePort({ anyPort });
    toast('Boîtier connecté : insérez une puce.', 'success');
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast(humanError(e), 'error');
  }
}

async function connectSimulator() {
  unlockAudio();
  try {
    await station.connect(new SimulatedPort(), { simulated: true });
    toast('Mode simulation : utilisez les boutons pour simuler des lectures.', 'info');
  } catch (e) {
    toast(humanError(e), 'error');
  }
}

function StationLog() {
  const [, setTick] = useState(0);
  const ref = useRef();
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    station.addEventListener('log', f);
    return () => station.removeEventListener('log', f);
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return html`<pre class="log" ref=${ref}>${station.logLines
    .slice(-120)
    .map((l) => `${new Date(l.t).toLocaleTimeString('fr-FR')} ${l.dir} ${l.text}${l.hex ? (l.text ? '  ' : '') + l.hex : ''}`)
    .join('\n') || 'Aucun échange pour le moment.'}</pre>`;
}

export function StationPanel() {
  const st = useStation();
  const info = st.info;
  const warnings = [];
  if (st.connected && info) {
    if (info.mode != null && info.mode !== MODE_READOUT)
      warnings.push(`Le boîtier est en mode « ${info.modeName} » : passez-le en mode « Lecture » avec SI-Config+.`);
    if (!info.handshake && info.autoSend) warnings.push('Le boîtier est en « autosend » : activez le mode « handshake » avec SI-Config+ pour lire les puces.');
  }

  if (!Station.supported) {
    return html`<div class="station-bar state-error">
      <div class="station-icon"><${Icon} name="alert" /></div>
      <div class="station-text">
        <strong>Lecture des puces indisponible dans ce navigateur</strong>
        <span>${location.hostname === 'localhost' || location.hostname === '127.0.0.1'
          ? 'Utilisez Google Chrome sur Android, lecteur branché avec un câble USB OTG.'
          : "Ce poste consulte l'épreuve à distance : le boîtier se branche sur l'ordinateur qui fait tourner CO - P3OPS."}</span>
      </div>
      <div class="station-actions"><${Button} icon="zap" onClick=${connectSimulator}>Mode simulation</${Button}></div>
    </div>`;
  }

  const stateLabel = {
    connected: st.reading ? `Lecture de la puce ${st.reading.number}…` : 'Prêt — insérez une puce',
    connecting: 'Connexion…',
    error: st.message || 'Erreur',
    disconnected: 'Aucun boîtier connecté',
  }[st.state];

  return html`<div class=${'station-bar state-' + st.state + (st.reading ? ' reading' : '')}>
    <div class="station-icon">${st.state === 'connecting' ? html`<div class="spinner sm"></div>` : html`<${Icon} name=${st.state === 'error' ? 'alert' : 'plug'} />`}</div>
    <div class="station-text">
      <strong>${st.connected ? `${info?.model || 'Boîtier'}${info?.serial ? ` n° ${info.serial}` : ''} · ${stateLabel}` : stateLabel}</strong>
      <span>
        ${st.connected
          ? [info?.modeName && `mode ${info.modeName}`, info?.code != null && `poste ${info.code}`, `${st.baudRate} bauds`, st.simulated && 'simulation'].filter(Boolean).join(' · ')
          : st.state === 'error'
            ? 'Vérifiez le câble USB, puis reconnectez.'
            : 'Branchez le lecteur (BSM7 / BSM8) sur le téléphone avec un câble USB OTG, puis touchez « Connecter ».'}
      </span>
      ${warnings.map((w) => html`<span class="text-warn"><${Icon} name="alert" size=${14} /> ${w}</span>`)}
    </div>
    <div class="station-actions">
      ${st.connected && st.simulated &&
      html`<div class="sim-buttons">
        <${Button} small icon="zap" onClick=${() => st.port.insert(simulatedCard('ok'))}>Puce d'un inscrit</${Button}>
        <${Button} small onClick=${() => st.port.insert(simulatedCard('mp'))}>Avec PM</${Button}>
        <${Button} small onClick=${() => st.port.insert(simulatedCard('unknown'))}>Puce inconnue</${Button}>
      </div>`}
      ${st.connected || st.state === 'connecting'
        ? html`<${Button} onClick=${() => station.disconnect()}>Déconnecter</${Button}>`
        : html`<${Button} variant="primary" icon="plug" onClick=${() => connectReal(false)}>Connecter le boîtier</${Button}>
            <${Menu}
              label=""
              items=${[
                { label: 'Choisir parmi tous les ports série…', icon: 'plug', onClick: () => connectReal(true) },
                { label: 'Mode simulation (sans boîtier)', icon: 'zap', onClick: connectSimulator },
              ]}
            />`}
    </div>
  </div>`;
}

/**
 * Contrôle avant la lecture : bandeau rouge tant que la course ou le lecteur ne sont pas prêts,
 * voyant vert quand tout est bon. À droite, le nombre de puces lues sur le nombre de puces attribuées.
 */
function RaceStatus() {
  const s = useStore();
  const st = useStation();
  const d = getDerived();
  const score = isScoreMode(s.event);
  const info = st.info;

  const problems = [];
  if (score) for (const c of preparationChecks(s)) if (!c.ok) problems.push({ text: `${c.label} : ${c.detail}`, action: html`<${Button} small onClick=${() => go(`e/${s.eventId}/deroule/${c.id}`)}>Corriger</${Button}>` });
  if (!Station.supported) problems.push({ text: 'Ce navigateur ne sait pas lire les puces : ouvrez CO - P3OPS Mobile avec Google Chrome sur Android.' });
  else if (st.state === 'connecting') problems.push({ text: 'Connexion au lecteur en cours…' });
  else if (!st.connected)
    problems.push({
      text: st.state === 'error' ? `Lecteur déconnecté (${st.message || 'erreur'}). Vérifiez le câble USB puis reconnectez-le.` : 'Branchez le lecteur sur le téléphone avec un câble USB OTG, puis touchez « Connecter le lecteur » et choisissez-le dans la liste.',
      action: html`<${Button} small variant="primary" icon="plug" onClick=${() => connectReal(false)}>Connecter le lecteur</${Button}>
        <${Menu}
          label=""
          small
          items=${[
            { label: 'Choisir parmi tous les ports série…', icon: 'plug', onClick: () => connectReal(true) },
            { label: 'Mode simulation (sans lecteur)', icon: 'zap', onClick: connectSimulator },
          ]}
        />`,
    });
  else if (info) {
    if (info.mode != null && info.mode !== MODE_READOUT)
      problems.push({ text: `Le lecteur est réglé en « ${info.modeName} » au lieu de « Lecture » : reprogrammez-le.`, action: html`<${Button} small onClick=${() => go(`e/${s.eventId}/boitiers`)}>Programmer le lecteur</${Button}>` });
    if (!info.handshake && info.autoSend) problems.push({ text: 'Le lecteur est en « autosend » : activez le mode « handshake » (SI-Config+).' });
  }
  const ok = problems.length === 0;

  // Puces attribuées = personnes inscrites avec une puce (hors absents) ; sans noms, toutes les puces du fichier.
  const comps = [...s.competitors.values()].filter((c) => c.card && c.status !== 'DNS');
  const named = comps.filter((c) => c.lastName || c.firstName);
  const assigned = named.length ? named : score ? [] : comps;
  const read = assigned.filter((c) => d.readsByComp.has(c.id)).length;
  const totalReads = [...d.readsByComp.keys()].length;
  const out = assigned.length - read;

  return html`<div class="race-status-row">
    <section class=${'race-status ' + (ok ? 'ok' : 'bad')}>
      <span class="race-light" aria-hidden="true"></span>
      <div class="race-status-text">
        <strong>${ok ? `Tout est prêt — insérez les doigts dans le lecteur${st.simulated ? ' (simulation)' : ''}` : st.connected ? 'Contrôle à terminer avant la lecture' : 'Lecteur non contrôlé'}</strong>
        ${ok
          ? html`<span>${[info?.model && `${info.model}${info.serial ? ` n° ${info.serial}` : ''} en mode Lecture`, ...(score ? preparationChecks(s).map((c) => c.detail) : [])].filter(Boolean).join(' · ')}</span>`
          : problems.map((p) => html`<span class="race-problem"><${Icon} name="alert" size=${15} /> ${p.text} ${p.action || ''}</span>`)}
      </div>
    </section>
    <section class="race-count" title="Puces lues / puces attribuées">
      ${assigned.length
        ? html`<div class="race-count-main"><b>${read}</b><span>/ ${assigned.length}</span></div>
            <div class="race-count-label">puces lues</div>
            <div class=${'race-count-out' + (out === 0 ? ' zero' : '')}>${out === 0 ? 'Tout le monde est rentré' : `${plural(out, 'coureur encore', 'coureurs encore')} sur le circuit`}</div>`
        : html`<div class="race-count-main"><b>${totalReads}</b></div>
            <div class="race-count-label">doigt${totalReads > 1 ? 's' : ''} lu${totalReads > 1 ? 's' : ''}</div>
            <div class="race-count-out muted">Noms saisis à la lecture</div>`}
    </section>
  </div>`;
}

function RecentReads({ selected, onSelect }) {
  const s = useStore();
  const d = getDerived();
  const reads = [...s.cards.values()].sort((a, b) => b.readAt - a.readAt).slice(0, 40);
  if (!reads.length) return html`<p class="muted small pad">Les lectures apparaîtront ici.</p>`;
  return html`<div class="recent">
    ${reads.map((r) => {
      const comp = r.competitorId ? s.competitors.get(r.competitorId) : null;
      const active = comp && d.readsByComp.get(comp.id)?.id === r.id;
      const res = active ? d.results.get(comp.id) : null;
      return html`<button type="button" key=${r.id} class=${'recent-item' + (r.id === selected ? ' selected' : '') + (!comp && !r.archived ? ' todo' : '') + (r.archived || (comp && !active) ? ' dim' : '')} onClick=${() => onSelect(r.id)}>
        <span class="recent-time mono">${new Date(r.readAt).toLocaleTimeString('fr-FR').slice(0, 5)}</span>
        <span class="recent-name">
          <strong>${comp ? personName(comp) : r.archived ? 'Lecture ignorée' : 'Puce inconnue'}</strong>
          <small class="mono">${r.number}${comp ? ' · ' + (s.classes.get(comp.classId)?.name || '') : ''}</small>
        </span>
        <span class="recent-res">
          ${res ? html`<${StatusPill} status=${res.status} nc=${comp.nc} />${res.status === 'OK' ? html`<span class="mono small">${fmtDuration(res.time)}</span>` : ''}` : !comp && !r.archived ? html`<${Badge} kind="warn">à traiter<//>` : ''}
        </span>
      </button>`;
    })}
  </div>`;
}

export function ReadoutPage() {
  const s = useStore();
  const st = useStation();
  const d = getDerived();
  const [selected, setSelected] = useState(readout.lastId && s.cards.has(readout.lastId) ? readout.lastId : null);
  const [autoPrint, setAutoPrint] = usePref('autoPrint');
  const [sound, setSound] = usePref('sound');
  useBus('readout', (e) => e?.id && setSelected(e.id), []);

  const todo = d.unassigned;
  const current = selected && s.cards.has(selected) ? selected : null;

  return html`
    <${PageHeader}
      title=${s.event?.mode === 'score' ? 'Lecture des doigts' : 'Lecture des puces'}
      subtitle=${s.event?.mode === 'score' ? 'Insérez chaque doigt dans le lecteur : la note /20 s\'affiche instantanément.' : 'Insérez les puces dans la station maître : le résultat s\'affiche instantanément.'}
    >
      <${Toggle} checked=${autoPrint} onChange=${setAutoPrint} label="Ticket automatique" title="Imprimer le ticket de temps intermédiaires à chaque lecture" />
      <${Toggle} checked=${sound} onChange=${setSound} label="Son" />
      ${isScoreMode(s.event) && html`<${Button} icon="check" onClick=${() => go(`e/${s.eventId}/deroule/controle`)} title="Contrôle des anomalies puis export des notes">Terminer la course</${Button}>`}
    <//>
    <${RaceStatus} />
    ${(!isScoreMode(s.event) || st.connected || st.state === 'connecting') && html`<${StationPanel} />`}

    <div class="readout-grid">
      <div class="readout-main">
        ${st.reading && html`<div class="reading-banner"><${Spinner} /> Lecture de la puce <b class="mono">${st.reading.number}</b>… ne la retirez pas avant le bip.</div>`}
        ${current
          ? html`<${ReadDetail} readId=${current} key=${current} />`
          : html`<div class="card"><${EmptyState} icon="chip" title="En attente d'une puce" text=${st.connected ? 'Insérez une puce dans la station maître.' : 'Connectez le boîtier de lecture pour commencer.'} /></div>`}
      </div>
      <aside class="readout-side">
        ${todo.length > 0 &&
        html`<${Card} title=${html`<span class="text-warn"><${Icon} name="alert" size=${16} /> À traiter (${todo.length})</span>`} pad=${false} class="todo-card">
          <div class="recent">
            ${todo.slice(0, 20).map(
              (r) => html`<button type="button" key=${r.id} class=${'recent-item todo' + (r.id === current ? ' selected' : '')} onClick=${() => setSelected(r.id)}>
                <span class="recent-time mono">${new Date(r.readAt).toLocaleTimeString('fr-FR').slice(0, 5)}</span>
                <span class="recent-name"><strong class="mono">${r.number}</strong><small>${r.note === 'conflict' ? 'déjà lue' : r.note === 'ambiguous' ? 'puce partagée' : 'puce inconnue'}</small></span>
                <${Icon} name="chevronRight" size=${16} />
              </button>`
            )}
          </div>
        <//>`}
        <${Card} title="Dernières lectures" pad=${false}>
          <${RecentReads} selected=${current} onSelect=${setSelected} />
        <//>
        <details class="disclosure card">
          <summary>Journal du boîtier</summary>
          <${StationLog} />
        </details>
      </aside>
    </div>
  `;
}
