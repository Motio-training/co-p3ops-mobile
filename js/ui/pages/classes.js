// Catégories : nom et circuit associé.
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { delOp, getDerived, mutate, put, putOp, store } from '../../core/store.js';
import { compareText, norm, uid } from '../../core/util.js';
import { Button, EmptyState, Field, IconButton, Modal, PageHeader } from '../components.js';
import { useStore } from '../hooks.js';

export function sortedCourses() {
  return [...store.courses.values()].sort((a, b) => compareText(a.name, b.name));
}

export function sortedClasses() {
  return [...store.classes.values()].sort((a, b) => compareText(a.name, b.name));
}

function ClassModal({ cls, onClose }) {
  const [name, setName] = useState(cls?.name || '');
  const [courseId, setCourseId] = useState(cls?.courseId || sortedCourses()[0]?.id || '');
  const duplicate = [...store.classes.values()].some((c) => c.id !== cls?.id && norm(c.name) === norm(name));
  const valid = name.trim() && !duplicate;
  const save = () => {
    if (!valid) return;
    put('class', { interval: 120, drawMode: 'random', ...(cls || {}), id: cls?.id || uid(), name: name.trim(), courseId });
    onClose();
  };
  return html`<${Modal}
    title=${cls ? `Catégorie ${cls.name}` : 'Nouvelle catégorie'}
    size="sm"
    onClose=${onClose}
    onSubmit=${save}
    footer=${html`<${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${!valid}>Enregistrer</${Button}>`}
  >
    <${Field} label="Nom" error=${duplicate ? 'Une catégorie porte déjà ce nom.' : ''} hint="Ex. : H21, D16, Open jaune…">
      <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} />
    <//>
    <${Field} label="Circuit">
      <select class="input" value=${courseId} onChange=${(e) => setCourseId(e.target.value)}>
        <option value="">— Aucun —</option>
        ${sortedCourses().map((c) => html`<option value=${c.id}>${c.name} (${c.controls?.length || 0} postes)</option>`)}
      </select>
    <//>
  <//>`;
}

export function ClassesPage() {
  const s = useStore();
  const d = getDerived();
  const [editing, setEditing] = useState(null);
  const classes = sortedClasses();
  const courses = sortedCourses();

  const fromCourses = () => {
    const existing = new Set([...s.classes.values()].map((c) => norm(c.name)));
    const ops = courses.filter((c) => !existing.has(norm(c.name))).map((c) => putOp('class', { id: uid(), name: c.name, courseId: c.id, interval: 120, drawMode: 'random' }));
    if (!ops.length) return toast('Chaque circuit a déjà une catégorie du même nom.', 'info');
    mutate(ops);
    toast(`${ops.length} catégorie(s) créée(s).`, 'success');
  };

  const del = async (cls) => {
    const n = d.classes.get(cls.id)?.rows.length || 0;
    const ok = await confirmDialog({
      title: 'Supprimer la catégorie',
      message: n ? `${n} coureur(s) sont inscrits en ${cls.name} : ils n'auront plus de catégorie.` : `Supprimer la catégorie « ${cls.name} » ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) mutate([delOp('class', cls.id)]);
  };

  return html`
    <${PageHeader} title="Catégories" subtitle="Chaque catégorie court sur un circuit. Plusieurs catégories peuvent partager le même circuit.">
      ${courses.length > 0 && html`<${Button} icon="route" onClick=${fromCourses}>Une catégorie par circuit</${Button}>`}
      <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouvelle catégorie</${Button}>
    <//>
    ${classes.length
      ? html`<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>Catégorie</th><th>Circuit</th><th class="num">Postes</th><th class="num">Inscrits</th><th class="num">Arrivés</th><th></th></tr></thead>
          <tbody>
            ${classes.map((cls) => {
              const rows = d.classes.get(cls.id)?.rows || [];
              const course = s.courses.get(cls.courseId);
              return html`<tr key=${cls.id}>
                <td><strong>${cls.name}</strong></td>
                <td>
                  <select class=${'input input-sm' + (course ? '' : ' invalid')} value=${course ? cls.courseId : ''} onChange=${(e) => put('class', { ...cls, courseId: e.target.value })}>
                    <option value="">— Aucun circuit —</option>
                    ${courses.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
                  </select>
                </td>
                <td class="num">${course?.controls?.length ?? '—'}</td>
                <td class="num">${rows.length}</td>
                <td class="num">${rows.filter((r) => r.res.status !== 'RUN' && r.res.status !== 'DNS').length}</td>
                <td class="actions">
                  <${IconButton} icon="edit" title="Modifier" onClick=${() => setEditing(cls)} />
                  <${IconButton} icon="trash" title="Supprimer" onClick=${() => del(cls)} />
                </td>
              </tr>`;
            })}
          </tbody>
        </table></div></div>`
      : html`<div class="card"><${EmptyState} icon="tag" title="Aucune catégorie" text=${courses.length ? 'Créez une catégorie par circuit en un clic, ou ajoutez-les une à une.' : "Commencez par créer les circuits, puis les catégories qui les utilisent."}>
          ${courses.length > 0 && html`<${Button} icon="route" onClick=${fromCourses}>Une catégorie par circuit</${Button}>`}
          <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouvelle catégorie</${Button}>
        <//></div>`}
    ${editing && html`<${ClassModal} cls=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}
  `;
}
