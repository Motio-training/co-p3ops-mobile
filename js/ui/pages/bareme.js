// Barèmes de notation (course au score) : affichage et modification dans les réglages.
import { html, useState } from '../../lib.js';
import { toast } from '../../core/bus.js';
import { saveBareme } from '../../core/settings.js';
import { DEFAULT_SCORING, scoringOf } from '../../domain/scoring.js';
import { Button, Field, IconButton, Modal } from '../components.js';

/** Résumé lisible d'un barème : `cfg` (barème) ou `event` (barème copié dans la course). */
export function BaremeSummary({ event, cfg: raw }) {
  const cfg = scoringOf(raw ? { scoring: raw } : event);
  const last = cfg.steps[cfg.steps.length - 1];
  return html`<div class="bareme">
    <div class="bareme-steps">
      ${cfg.steps.map(([m, n]) => html`<div class="bareme-step"><span>${`< ${m} min`}</span><strong>${n}</strong></div>`)}
    </div>
    <ul class="bareme-rules">
      <li>Au-delà de ${last?.[0]} min : <strong>−${cfg.overtimePerMinute} pt par minute</strong> ${cfg.overtimeRounding === 'started' ? 'entamée' : 'écoulée'}</li>
      <li>1re balise imposée non respectée : <strong>−${cfg.firstPenalty} pts</strong></li>
      <li>Par balise manquante : <strong>−${cfg.missingPenalty} pts</strong></li>
      <li>Note finale comprise entre ${cfg.minNote} et ${cfg.maxNote}</li>
    </ul>
  </div>`;
}

const num = (v) => {
  const n = Number(String(v).replace(',', '.').trim());
  return String(v).trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Création / modification d'un barème de la bibliothèque (Réglages). */
export function BaremeEditorModal({ bareme, onClose, onSaved }) {
  const initial = bareme || { name: '', ...JSON.parse(JSON.stringify(DEFAULT_SCORING)) };
  const [name, setName] = useState(initial.name || '');
  const [steps, setSteps] = useState(initial.steps.map(([m, n]) => [String(m), String(n)]));
  const [cfg, setCfg] = useState({
    overtimePerMinute: String(initial.overtimePerMinute ?? 1),
    overtimeRounding: initial.overtimeRounding || 'started',
    firstPenalty: String(initial.firstPenalty ?? 0),
    missingPenalty: String(initial.missingPenalty ?? 0),
    minNote: String(initial.minNote ?? 0),
    maxNote: String(initial.maxNote ?? 20),
  });
  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value });
  const setStep = (i, j) => (e) => setSteps(steps.map((s, k) => (k === i ? (j === 0 ? [e.target.value, s[1]] : [s[0], e.target.value]) : s)));

  // Contrôle des valeurs : on ne peut pas enregistrer un barème incohérent.
  const errors = [];
  if (!name.trim()) errors.push('Donnez un nom au barème.');
  const parsed = steps.map(([m, n]) => [num(m), num(n)]);
  if (!parsed.length) errors.push('Ajoutez au moins un seuil de temps.');
  parsed.forEach(([m, n], i) => {
    if (m == null || m <= 0) errors.push(`Seuil ${i + 1} : durée en minutes invalide.`);
    if (n == null) errors.push(`Seuil ${i + 1} : note invalide.`);
  });
  const mins = parsed.map(([m]) => m).filter((m) => m != null);
  if (new Set(mins).size !== mins.length) errors.push('Deux seuils ont la même durée.');
  for (const k of ['overtimePerMinute', 'firstPenalty', 'missingPenalty', 'minNote', 'maxNote']) {
    if (num(cfg[k]) == null) errors.push('Les pénalités et les notes minimale / maximale doivent être des nombres.');
  }
  if (num(cfg.minNote) != null && num(cfg.maxNote) != null && num(cfg.minNote) > num(cfg.maxNote)) errors.push('La note minimale dépasse la note maximale.');
  const uniqueErrors = [...new Set(errors)];

  const save = async () => {
    if (uniqueErrors.length) return;
    try {
      const doc = await saveBareme({
        ...(bareme || {}),
        name: name.trim(),
        steps: parsed.sort((a, b) => a[0] - b[0]),
        overtimePerMinute: num(cfg.overtimePerMinute),
        overtimeRounding: cfg.overtimeRounding,
        firstPenalty: num(cfg.firstPenalty),
        missingPenalty: num(cfg.missingPenalty),
        minNote: num(cfg.minNote),
        maxNote: num(cfg.maxNote),
      });
      toast(`Barème « ${doc.name} » enregistré.`, 'success');
      onSaved?.(doc);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return html`<${Modal}
    title=${bareme?.id ? `Barème « ${bareme.name} »` : 'Nouveau barème'}
    size="lg"
    onClose=${onClose}
    onSubmit=${save}
    footer=${html`<span class="text-err small">${uniqueErrors[0] || ''}</span><span class="spacer"></span>
      <${Button} onClick=${onClose}>Annuler</${Button}><${Button} type="submit" variant="primary" disabled=${uniqueErrors.length > 0}>Enregistrer</${Button}>`}
  >
    <${Field} label="Nom du barème"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ex. : Barème CM1, Barème FG…" /><//>
    <div class="field-label mt">Note selon le temps de course (si toutes les balises sont validées)</div>
    <div class="bareme-edit">
      ${steps.map(
        ([m, n], i) => html`<div class="bareme-edit-row" key=${i}>
          <span>${'<'}</span><input class=${'input input-sm mono' + (parsed[i][0] == null || parsed[i][0] <= 0 ? ' invalid' : '')} value=${m} onInput=${setStep(i, 0)} inputmode="numeric" /><span>min →</span>
          <input class=${'input input-sm mono' + (parsed[i][1] == null ? ' invalid' : '')} value=${n} onInput=${setStep(i, 1)} inputmode="numeric" /><span>pts</span>
          <${IconButton} icon="x" title="Retirer ce seuil" onClick=${() => setSteps(steps.filter((_, k) => k !== i))} />
        </div>`
      )}
    </div>
    <${Button} small icon="plus" class="mt" onClick=${() => {
      const lastMin = num(steps[steps.length - 1]?.[0]) || 0;
      const lastNote = num(steps[steps.length - 1]?.[1]);
      setSteps([...steps, [String(lastMin + 3), String(lastNote != null ? lastNote - 1 : 10)]]);
    }}>Ajouter un seuil</${Button}>
    <div class="form-grid mt">
      <${Field} label="Au-delà du dernier seuil : points perdus par minute"><input class="input" value=${cfg.overtimePerMinute} onInput=${set('overtimePerMinute')} inputmode="numeric" /><//>
      <${Field} label="Décompte des minutes de dépassement" hint="Ex. : 1 h 00 min 40 s → 0 minute écoulée, 1 minute entamée">
        <select class="input" value=${cfg.overtimeRounding} onChange=${set('overtimeRounding')}>
          <option value="started">Minute entamée (comme SportSoftware)</option>
          <option value="full">Minute écoulée (complète)</option>
        </select>
      <//>
      <${Field} label="Pénalité : 1re balise imposée non respectée"><input class="input" value=${cfg.firstPenalty} onInput=${set('firstPenalty')} inputmode="numeric" /><//>
      <${Field} label="Pénalité par balise manquante"><input class="input" value=${cfg.missingPenalty} onInput=${set('missingPenalty')} inputmode="numeric" /><//>
      <${Field} label="Note minimale"><input class="input" value=${cfg.minNote} onInput=${set('minNote')} inputmode="numeric" /><//>
      <${Field} label="Note maximale"><input class="input" value=${cfg.maxNote} onInput=${set('maxNote')} inputmode="numeric" /><//>
    </div>
  <//>`;
}
