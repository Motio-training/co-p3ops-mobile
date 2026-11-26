// Déroulé guidé d'une course au score, étape par étape, en plein écran :
// inscriptions → balises du circuit → barème → « Course prête » → (après la course) contrôle → export.
import { html, useEffect, useState } from '../../lib.js';
import { getDerived, mutate, putOp, updateEvent } from '../../core/store.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { compareText, downloadFile, personName, plural } from '../../core/util.js';
import { scoringFromBareme, sameScoring } from '../../core/settings.js';
import { sectionKey, sectionLabel } from '../../domain/results.js';
import { printHtml, resultsHtml } from '../../io/reports.js';
import { Button, Icon } from '../components.js';
import { go, useSettings, useStore } from '../hooks.js';
import { ControlChips, applyLibraryCourse } from './courses.js';
import { CompetitorModal, EntriesImportModal, chooseEntriesFile } from './competitors.js';
import { BaremeEditorModal, BaremeSummary } from './bareme.js';
import { CircuitEditorModal } from './settings.js';
import { runExcelExport } from './results.js';

const BLANK_FILE_NAME = "Fichier d'inscription CO.xlsx";

function Issue({ kind = 'warn', children, action }) {
  return html`<div class=${'issue issue-' + kind}>
    <${Icon} name=${kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'} size=${16} />
    <span>${children}</span>
    ${action}
  </div>`;
}

/** Le circuit de la course au score (le premier qui a des balises). */
export function scoreCourse(s) {
  return [...s.courses.values()].find((c) => c.controls?.length) || null;
}

/**
 * Points de contrôle de la préparation, communs au déroulé, à la lecture et à l'accueil.
 * Renvoie [{ id, label, ok, detail }].
 */
export function preparationChecks(s) {
  const comps = [...s.competitors.values()];
  const named = comps.filter((c) => c.lastName || c.firstName);
  const course = scoreCourse(s);
  const controls = new Set(course?.controls || []);
  const badFirst = course ? comps.filter((c) => c.firstControl != null && !controls.has(Number(c.firstControl))) : [];
  return [
    {
      id: 'inscriptions',
      label: 'Inscriptions importées',
      ok: comps.length > 0,
      detail: !comps.length
        ? 'aucune inscription'
        : [named.length && plural(named.length, 'personnel', 'personnels'), comps.length - named.length && plural(comps.length - named.length, 'puce sans nom', 'puces sans nom')].filter(Boolean).join(' + '),
    },
    {
      id: 'circuit',
      label: 'Balises du circuit',
      ok: !!course && badFirst.length === 0,
      detail: !course ? 'aucun circuit choisi' : badFirst.length ? `${plural(badFirst.length, '1re balise hors circuit', '1res balises hors circuit')}` : `${course.name || 'Circuit'} · ${course.controls.length} balises`,
      badFirst,
    },
    { id: 'bareme', label: 'Barème de notation', ok: !!s.event?.scoringConfirmed, detail: s.event?.scoringConfirmed ? s.event.scoringName || 'barème de la course' : 'aucun barème choisi' },
  ];
}

const STEPS = [
  { id: 'inscriptions', title: 'Inscriptions', phase: 'prep' },
  { id: 'circuit', title: 'Balises du circuit', phase: 'prep' },
  { id: 'bareme', title: 'Barème de notation', phase: 'prep' },
  { id: 'pret', title: 'Course prête', phase: 'prep' },
  { id: 'controle', title: 'Contrôle', phase: 'after' },
  { id: 'export', title: 'Export des notes', phase: 'after' },
];

export function GuidePage({ sub }) {
  const s = useStore();
  const lib = useSettings();
  const d = getDerived();
  const ev = s.event;
  const [importing, setImporting] = useState(null);
  const [circuitEdit, setCircuitEdit] = useState(null);
  const [baremeEdit, setBaremeEdit] = useState(null);
  const [editComp, setEditComp] = useState(null);

  const comps = [...s.competitors.values()];
  const named = comps.filter((c) => c.lastName || c.firstName);
  const nameless = comps.filter((c) => !c.lastName && !c.firstName);
  const courses = [...s.courses.values()];
  const course = scoreCourse(s);
  const classesNoCourse = [...s.classes.values()].filter((c) => !s.courses.has(c.courseId));

  // Une seule course au score : toutes les catégories utilisent son circuit.
  useEffect(() => {
    if (course && courses.length === 1 && classesNoCourse.length) {
      mutate(classesNoCourse.map((cls) => putOp('class', { ...cls, courseId: course.id })));
    }
  }, [course?.id, classesNoCourse.length]);

  const checks = preparationChecks(s);
  const check = (id) => checks.find((c) => c.id === id);
  const prepOk = checks.every((c) => c.ok);

  const sections = new Map();
  for (const c of named) {
    const k = sectionKey(c);
    sections.set(k, (sections.get(k) || 0) + 1);
  }
  const sectionList = [...sections].sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : compareText(a[0], b[0])));

  const res = (c) => d.results.get(c.id);
  const blank = named.length === 0 && nameless.length > 0;
  const expected = named.filter((c) => c.status !== 'DNS');
  const readCount = expected.filter((c) => d.readsByComp.has(c.id)).length;
  const readNameless = nameless.filter((c) => d.readsByComp.has(c.id));
  const notRead = expected
    .filter((c) => !d.readsByComp.has(c.id))
    .sort((a, b) => compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName));
  const readComps = comps.filter((c) => d.readsByComp.has(c.id));
  const noSection = readComps.filter((c) => (c.lastName || c.firstName) && !sectionKey(c));
  const dnf = readComps.filter((c) => res(c).status === 'DNF');
  const otherIssues = readComps.filter((c) => res(c).status === 'MP');
  const anomalies = d.unassigned.length + readNameless.length + noSection.length + dnf.length + otherIssues.length;
  const started = s.cards.size > 0 || !!ev.startedAt;

  const done = {
    inscriptions: check('inscriptions').ok,
    circuit: check('circuit').ok,
    bareme: check('bareme').ok,
    pret: prepOk && s.cards.size > 0,
    controle: s.cards.size > 0 && anomalies === 0 && notRead.length === 0,
    export: !!ev.exportedAt && ev.exportedAt > lastChange(s),
  };
  const firstTodo = STEPS.find((x) => x.phase === 'prep' && x.id !== 'pret' && !done[x.id])?.id || 'pret';
  // On ne peut aller qu'aux étapes déjà validées, à la première étape à faire, et après la course aux étapes suivantes.
  const reachable = (id) => {
    const i = STEPS.findIndex((x) => x.id === id);
    const todo = STEPS.findIndex((x) => x.id === firstTodo);
    if (i <= todo) return true;
    return prepOk && started;
  };
  const current = STEPS.some((x) => x.id === sub) && reachable(sub) ? sub : firstTodo;
  // L'étape affichée est fixée dans l'adresse : on ne change d'étape qu'avec « Précédent » / « Suivant ».
  useEffect(() => {
    if (sub !== current) location.replace(`#/e/${s.eventId}/deroule/${current}`);
  }, [sub, current]);
  const idx = STEPS.findIndex((x) => x.id === current);
  const step = STEPS[idx];
  const goStep = (id) => go(`e/${s.eventId}/deroule/${id}`);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  const canNext = next && (current === 'pret' ? started : current === 'controle' || current === 'export' ? true : done[current]);

  const importFile = async () => {
    const src = await chooseEntriesFile();
    if (src) setImporting(src);
  };

  const startRace = () => {
    if (!ev.startedAt) updateEvent({ startedAt: Date.now() });
    go(`e/${s.eventId}/lecture`);
  };

  // Circuit choisi dans la liste des réglages : copié dans la course.
  // (une course créée avant les réglages est reliée au circuit de la liste qui a les mêmes balises)
  const sameControls = (a, b) => [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
  const libCircuit = course
    ? lib.circuits.find((c) => c.id === course.libraryId) || (!course.libraryId ? lib.circuits.find((c) => sameControls(c.controls, course.controls)) : null) || null
    : null;
  const circuitChanged = libCircuit && course.libraryId === libCircuit.id && !sameControls(libCircuit.controls, course.controls);
  const applyCircuit = (c) => {
    if (c) applyLibraryCourse(c, { replace: course });
  };
  const libBareme = !ev.scoringConfirmed
    ? null
    : ev.scoringId
      ? lib.baremes.find((b) => b.id === ev.scoringId) || null
      : lib.baremes.find((b) => sameScoring(scoringFromBareme(b), ev.scoring)) || null;
  const baremeChanged = libBareme && ev.scoringId === libBareme.id && !sameScoring(scoringFromBareme(libBareme), ev.scoring);
  const applyBareme = (b) => {
    if (!b) return;
    updateEvent({ scoringId: b.id, scoringName: b.name, scoring: scoringFromBareme(b), scoringConfirmed: true });
    toast(`Barème « ${b.name} » appliqué à la course.`, 'success');
  };

  const markAbsent = async () => {
    const ok = await confirmDialog({
      title: 'Marquer les non-lus comme absents',
      message: `${plural(notRead.length, "personne n'a", "personnes n'ont")} pas été lue${notRead.length > 1 ? 's' : ''}. Les marquer « absent / non partant » ? (réversible depuis leur fiche)`,
      confirmLabel: 'Marquer absents',
    });
    if (ok) mutate(notRead.map((c) => putOp('competitor', { ...c, status: 'DNS' })));
  };

  const doExport = () => runExcelExport(); // aperçu du tableau, puis téléchargement

  const exportGroups = d.groups.map((g) => ({ g, rows: g.rows.filter((r) => r.comp.lastName || r.comp.firstName || r.res.readId) })).filter((x) => x.rows.length);
  const badFirst = check('circuit').badFirst || [];
  const badFirstCodes = [...new Set(badFirst.map((c) => Number(c.firstControl)))].sort((a, b) => a - b);

  // --- Contenu de chaque étape -----------------------------------------------------------------
  const body = {
    inscriptions: () => html`
      <p class="wz-lead">Le fichier d'inscription (Excel .xlsx) contient déjà les puces et leur 1re balise. Complétez-le dans Excel ou OpenOffice, puis importez-le : CO - P3OPS vérifie chaque case avant de l'enregistrer.</p>
      ${comps.length === 0
        ? html`<div class="wz-actions-big">
            <button type="button" class="wz-action" onClick=${downloadBlankFile}>
              <span class="wz-action-num">1</span>
              <${Icon} name="download" size=${26} />
              <strong>Télécharger le fichier d'inscription</strong>
              <span>« ${BLANK_FILE_NAME} » : remplissez Nom, Prénom et Section de chaque personne qui court (laissez vides les puces non utilisées), puis enregistrez.</span>
            </button>
            <button type="button" class="wz-action primary" onClick=${importFile}>
              <span class="wz-action-num">2</span>
              <${Icon} name="upload" size=${26} />
              <strong>Importer le fichier d'inscription</strong>
              <span>Le fichier est contrôlé : s'il contient une erreur, CO - P3OPS indique la case à corriger.</span>
            </button>
          </div>`
        : html`<${Issue} kind="ok">${blank
              ? `${nameless.length} puces enregistrées avec leur 1re balise : les noms et sections se saisiront à la lecture des doigts.`
              : `${plural(named.length, 'personnel inscrit', 'personnels inscrits')} dans ${plural(sectionList.length, 'section', 'sections')}${nameless.length ? ` · ${nameless.length} puces sans nom` : ''}.`}<//>
            ${sectionList.length > 0 && html`<div class="chips-line mt">${sectionList.map(([k, n]) => html`<span class="tag">${sectionLabel(k)} <b>${n}</b></span>`)}</div>`}
            <div class="row-actions">
              <${Button} icon="users" onClick=${() => go(`e/${s.eventId}/coureurs`)}>Voir la liste</${Button}>
              <${Button} icon="upload" onClick=${importFile}>Importer un nouveau fichier</${Button}>
              <${Button} icon="download" variant="ghost" onClick=${downloadBlankFile}>Télécharger le fichier vierge</${Button}>
            </div>`}
    `,

    circuit: () => html`
      <p class="wz-lead">Choisissez le circuit de la course dans la liste. Les circuits se créent et se modifient dans le menu « Circuits » de l'accueil.</p>
      <div class="wz-select-row">
        <select class="input input-lg" value=${libCircuit ? libCircuit.id : ''} onChange=${(e) => applyCircuit(lib.circuits.find((c) => c.id === e.target.value))}>
          <option value="" disabled=${!!libCircuit}>${course && !libCircuit ? `Circuit actuel : ${course.controls.length} balises (hors liste)` : '— Choisir un circuit —'}</option>
          ${lib.circuits.map((c) => html`<option value=${c.id}>${c.name} (${c.controls.length} balises)</option>`)}
        </select>
        <${Button} icon="plus" onClick=${() => setCircuitEdit('new')}>Nouveau circuit</${Button}>
        ${libCircuit && html`<${Button} icon="edit" onClick=${() => setCircuitEdit(libCircuit)}>Modifier</${Button}>`}
      </div>
      ${!lib.circuits.length && lib.loaded && html`<${Issue} kind="info">Aucun circuit enregistré pour l'instant : cliquez sur « Nouveau circuit ».<//>`}
      ${course &&
      html`<div class="wz-box mt">
        <div class="field-label">${plural(course.controls.length, 'balise', 'balises')} à poinçonner, dans n'importe quel ordre</div>
        <${ControlChips} controls=${course.controls} />
      </div>`}
      ${circuitChanged &&
      html`<${Issue} action=${html`<${Button} small variant="primary" onClick=${() => applyCircuit(libCircuit)}>Mettre à jour</${Button}>`}>Le circuit « ${libCircuit.name} » a été modifié dans le menu Circuits depuis qu'il a été choisi pour cette course.<//>`}
      ${badFirst.length > 0 &&
      html`<${Issue} kind="err">
        ${plural(badFirst.length, 'inscription a', 'inscriptions ont')} une 1re balise qui n'est pas dans ce circuit (${badFirstCodes.join(', ')}).
        Choisissez le bon circuit, ou corrigez le fichier d'inscription et réimportez-le (étape 1).
      <//>`}
    `,

    bareme: () => html`
      <p class="wz-lead">Choisissez le barème de notation. Les barèmes se créent et se modifient dans le menu « Barèmes » de l'accueil.</p>
      <div class="wz-select-row">
        <select class="input input-lg" value=${libBareme ? libBareme.id : ''} onChange=${(e) => applyBareme(lib.baremes.find((b) => b.id === e.target.value))}>
          <option value="" disabled=${!!libBareme}>${ev.scoringConfirmed && !libBareme ? `${ev.scoringName || 'Barème actuel'} (hors liste)` : '— Choisir un barème —'}</option>
          ${lib.baremes.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
        </select>
        <${Button} icon="plus" onClick=${() => setBaremeEdit('new')}>Nouveau barème</${Button}>
        ${libBareme && html`<${Button} icon="edit" onClick=${() => setBaremeEdit(libBareme)}>Modifier</${Button}>`}
      </div>
      ${ev.scoringConfirmed && html`<div class="wz-box mt"><${BaremeSummary} event=${ev} /></div>`}
      ${baremeChanged &&
      html`<${Issue} action=${html`<${Button} small variant="primary" onClick=${() => applyBareme(libBareme)}>Mettre à jour</${Button}>`}>Le barème « ${libBareme.name} » a été modifié dans le menu Barèmes depuis qu'il a été choisi pour cette course.<//>`}
      <p class="muted small mt">Le temps de chaque participant est compté à partir du poinçon du boîtier « Départ ».</p>
    `,

    pret: () =>
      prepOk
        ? html`<div class="ready-panel">
            <div class="ready-light"><${Icon} name="check" size=${44} /></div>
            <h2>${started ? 'Course en cours' : 'Tout est prêt'}</h2>
            <ul class="ready-list">
              ${checks.map((c) => html`<li><${Icon} name="check" size=${16} /><span><b>${c.label}</b> · ${c.detail}</span></li>`)}
            </ul>
            ${started
              ? html`<p class="muted">${blank ? plural(readComps.length, 'doigt lu', 'doigts lus') : `${readCount} / ${expected.length} doigts lus`}${d.unassigned.length ? ` · ${d.unassigned.length} puce(s) à traiter` : ''}.</p>`
              : html`<p class="muted">Vous pouvez quitter CO - P3OPS et le relancer le jour de la course (« Charger une course »), ou lancer la course maintenant.</p>`}
            <button type="button" class="btn-start" onClick=${startRace}>
              <${Icon} name="play" size=${26} />
              <span>${started ? 'Reprendre la lecture des doigts' : 'Lancer la course'}</span>
            </button>
          </div>`
        : html`<p class="wz-lead">Il reste des étapes à terminer avant de lancer la course :</p>
            ${checks
              .filter((c) => !c.ok)
              .map((c) => html`<${Issue} kind="err" action=${html`<${Button} small onClick=${() => goStep(c.id)}>Y aller</${Button}>`}><b>${c.label}</b> : ${c.detail}<//>`)}`,

    controle: () => html`
      <p class="wz-lead">Après la course : vérifiez les lectures avant d'exporter les notes.</p>
      ${s.cards.size === 0
        ? html`<${Issue} kind="info">Aucun doigt lu pour l'instant : cette étape se remplit au fur et à mesure des lectures.<//>`
        : html`
          <div class="read-progress">
            ${blank
              ? html`<span><b>${readComps.length}</b> doigt${readComps.length > 1 ? 's' : ''} lu${readComps.length > 1 ? 's' : ''}</span>`
              : html`<div class="progress big"><div style=${`width:${expected.length ? (readCount / expected.length) * 100 : 0}%`}></div></div>
                  <span><b>${readCount}</b> / ${expected.length} personnes lues</span>`}
          </div>
          ${d.unassigned.length > 0 &&
          html`<${Issue} action=${html`<${Button} small onClick=${() => go(`e/${s.eventId}/lecture`)}>Traiter</${Button}>`}>${plural(d.unassigned.length, 'puce inconnue ou en conflit', 'puces inconnues ou en conflit')}<//>`}
          ${readNameless.map((c) => html`<${Issue} action=${html`<${Button} small onClick=${() => setEditComp(c)}>Compléter</${Button}>`}>Puce <b class="mono">${c.card}</b> lue sans nom<//>`)}
          ${noSection.map((c) => html`<${Issue} action=${html`<${Button} small onClick=${() => setEditComp(c)}>Compléter</${Button}>`}>${personName(c)} : section inconnue<//>`)}
          ${dnf.map((c) => html`<${Issue} action=${html`<${Button} small onClick=${() => setEditComp(c)}>Corriger</${Button}>`}>${personName(c)} : arrivée non poinçonnée (pas de note)<//>`)}
          ${otherIssues.map((c) => html`<${Issue} action=${html`<${Button} small onClick=${() => setEditComp(c)}>Corriger</${Button}>`}>${personName(c)} : ${res(c).warnings.join(', ') || 'à vérifier'}<//>`)}
          ${notRead.length > 0 &&
          html`<${Issue} kind="info" action=${html`<${Button} small onClick=${markAbsent}>Marquer absents</${Button}>`}>
            ${plural(notRead.length, 'personne non lue', 'personnes non lues')} : ${notRead.slice(0, 6).map(personName).join(', ')}${notRead.length > 6 ? '…' : ''}
          <//>`}
          ${anomalies + notRead.length === 0 && html`<${Issue} kind="ok">Tout est en ordre.<//>`}`}
      <div class="row-actions">
        <${Button} icon="chip" onClick=${() => go(`e/${s.eventId}/lecture`)}>Lecture des doigts</${Button}>
        <${Button} icon="trophy" onClick=${() => go(`e/${s.eventId}/resultats`)}>Voir les notes</${Button}>
      </div>
    `,

    export: () => html`
      <p class="wz-lead">Un fichier Excel avec un onglet par section : nom, prénom, temps, balises validées et manquantes, note /20.</p>
      ${exportGroups.length
        ? html`<div class="export-preview">
            ${exportGroups.map(
              ({ g, rows }) => html`<div class="export-sheet">
                <${Icon} name="file" size=${16} />
                <strong>${g.name}</strong>
                <span class="muted small">${rows.length} ligne${rows.length > 1 ? 's' : ''} · ${rows.filter((r) => r.res.note != null).length} noté${rows.filter((r) => r.res.note != null).length > 1 ? 's' : ''}</span>
              </div>`
            )}
          </div>`
        : html`<${Issue} kind="info">Aucune donnée à exporter pour l'instant.<//>`}
      ${(anomalies > 0 || notRead.length > 0) && s.cards.size > 0 && html`<${Issue}>Il reste des anomalies (étape Contrôle) : elles apparaîtront dans la colonne « Remarques ».<//>`}
      ${ev.exportedAt && html`<p class="muted small mt">Dernier export à ${new Date(ev.exportedAt).toLocaleTimeString('fr-FR')}.</p>`}
      <div class="row-actions">
        <${Button} variant="primary" icon="download" onClick=${doExport} disabled=${!exportGroups.length}>Télécharger le fichier Excel</${Button}>
        <${Button} icon="printer" onClick=${() => printHtml(resultsHtml({}))} disabled=${!exportGroups.length}>Imprimer les notes</${Button}>
      </div>
    `,
  };

  const nextHint = !canNext && next
    ? { inscriptions: "Importez le fichier d'inscription pour continuer.", circuit: badFirst.length ? 'Corrigez les 1res balises hors circuit pour continuer.' : 'Choisissez un circuit pour continuer.', bareme: 'Choisissez un barème pour continuer.', pret: started ? '' : 'Lancez la course : les étapes suivantes servent après la course.' }[current]
    : '';

  return html`
    <div class="wizard">
      <ol class="wz-steps">
        ${STEPS.map((x, i) => {
          const ok = x.id === 'pret' ? prepOk : done[x.id];
          const can = reachable(x.id);
          return html`<li class=${'wz-step' + (x.id === current ? ' current' : '') + (ok ? ' done' : '') + (can ? '' : ' locked') + (x.phase === 'after' ? ' after' : '')}>
            <button type="button" disabled=${!can} onClick=${() => goStep(x.id)}>
              <span class="wz-num">${ok && x.id !== current ? html`<${Icon} name="check" size=${15} />` : i + 1}</span>
              <span class="wz-label">${x.title}</span>
            </button>
          </li>`;
        })}
      </ol>

      <section class="wz-card" key=${current}>
        <header class="wz-head">
          <span class="wz-kicker">${step.phase === 'after' ? 'Après la course' : `Étape ${idx + 1} sur 4`}</span>
          <h1>${step.title}</h1>
        </header>
        <div class="wz-body">${body[current]()}</div>
        <footer class="wz-foot">
          ${prev ? html`<${Button} icon="arrowLeft" onClick=${() => goStep(prev.id)}>Précédent</${Button}>` : html`<span></span>`}
          <span class="wz-hint">${nextHint}</span>
          ${next &&
          html`<button type="button" class="btn btn-primary btn-next" disabled=${!canNext} onClick=${() => goStep(next.id)}>
            <span>Suivant</span><${Icon} name="chevronRight" size=${18} />
          </button>`}
        </footer>
      </section>
    </div>

    ${importing && html`<${EntriesImportModal} source=${importing} onChange=${setImporting} onClose=${() => setImporting(null)} />`}
    ${circuitEdit && html`<${CircuitEditorModal} circuit=${circuitEdit === 'new' ? null : circuitEdit} onClose=${() => setCircuitEdit(null)} onSaved=${applyCircuit} />`}
    ${baremeEdit && html`<${BaremeEditorModal} bareme=${baremeEdit === 'new' ? null : baremeEdit} onClose=${() => setBaremeEdit(null)} onSaved=${applyBareme} />`}
    ${editComp && html`<${CompetitorModal} comp=${editComp} onClose=${() => setEditComp(null)} />`}
  `;
}

// Fichier d'inscription vierge : puces et 1res balises remplies, noms et sections à compléter.
export async function downloadBlankFile() {
  try {
    const res = await fetch('/modeles/fichier-inscription-vierge.xlsx');
    if (!res.ok) throw new Error();
    downloadFile(BLANK_FILE_NAME, await res.blob());
    toast(`« ${BLANK_FILE_NAME} » téléchargé (dossier Téléchargements) : complétez-le dans Excel ou OpenOffice, enregistrez-le en .xlsx puis importez-le.`, 'success');
  } catch {
    toast("Le fichier d'inscription vierge se télécharge depuis la version PC de CO - P3OPS.", 'error');
  }
}

// Horodatage de la dernière lecture : un export plus ancien n'est plus à jour.
function lastChange(s) {
  let t = 0;
  for (const r of s.cards.values()) t = Math.max(t, r.readAt || 0);
  return t;
}
