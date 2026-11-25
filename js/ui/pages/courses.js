// Circuits : séquence des postes, longueur, dénivelé. Import IOF XML (OCAD, Purple Pen, Condes…).
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { delOp, mutate, put, putOp, store } from '../../core/store.js';
import { compareText, norm, pickFile, readFileText, uid } from '../../core/util.js';
import { parseCourseData } from '../../io/iof.js';
import { Button, EmptyState, Field, IconButton, Modal, PageHeader } from '../components.js';
import { useSettings, useStore } from '../hooks.js';

export function parseControls(text) {
  const tokens = String(text || '')
    .split(/[\s,;\-–>]+/)
    .filter(Boolean);
  const codes = [];
  const bad = [];
  for (const t of tokens) {
    const n = Number(t);
    if (Number.isInteger(n) && n > 0 && n < 1024) codes.push(n);
    else bad.push(t);
  }
  return { codes, bad };
}

export function ControlChips({ controls, max = 0 }) {
  const list = max && controls.length > max ? controls.slice(0, max) : controls;
  return html`<div class="chips">
    <span class="chip chip-start">D</span>
    ${list.map((c, i) => html`<span class="chip" key=${i} title=${`Poste n° ${i + 1}`}>${c}</span>`)}
    ${max && controls.length > max ? html`<span class="chip chip-more">+${controls.length - max}</span>` : ''}
    <span class="chip chip-finish">A</span>
  </div>`;
}

const km = (m) => (m ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : '—');

export function CourseModal({ course, onClose, onSaved }) {
  const [name, setName] = useState(course?.name || '');
  const [length, setLength] = useState(course?.length ? String(course.length / 1000).replace('.', ',') : '');
  const [climb, setClimb] = useState(course?.climb ? String(course.climb) : '');
  const [text, setText] = useState((course?.controls || []).join(' '));
  const { codes, bad } = parseControls(text);
  const valid = name.trim() && !bad.length;
  const save = () => {
    if (!valid) return;
    const lenNum = Number(String(length).replace(',', '.'));
    const doc = {
      ...(course || {}),
      id: course?.id || uid(),
      name: name.trim(),
      length: Number.isFinite(lenNum) ? Math.round(lenNum * 1000) : 0,
      climb: Number(climb) || 0,
      controls: codes,
    };
    put('course', doc);
    onSaved?.(doc);
    onClose();
  };
  return html`<${Modal}
    title=${course ? `Circuit ${course.name}` : 'Nouveau circuit'}
    onClose=${onClose}
    onSubmit=${save}
    footer=${html`<${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${!valid}>Enregistrer</${Button}>`}
  >
    <div class="form-grid cols-3">
      <${Field} label="Nom du circuit"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ex. : A, Violet long…" /><//>
      <${Field} label="Longueur (km)"><input class="input" value=${length} onInput=${(e) => setLength(e.target.value)} inputmode="decimal" placeholder="4,5" /><//>
      <${Field} label="Dénivelé (m)"><input class="input" value=${climb} onInput=${(e) => setClimb(e.target.value)} inputmode="numeric" placeholder="120" /><//>
    </div>
    <${Field}
      label="Postes, dans l'ordre"
      hint="Numéros de postes séparés par des espaces (le départ et l'arrivée sont implicites)."
      error=${bad.length ? `Valeurs non reconnues : ${bad.join(', ')}` : ''}
    >
      <textarea class="input mono" rows="3" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="31 45 52 38 61 100"></textarea>
    <//>
    <div class="field-label">Aperçu · ${codes.length} poste${codes.length > 1 ? 's' : ''}</div>
    <${ControlChips} controls=${codes} />
  <//>`;
}

function ImportModal({ data, onClose }) {
  const existing = new Map([...store.courses.values()].map((c) => [norm(c.name), c]));
  const [withClasses, setWithClasses] = useState(data.assignments.length > 0);
  const doImport = () => {
    const ops = [];
    const courseIds = new Map();
    for (const c of data.courses) {
      const prev = existing.get(norm(c.name));
      const doc = { ...(prev || {}), id: prev?.id || uid(), name: c.name, length: c.length, climb: c.climb, controls: c.controls };
      courseIds.set(norm(c.name), doc.id);
      ops.push(putOp('course', doc));
    }
    let nClasses = 0;
    if (withClasses) {
      const classes = new Map([...store.classes.values()].map((c) => [norm(c.name), c]));
      for (const a of data.assignments) {
        const courseId = courseIds.get(norm(a.courseName));
        if (!courseId) continue;
        const prev = classes.get(norm(a.className));
        ops.push(putOp('class', { ...(prev || { interval: 120, drawMode: 'random' }), id: prev?.id || uid(), name: prev?.name || a.className, courseId }));
        nClasses++;
      }
    }
    mutate(ops);
    toast(`${data.courses.length} circuit(s) importé(s)${nClasses ? `, ${nClasses} catégorie(s) associée(s)` : ''}.`, 'success');
    onClose();
  };
  return html`<${Modal}
    title="Importer des circuits"
    size="lg"
    onClose=${onClose}
    footer=${html`<${Button} onClick=${onClose}>Annuler</${Button}><${Button} variant="primary" icon="upload" onClick=${doImport}>Importer ${data.courses.length} circuit${data.courses.length > 1 ? 's' : ''}</${Button}>`}
  >
    <div class="table-wrap bordered"><table class="table">
      <thead><tr><th>Circuit</th><th class="num">Longueur</th><th class="num">Postes</th><th>État</th></tr></thead>
      <tbody>
        ${data.courses.map(
          (c) => html`<tr>
            <td><strong>${c.name}</strong></td>
            <td class="num">${km(c.length)}</td>
            <td class="num">${c.controls.length}</td>
            <td>${existing.has(norm(c.name)) ? html`<span class="badge badge-warn">remplacera l'existant</span>` : html`<span class="badge badge-ok">nouveau</span>`}</td>
          </tr>`
        )}
      </tbody>
    </table></div>
    ${data.assignments.length > 0 &&
    html`<label class="check mt">
      <input type="checkbox" checked=${withClasses} onChange=${(e) => setWithClasses(e.target.checked)} />
      <span>Créer / associer aussi les <strong>${data.assignments.length} catégories</strong> définies dans le fichier
        <span class="muted">(${data.assignments.slice(0, 8).map((a) => a.className).join(', ')}${data.assignments.length > 8 ? '…' : ''})</span></span>
    </label>`}
  <//>`;
}

// --- Bibliothèque : circuits enregistrés dans les réglages de l'application ------------------------
export function CourseLibrary({ onPick, emptyText = 'Aucun circuit enregistré : créez-en dans les Réglages (accueil).' }) {
  const st = useSettings();
  if (st.error) return html`<p class="text-err small">${st.error}</p>`;
  if (!st.loaded) return html`<p class="muted small">Chargement des circuits…</p>`;
  if (!st.circuits.length) return html`<p class="muted small">${emptyText}</p>`;
  return html`<div class="library">
    ${st.circuits.map(
      (c) => html`<div class="library-item" key=${c.id}>
        <div class="library-info">
          <strong>${c.name} · ${c.controls.length} balises</strong>
          <${ControlChips} controls=${c.controls} max=${14} />
        </div>
        <${Button} small variant="primary" icon="check" onClick=${() => onPick(c)}>Utiliser</${Button}>
      </div>`
    )}
  </div>`;
}

/**
 * Reprend un circuit de la bibliothèque dans l'épreuve ouverte. En course au score (un seul circuit),
 * il remplace les balises du circuit existant ; sinon il est ajouté.
 */
export function applyLibraryCourse(src, { replace = null } = {}) {
  const base = { length: src.length || 0, climb: src.climb || 0, controls: [...src.controls], ...(src.id ? { libraryId: src.id, name: src.name } : {}) };
  let doc;
  if (replace) doc = { ...replace, ...base };
  else {
    const names = new Set([...store.courses.values()].map((c) => norm(c.name)));
    let name = src.name || 'Circuit';
    for (let k = 2; names.has(norm(name)); k++) name = `${src.name || 'Circuit'} (${k})`;
    doc = { id: uid(), name, ...base };
  }
  const ops = [putOp('course', doc)];
  for (const cls of store.classes.values()) {
    if (!cls.courseId || !store.courses.has(cls.courseId)) ops.push(putOp('class', { ...cls, courseId: doc.id }));
  }
  mutate(ops);
  toast(`Circuit repris : ${doc.controls.length} balises (${doc.controls.join(' ')}).`, 'success');
  return doc;
}

export function CourseLibraryModal({ onClose, replace = null }) {
  return html`<${Modal} title="Reprendre un circuit existant" size="lg" onClose=${onClose}>
    <p class="muted small">Circuits enregistrés dans les réglages. ${replace ? `Les balises du circuit « ${replace.name} » seront remplacées.` : 'Le circuit choisi sera ajouté à cette épreuve.'}</p>
    <${CourseLibrary}
      onPick=${(src) => {
        applyLibraryCourse(src, { replace });
        onClose();
      }}
    />
  <//>`;
}

export function CoursesPage() {
  const s = useStore();
  const [editing, setEditing] = useState(null); // null | 'new' | course
  const [importing, setImporting] = useState(null);
  const [library, setLibrary] = useState(false);
  const courses = [...s.courses.values()].sort((a, b) => compareText(a.name, b.name));
  const scoreSingle = s.event?.mode === 'score' && courses.length === 1 ? courses[0] : null;
  const classesOf = (id) => [...s.classes.values()].filter((c) => c.courseId === id).sort((a, b) => compareText(a.name, b.name));

  const importXml = async () => {
    const file = await pickFile('.xml,text/xml,application/xml');
    if (!file) return;
    try {
      setImporting(parseCourseData(await readFileText(file)));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const del = async (course) => {
    const used = classesOf(course.id);
    const ok = await confirmDialog({
      title: 'Supprimer le circuit',
      message: used.length
        ? `Le circuit « ${course.name} » est utilisé par ${used.map((c) => c.name).join(', ')}. Ces catégories n'auront plus de circuit.`
        : `Supprimer le circuit « ${course.name} » ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) mutate([delOp('course', course.id)]);
  };

  return html`
    <${PageHeader}
      title=${s.event?.mode === 'score' ? 'Balises' : 'Circuits'}
      subtitle=${s.event?.mode === 'score' ? 'Les balises à poinçonner, dans n\'importe quel ordre.' : 'La séquence de postes de chaque circuit sert à contrôler les puces.'}
    >
      <${Button} icon="list" onClick=${() => setLibrary(true)}>Reprendre un circuit existant</${Button}>
      <${Button} icon="upload" onClick=${importXml}>Importer (IOF XML)</${Button}>
      <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouveau circuit</${Button}>
    <//>
    ${courses.length
      ? html`<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>Circuit</th><th class="num">Longueur</th><th class="num">Dénivelé</th><th class="num">Postes</th><th>Séquence</th><th>Catégories</th><th></th></tr></thead>
          <tbody>
            ${courses.map(
              (c) => html`<tr key=${c.id} class="clickable" onClick=${() => setEditing(c)}>
                <td><strong>${c.name}</strong></td>
                <td class="num">${km(c.length)}</td>
                <td class="num">${c.climb ? c.climb + ' m' : '—'}</td>
                <td class="num">${c.controls?.length || 0}</td>
                <td><${ControlChips} controls=${c.controls || []} max=${12} /></td>
                <td>${classesOf(c.id).map((cl) => cl.name).join(', ') || html`<span class="muted">—</span>`}</td>
                <td class="actions" onClick=${(e) => e.stopPropagation()}>
                  <${IconButton} icon="edit" title="Modifier" onClick=${() => setEditing(c)} />
                  <${IconButton} icon="trash" title="Supprimer" onClick=${() => del(c)} />
                </td>
              </tr>`
            )}
          </tbody>
        </table></div></div>`
      : html`<div class="card"><${EmptyState}
          icon="route"
          title="Aucun circuit"
          text="Importez le fichier IOF XML exporté par votre logiciel de traçage (OCAD, Purple Pen, Condes…) ou saisissez les postes à la main."
        >
          <${Button} icon="upload" onClick=${importXml}>Importer (IOF XML)</${Button}>
          <${Button} icon="plus" variant="primary" onClick=${() => setEditing('new')}>Nouveau circuit</${Button}>
        <//></div>`}
    ${editing && html`<${CourseModal} course=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}
    ${importing && html`<${ImportModal} data=${importing} onClose=${() => setImporting(null)} />`}
    ${library && html`<${CourseLibraryModal} replace=${scoreSingle} onClose=${() => setLibrary(false)} />`}
  `;
}
