// Formulaire de course (création et modification).
import { html, useState } from '../../lib.js';
import { Button, Field, Modal } from '../components.js';
import { todayIso } from '../../core/util.js';

export const EVENT_MODES = [
  {
    value: 'score',
    label: 'Course au score',
    text: "Balises dans n'importe quel ordre, 1re balise imposée, note /20 selon le barème choisi, résultats par section et export Excel.",
  },
  {
    value: 'classic',
    label: 'Course en ligne',
    text: "Postes à poinçonner dans l'ordre du circuit, classement au temps par catégorie.",
  },
];

// Le départ se fait toujours en poinçonnant le boîtier « Départ » (heure lue dans la puce).
export const START_MODES = [
  {
    value: 'card',
    label: 'Départ au boîtier',
    text: "L'heure de départ est lue dans la puce (boîtier « Départ »).",
  },
  {
    value: 'list',
    label: 'Heures de départ attribuées',
    text: "L'heure de départ vient de la liste de départ. La puce sert si aucune heure n'est attribuée.",
  },
];

function RadioCards({ name, options, value, onChange }) {
  return html`<div class="radio-cards">
    ${options.map(
      (m) => html`<label class=${'radio-card' + (value === m.value ? ' checked' : '')}>
        <input type="radio" name=${name} checked=${value === m.value} onChange=${() => onChange(m.value)} />
        <span class="radio-title">${m.label}</span>
        <span class="radio-text">${m.text}</span>
      </label>`
    )}
  </div>`;
}

export function EventModal({ initial, title, submitLabel, onSubmit, onClose }) {
  const creating = !initial?.id;
  const [ev, setEv] = useState({
    name: '',
    date: todayIso(),
    place: '',
    organizer: '',
    zeroTime: 10 * 3600,
    ...initial,
    startMode: 'card',
    mode: initial?.mode || (creating ? 'score' : 'classic'),
  });
  const set = (k) => (v) => setEv((e) => ({ ...e, [k]: v }));
  const valid = ev.name.trim().length > 0;
  return html`<${Modal}
    title=${title}
    size="lg"
    onClose=${onClose}
    onSubmit=${() => valid && onSubmit({ ...ev, name: ev.name.trim() })}
    footer=${html`<${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${!valid}>${submitLabel}</${Button}>`}
  >
    ${creating &&
    html`<div class="field-label">Type de course</div>
      <${RadioCards} name="mode" options=${EVENT_MODES} value=${ev.mode} onChange=${set('mode')} />
      <div style="height:16px"></div>`}
    <div class="form-grid">
      <${Field} label="Nom de la course" class="span-2">
        <input class="input" value=${ev.name} onInput=${(e) => set('name')(e.target.value)} placeholder=${ev.mode === 'score' ? 'Ex. : CO section 1' : 'Ex. : Régionale de la forêt de Fontainebleau'} />
      <//>
      <${Field} label="Date">
        <input class="input" type="date" value=${ev.date} onInput=${(e) => set('date')(e.target.value)} />
      <//>
      <${Field} label="Lieu">
        <input class="input" value=${ev.place} onInput=${(e) => set('place')(e.target.value)} placeholder="Ex. : terrain d'entraînement" />
      <//>
      <${Field} label="Organisateur" class="span-2">
        <input class="input" value=${ev.organizer} onInput=${(e) => set('organizer')(e.target.value)} placeholder="Unité ou club organisateur" />
      <//>
    </div>
    <p class="muted small mt">Le temps de chaque participant est compté à partir du poinçon du boîtier « Départ ».</p>
  <//>`;
}
