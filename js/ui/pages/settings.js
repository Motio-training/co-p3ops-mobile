// Réglages de l'application : bibliothèque de circuits et barèmes de notation.
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { deleteBareme, deleteCircuit, saveCircuit } from '../../core/settings.js';
import { Button, EmptyState, Field, Icon, IconButton, Modal, Spinner } from '../components.js';
import { useSettings } from '../hooks.js';
import { ControlChips, parseControls } from './courses.js';
import { BaremeEditorModal, BaremeSummary } from './bareme.js';

/** Création / modification d'un circuit de la bibliothèque. */
export function CircuitEditorModal({ circuit, onClose, onSaved }) {
  const [name, setName] = useState(circuit?.name || '');
  const [text, setText] = useState((circuit?.controls || []).join(' '));
  const { codes, bad } = parseControls(text);
  const dups = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
  const error = !name.trim()
    ? 'Donnez un nom au circuit.'
    : bad.length
      ? `Valeurs non reconnues : ${bad.join(', ')} (numéros de 1 à 1023 attendus).`
      : !codes.length
        ? 'Saisissez au moins une balise.'
        : dups.length
          ? `Balise en double : ${dups.join(', ')}.`
          : '';
  const save = async () => {
    if (error) return;
    try {
      const doc = await saveCircuit({ ...(circuit || {}), name: name.trim(), controls: codes });
      toast(`Circuit « ${doc.name} » enregistré.`, 'success');
      onSaved?.(doc);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return html`<${Modal}
    title=${circuit?.id ? `Circuit « ${circuit.name} »` : 'Nouveau circuit'}
    onClose=${onClose}
    onSubmit=${save}
    footer=${html`<span class="text-err small">${error}</span><span class="spacer"></span>
      <${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${!!error}>Enregistrer</${Button}>`}
  >
    <${Field} label="Nom du circuit"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ex. : Circuit 20 balises" /><//>
    <${Field} label="Numéros des balises" hint="Séparés par des espaces. En course au score, l'ordre n'a pas d'importance.">
      <textarea class="input mono" rows="3" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="31 32 33 34 35 …"></textarea>
    <//>
    <div class="field-label">Aperçu · ${codes.length} balise${codes.length > 1 ? 's' : ''}</div>
    <${ControlChips} controls=${codes} />
  <//>`;
}

function CircuitsTab() {
  const st = useSettings();
  const [editing, setEditing] = useState(null);
  const del = async (c) => {
    const ok = await confirmDialog({
      title: 'Supprimer le circuit',
      message: `Supprimer « ${c.name} » de la liste ? Les courses qui l'utilisent déjà gardent leurs balises.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) deleteCircuit(c.id).catch((e) => toast(e.message, 'error'));
  };
  return html`
    <div class="settings-head">
      <p class="muted">Les circuits proposés dans la liste « Balises du circuit » lors de la préparation d'une course.</p>
      <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouveau circuit</${Button}>
    </div>
    ${st.circuits.length
      ? html`<div class="library">
          ${st.circuits.map(
            (c) => html`<div class="library-item" key=${c.id}>
              <div class="library-info">
                <strong>${c.name} · ${c.controls.length} balises</strong>
                <${ControlChips} controls=${c.controls} max=${24} />
              </div>
              <div class="row-actions tight">
                <${IconButton} icon="edit" title="Modifier" onClick=${() => setEditing(c)} />
                <${IconButton} icon="trash" title="Supprimer" onClick=${() => del(c)} />
              </div>
            </div>`
          )}
        </div>`
      : html`<div class="card"><${EmptyState} icon="route" title="Aucun circuit" text="Créez le circuit de vos courses (par exemple les 20 balises du camp) : il sera proposé à chaque nouvelle course.">
          <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouveau circuit</${Button}>
        <//></div>`}
    ${editing && html`<${CircuitEditorModal} circuit=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}
  `;
}

function BaremesTab() {
  const st = useSettings();
  const [editing, setEditing] = useState(null);
  const del = async (b) => {
    if (st.baremes.length <= 1) return toast('Il faut garder au moins un barème.', 'warning');
    const ok = await confirmDialog({
      title: 'Supprimer le barème',
      message: `Supprimer « ${b.name} » ? Les courses qui l'utilisent déjà gardent leur barème.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) deleteBareme(b.id).catch((e) => toast(e.message, 'error'));
  };
  const duplicate = (b) => {
    const { id, ...rest } = b;
    setEditing({ ...JSON.parse(JSON.stringify(rest)), name: `${b.name} (copie)` });
  };
  return html`
    <div class="settings-head">
      <p class="muted">Les barèmes proposés à l'étape « Barème de notation » lors de la préparation d'une course.</p>
      <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouveau barème</${Button}>
    </div>
    <div class="bareme-list">
      ${st.baremes.map(
        (b) => html`<section class="card bareme-card" key=${b.id}>
          <header class="card-head">
            <h2>${b.name}</h2>
            <div class="card-actions">
              <${Button} small icon="list" onClick=${() => duplicate(b)}>Dupliquer</${Button}>
              <${IconButton} icon="edit" title="Modifier" onClick=${() => setEditing(b)} />
              <${IconButton} icon="trash" title="Supprimer" onClick=${() => del(b)} />
            </div>
          </header>
          <div class="card-body"><${BaremeSummary} cfg=${b} /></div>
        </section>`
      )}
    </div>
    ${editing && html`<${BaremeEditorModal} bareme=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}
  `;
}

export function SettingsPage({ tab = 'circuits' }) {
  const st = useSettings();
  const tabs = [
    { id: 'circuits', label: 'Circuits', icon: 'route' },
    { id: 'baremes', label: 'Barèmes', icon: 'trophy' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'circuits';
  return html`
    <header class="page-head">
      <div>
        <h1>Réglages</h1>
        <p class="page-sub">Circuits et barèmes communs à toutes les courses.</p>
      </div>
      ${!location.hash.startsWith('#/e/') && html`<div class="page-actions"><${Button} icon="arrowLeft" onClick=${() => (location.hash = '#/')}>Accueil</${Button}></div>`}
    </header>
    <div class="tabs">
      ${tabs.map(
        (t) => html`<a class=${'tab' + (current === t.id ? ' active' : '')} href=${`#/reglages/${t.id}`}><${Icon} name=${t.icon} size=${16} />${t.label}</a>`
      )}
    </div>
    ${st.error && html`<div class="banner banner-error"><${Icon} name="alert" /> ${st.error}</div>`}
    ${!st.loaded && !st.error
      ? html`<${Spinner} label="Chargement des réglages…" />`
      : st.loaded && (current === 'circuits' ? html`<${CircuitsTab} />` : html`<${BaremesTab} />`)}
  `;
}
