// Menus « Circuits » et « Barèmes » de l'accueil : circuits et barèmes communs à toutes les courses.
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { deleteBareme, deleteCircuit, saveCircuit } from '../../core/settings.js';
import { Button, EmptyState, Field, Icon, IconButton, Modal, Spinner } from '../components.js';
import { useSettings } from '../hooks.js';
import { ControlChips } from './courses.js';
import { ControlPicker } from './control-picker.js';
import { BaremeEditorModal, BaremeSummary } from './bareme.js';

/** Création / modification d'un circuit de la bibliothèque. */
export function CircuitEditorModal({ circuit, onClose, onSaved }) {
  const [name, setName] = useState(circuit?.name || '');
  const [codes, setCodes] = useState([...(circuit?.controls || [])]);
  const error = !name.trim() ? 'Donnez un nom au circuit.' : !codes.length ? 'Sélectionnez au moins une balise.' : '';
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
    size="lg"
    onClose=${onClose}
    onSubmit=${save}
    footer=${html`<span class="text-err small">${error}</span><span class="spacer"></span>
      <${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${!!error}>Enregistrer</${Button}>`}
  >
    <${Field} label="Nom du circuit"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ex. : Circuit 20 balises" /><//>
    <div class="field-label">Balises du circuit · touchez une balise pour l'ajouter ou la retirer</div>
    <${ControlPicker} value=${codes} onChange=${setCodes} />
    <p class="muted small mt">En course au score, l'ordre n'a pas d'importance. Pour une course en ligne, touchez les balises dans l'ordre de passage.</p>
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

/** Page « Circuits » ou « Barèmes » (ouverte depuis l'accueil). */
export function SettingsPage({ tab = 'circuits' }) {
  const st = useSettings();
  const current = tab === 'baremes' ? 'baremes' : 'circuits';
  const head =
    current === 'circuits'
      ? { title: 'Circuits', sub: "Les circuits proposés à chaque nouvelle course. Les balises se choisissent d'un clic." }
      : { title: 'Barèmes', sub: 'Les barèmes de notation proposés à chaque nouvelle course.' };
  return html`
    <header class="page-head">
      <div>
        <h1>${head.title}</h1>
        <p class="page-sub">${head.sub}</p>
      </div>
      ${!location.hash.startsWith('#/e/') && html`<div class="page-actions"><${Button} icon="arrowLeft" onClick=${() => (location.hash = '#/')}>Accueil</${Button}></div>`}
    </header>
    ${st.error && html`<div class="banner banner-error"><${Icon} name="alert" /> ${st.error}</div>`}
    ${!st.loaded && !st.error
      ? html`<${Spinner} label="Chargement…" />`
      : st.loaded && (current === 'circuits' ? html`<${CircuitsTab} />` : html`<${BaremesTab} />`)}
  `;
}
