// Lecture des puces hors course (contenu de la puce) et effacement des puces.
// Les puces lues ici ne sont enregistrées dans aucune course.
import { html, useEffect, useState } from '../../lib.js';
import { bus, confirmDialog, toast } from '../../core/bus.js';
import { chipReader } from '../../core/readout.js';
import { fmtClock, fmtDuration } from '../../core/time.js';
import { station, humanError } from '../../sportident/station.js';
import { CARD_LABELS } from '../../sportident/constants.js';
import { Button, Card, EmptyState, Icon } from '../components.js';
import { useStation } from '../hooks.js';

const time = (t) => (t == null ? html`<span class="muted">—</span>` : html`<span class="mono">${fmtClock(t)}</span>`);

function ChipDetail({ card, onClear, canClear }) {
  const empty = !card.punches.length && card.start == null && card.finish == null;
  const total = card.start != null && card.finish != null ? card.finish - card.start : null;
  return html`<div class="chip-detail">
    <div class="chip-head">
      <div>
        <div class="chip-number mono">${card.number}</div>
        <div class="muted small">${CARD_LABELS[card.type] || card.type} · lue à ${new Date(card.readAt).toLocaleTimeString('fr-FR')}</div>
      </div>
      ${empty
        ? html`<span class="badge badge-ok">Puce vide</span>`
        : html`<span class="badge badge-warn">${card.punches.length} poinçon${card.punches.length > 1 ? 's' : ''}</span>`}
    </div>
    <dl class="facts chip-facts">
      <dt>Effacement</dt><dd>${time(card.clear)}</dd>
      <dt>Contrôle</dt><dd>${time(card.check)}</dd>
      <dt>Départ</dt><dd>${time(card.start)}</dd>
      <dt>Arrivée</dt><dd>${time(card.finish)}</dd>
      ${total != null && total >= 0 && html`<dt>Temps</dt><dd><strong class="mono">${fmtDuration(total)}</strong></dd>`}
    </dl>
    ${card.punches.length > 0 &&
    html`<div class="table-wrap bordered mt"><table class="table table-tight">
      <thead><tr><th class="num">#</th><th class="num">Balise</th><th class="num">Heure</th></tr></thead>
      <tbody>
        ${card.punches.map(
          (p, i) => html`<tr key=${i}><td class="num muted">${i + 1}</td><td class="num mono"><strong>${p.code}</strong></td><td class="num">${time(p.time)}</td></tr>`
        )}
      </tbody>
    </table></div>`}
    ${canClear &&
    html`<div class="row-actions mt">
      <${Button} variant="danger" icon="trash" onClick=${onClear}>Effacer cette puce</${Button}>
    </div>`}
  </div>`;
}

export function ChipsPanel() {
  const st = useStation();
  const [chips, setChips] = useState([]); // puces lues pendant cette visite, la plus récente en premier
  const [current, setCurrent] = useState(null);
  const [clearing, setClearing] = useState(!!station.clearing);
  const [cleared, setCleared] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    chipReader.active = true;
    const off = bus.on('chip-read', (card) => {
      const c = { ...card, readAt: Date.now() };
      setChips((l) => [c, ...l.filter((x) => x.number !== c.number)].slice(0, 40));
      setCurrent(c.number);
    });
    const onCleared = (e) => setCleared((l) => [{ number: e.detail.number, at: Date.now() }, ...l.filter((x) => x.number !== e.detail.number)]);
    const onClearing = (e) => setClearing(e.detail.on);
    station.addEventListener('card-cleared', onCleared);
    station.addEventListener('clearing', onClearing);
    return () => {
      chipReader.active = false;
      off();
      station.removeEventListener('card-cleared', onCleared);
      station.removeEventListener('clearing', onClearing);
      // On quitte la page : le lecteur ne doit surtout pas rester en « Effacement ».
      if (station.clearing) station.stopClearing().catch(() => toast("Remettez le lecteur en mode Lecture (onglet Boîtiers) : il est resté en mode Effacement.", 'error'));
    };
  }, []);

  const startClearing = async (number = null) => {
    const ok = await confirmDialog({
      title: number ? `Effacer la puce ${number}` : 'Effacer des puces',
      message: `Le lecteur passe en mode « Effacement » : ${number ? 'la puce' : 'chaque puce'} insérée sera vidée (poinçons, départ, arrivée). C'est définitif : exportez d'abord les notes de la course si ce n'est pas fait.`,
      confirmLabel: 'Passer en effacement',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await station.startClearing();
      setCleared([]);
      toast(number ? `Retirez la puce ${number}, puis réinsérez-la : le lecteur l'efface.` : 'Insérez les puces à effacer, une par une.', 'warning', { duration: 8000 });
    } catch (e) {
      toast(`Passage en effacement impossible : ${humanError(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stopClearing = async () => {
    setBusy(true);
    try {
      await station.stopClearing();
      toast('Lecteur remis en mode Lecture. Insérez une puce effacée pour vérifier qu’elle est vide.', 'success', { duration: 8000 });
    } catch (e) {
      toast(`Retour en mode Lecture impossible : ${humanError(e)}. Débranchez puis rebranchez le lecteur.`, 'error', { duration: 12000 });
    } finally {
      setBusy(false);
    }
  };

  const card = chips.find((c) => c.number === current) || chips[0];

  return html`
    ${clearing
      ? html`<div class="clearing-banner">
          <${Icon} name="alert" size=${26} />
          <div>
            <strong>Mode Effacement : chaque puce insérée dans le lecteur est vidée.</strong>
            <span>Insérez les puces une par une et attendez le bip. ${cleared.length ? `${cleared.length} puce${cleared.length > 1 ? 's' : ''} insérée${cleared.length > 1 ? 's' : ''} : ${cleared.map((c) => c.number).join(', ')}.` : ''}</span>
          </div>
          <${Button} variant="primary" icon="check" onClick=${stopClearing} disabled=${busy}>${busy ? 'Patientez…' : "Terminer l'effacement"}</${Button}>
        </div>`
      : null}
    <div class="grid-2 stations-grid">
      <${Card} title="Lire une puce">
        <ol class="howto">
          <li><b>Insérez la puce</b> dans le lecteur USB et attendez le bip.</li>
          <li>Son contenu s'affiche : poinçons, départ, arrivée, effacement.</li>
        </ol>
        <p class="muted small">Les puces lues ici ne sont enregistrées dans aucune course.</p>
        ${!st.connected && html`<p class="text-warn small mt">Connectez d'abord le lecteur (en haut de la page).</p>`}
        ${chips.length > 1 &&
        html`<div class="chips-line mt">
          ${chips.map(
            (c) => html`<button type="button" class=${'xp-chip' + (c === card ? ' on' : '')} onClick=${() => setCurrent(c.number)}>${c.number}</button>`
          )}
        </div>`}
        ${card
          ? html`<div class="mt"><${ChipDetail} card=${card} canClear=${st.connected && !clearing} onClear=${() => startClearing(card.number)} /></div>`
          : html`<${EmptyState} icon="search" title="Aucune puce lue" text=${clearing ? 'Terminez l’effacement pour lire les puces.' : 'Insérez une puce dans le lecteur.'} />`}
      <//>

      <${Card} title="Effacer des puces">
        <p>Avant une nouvelle course, les puces doivent être vides. Le lecteur passe en mode <b>Effacement</b> : chaque puce insérée est vidée (poinçons, départ, arrivée), puis il revient en mode <b>Lecture</b> quand vous cliquez sur « Terminer l'effacement ».</p>
        <p class="muted small">C'est définitif : exportez d'abord les notes de la course. Si le lecteur est débranché pendant l'effacement, il est remis en mode Lecture à la prochaine connexion.</p>
        <div class="row-actions">
          ${clearing
            ? html`<${Button} variant="primary" icon="check" onClick=${stopClearing} disabled=${busy}>Terminer l'effacement</${Button}>`
            : html`<${Button} variant="danger" icon="trash" onClick=${() => startClearing()} disabled=${!st.connected || busy}>Effacer des puces</${Button}>`}
        </div>
      <//>
    </div>
  `;
}
