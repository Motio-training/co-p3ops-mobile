// Panneau de contrôle du fichier d'inscription (course au score) : rien n'est enregistré tant que
// le fichier contient une erreur ; l'appli indique les cases à corriger avant de le réimporter.
import { html, useMemo } from '../../lib.js';
import { toast } from '../../core/bus.js';
import { delOp, getDerived, mutate, putOp, store } from '../../core/store.js';
import { plural, uid } from '../../core/util.js';
import { checkScoreFile } from '../../io/entries-check.js';
import { sectionLabel } from '../../domain/results.js';
import { Button, Icon, Modal } from '../components.js';
import { EMPTY_COMPETITOR } from './competitors.js';

const MAX_SHOWN = 60;

export function ScoreImportModal({ source, onClose, onRetry }) {
  const check = useMemo(() => checkScoreFile(source), [source]);
  const d = getDerived();
  const existing = [...store.competitors.values()];
  const withRead = existing.filter((c) => d.readsByComp.has(c.id));
  const ok = check.errors.length === 0 && check.entries.length > 0;

  const save = () => {
    if (!ok) return;
    const ops = [];
    // Catégorie unique de la course au score, reliée au circuit
    const courseId = [...store.courses.values()][0]?.id || '';
    let classId = [...store.classes.values()][0]?.id;
    if (!classId) {
      classId = uid();
      ops.push(putOp('class', { id: classId, name: 'Course', courseId, interval: 120, drawMode: 'random' }));
    }
    // Les lignes déjà connues (même puce, même 1re balise) sont mises à jour : leurs lectures restent associées.
    const byKey = new Map(existing.map((c) => [`${c.card}|${c.firstControl}`, c]));
    const kept = new Set();
    const now = Date.now();
    for (const e of check.entries) {
      const prev = byKey.get(`${e.card}|${e.firstControl}`);
      if (prev) kept.add(prev.id);
      ops.push(
        putOp('competitor', {
          ...EMPTY_COMPETITOR,
          ...(prev || {}),
          id: prev?.id || uid(),
          classId: prev?.classId && store.classes.has(prev.classId) ? prev.classId : classId,
          lastName: e.lastName,
          firstName: e.firstName,
          section: e.section,
          firstControl: e.firstControl,
          card: e.card,
          createdAt: prev?.createdAt || now,
        })
      );
    }
    // Les inscriptions absentes du nouveau fichier sont retirées, sauf si leur doigt a déjà été lu.
    for (const c of existing) if (!kept.has(c.id) && !d.readsByComp.has(c.id)) ops.push(delOp('competitor', c.id));
    mutate(ops);
    toast(`Inscriptions enregistrées : ${plural(check.named.length, 'personnel', 'personnels')}${check.nameless.length ? `, ${check.nameless.length} puces sans nom` : ''}.`, 'success');
    onClose();
  };

  const shown = check.errors.slice(0, MAX_SHOWN);
  return html`<${Modal}
    title="Contrôle du fichier d'inscription"
    size="xl"
    onClose=${onClose}
    footer=${html`<span class="muted small">${source.fileName || ''}</span>
      <span class="spacer"></span>
      <${Button} onClick=${onClose}>Fermer</${Button}>
      <${Button} icon="upload" onClick=${onRetry}>${ok ? 'Choisir un autre fichier' : 'Réimporter le fichier corrigé'}</${Button}>
      <${Button} variant="primary" icon="check" disabled=${!ok} onClick=${save} title=${ok ? '' : 'Corrigez les erreurs du fichier avant de pouvoir l\'enregistrer'}>Enregistrer les inscriptions</${Button}>`}
  >
    ${ok
      ? html`<div class="check-banner ok">
          <${Icon} name="check" size=${22} />
          <div><strong>Fichier correct</strong><span>${plural(check.entries.length, 'ligne vérifiée', 'lignes vérifiées')}, aucune erreur.</span></div>
        </div>`
      : html`<div class="check-banner err">
          <${Icon} name="alert" size=${22} />
          <div>
            <strong>${check.entries.length === 0 && !check.errors.length ? 'Fichier vide' : `${plural(check.errors.length, 'erreur', 'erreurs')} dans le fichier`}</strong>
            <span>Rien n'a été enregistré. Corrigez ${check.errors.length > 1 ? 'ces cases' : 'cette case'} dans le fichier (Excel), enregistrez-le, puis cliquez sur « Réimporter le fichier corrigé ».</span>
          </div>
        </div>`}

    ${check.errors.length > 0 &&
    html`<div class="table-wrap bordered check-table"><table class="table table-tight">
      <thead><tr><th class="num">Ligne</th><th>Colonne</th><th>Valeur</th><th>Problème</th></tr></thead>
      <tbody>
        ${shown.map(
          (e) => html`<tr>
            <td class="num mono">${e.line}</td>
            <td><strong>${e.column}</strong></td>
            <td class="mono">${e.value ? `« ${e.value} »` : html`<span class="muted">vide</span>`}</td>
            <td>${e.message}</td>
          </tr>`
        )}
      </tbody>
    </table></div>
    ${check.errors.length > MAX_SHOWN && html`<p class="muted small">… et ${check.errors.length - MAX_SHOWN} autres erreurs.</p>`}`}

    ${ok &&
    html`<div class="check-stats">
        <div class="check-stat"><b>${check.named.length}</b><span>personnel${check.named.length > 1 ? 's' : ''} inscrit${check.named.length > 1 ? 's' : ''}</span></div>
        <div class="check-stat"><b>${check.sections.length}</b><span>section${check.sections.length > 1 ? 's' : ''}</span></div>
        <div class="check-stat"><b>${check.nameless.length}</b><span>puce${check.nameless.length > 1 ? 's' : ''} sans nom</span></div>
      </div>
      ${check.sections.length > 0 && html`<div class="chips-line mb">${check.sections.map(([k, n]) => html`<span class="tag">${sectionLabel(k)} <b>${n}</b></span>`)}</div>`}
      ${check.nameless.length > 0 && html`<p class="muted small">Les puces sans nom sont enregistrées avec leur 1re balise : le nom, le prénom et la section se saisissent à la lecture du doigt.</p>`}
      ${existing.length > 0 &&
      html`<div class="issue issue-info"><${Icon} name="info" size=${16} /><span>Ce fichier remplace les ${existing.length} inscriptions actuelles${withRead.length ? ` (les ${withRead.length} personnes dont le doigt a déjà été lu sont conservées)` : ''}.</span></div>`}
      ${check.warnings.map((w) => html`<div class="issue"><${Icon} name="alert" size=${16} /><span>Ligne ${w.line} : ${w.value} — ${w.message}</span></div>`)}
      ${check.named.length > 0 &&
      html`<div class="table-wrap bordered preview mt"><table class="table table-tight">
        <thead><tr><th class="num">Ligne</th><th>Nom</th><th>Prénom</th><th>Section</th><th class="num">1re balise</th><th class="num">Puce</th></tr></thead>
        <tbody>
          ${check.named.slice(0, 8).map(
            (e) => html`<tr><td class="num mono muted">${e.line}</td><td>${e.lastName}</td><td>${e.firstName}</td><td>${e.section}</td><td class="num mono">${e.firstControl}</td><td class="num mono">${e.card}</td></tr>`
          )}
        </tbody>
      </table></div>
      ${check.named.length > 8 && html`<p class="muted small">… et ${check.named.length - 8} autres personnels.</p>`}`}`}
  <//>`;
}
