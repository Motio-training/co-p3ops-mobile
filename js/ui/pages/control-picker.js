// Choix des balises d'un circuit par simple clic, parmi toutes les balises connues de l'application
// (liste gérée dans « Programmer les boîtiers »).
import { html, useState } from '../../lib.js';
import { toast } from '../../core/bus.js';
import { addBalises } from '../../core/settings.js';
import { Button } from '../components.js';
import { useSettings } from '../hooks.js';

/** « 31 32 40-45 » → [31, 32, 40, 41, 42, 43, 44, 45] ; renvoie aussi les morceaux non compris. */
export function parseCodeList(text) {
  const codes = [];
  const bad = [];
  for (const token of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–à]\s*(\d+)$/.exec(token);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      if (a >= 1 && b <= 1023 && b - a <= 300) for (let c = a; c <= b; c++) codes.push(c);
      else bad.push(token);
    } else if (/^\d+$/.test(token) && Number(token) >= 1 && Number(token) <= 1023) codes.push(Number(token));
    else bad.push(token);
  }
  return { codes: [...new Set(codes)], bad };
}

/**
 * value : numéros sélectionnés (dans l'ordre des clics) · onChange(codes)
 * ordered : course en ligne, l'ordre de passage compte (il est affiché).
 */
export function ControlPicker({ value, onChange, ordered = false }) {
  const st = useSettings();
  const [adding, setAdding] = useState('');
  const known = st.balises.map((b) => b.code);
  const all = [...new Set([...known, ...value])].sort((a, b) => a - b);
  const selected = new Set(value);
  // (mise à jour à partir de la sélection courante : plusieurs touches rapides ne se perdent pas)
  const toggle = (code) => onChange((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  const add = async () => {
    const { codes, bad } = parseCodeList(adding);
    if (bad.length) return toast(`Numéros non compris : ${bad.join(', ')} (de 1 à 1023).`, 'warning');
    if (!codes.length) return;
    try {
      await addBalises(codes);
      onChange((cur) => [...cur, ...codes.filter((c) => !cur.includes(c))]);
      setAdding('');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return html`<div class="picker">
    <div class="picker-head">
      <span><b>${value.length}</b> balise${value.length > 1 ? 's' : ''} sélectionnée${value.length > 1 ? 's' : ''} sur ${all.length}</span>
      <span class="spacer"></span>
      <${Button} small onClick=${() => onChange(all)} disabled=${!all.length || value.length === all.length}>Tout sélectionner</${Button}>
      <${Button} small onClick=${() => onChange([])} disabled=${!value.length}>Tout désélectionner</${Button}>
    </div>
    ${all.length
      ? html`<div class="picker-grid" role="group" aria-label="Balises">
          ${all.map((code) => {
            const on = selected.has(code);
            return html`<button type="button" key=${code} class=${'picker-chip' + (on ? ' on' : '') + (known.includes(code) ? '' : ' unknown')} aria-pressed=${on} onClick=${() => toggle(code)}>
              ${code}${ordered && on ? html`<small>${value.indexOf(code) + 1}</small>` : ''}
            </button>`;
          })}
        </div>`
      : html`<p class="muted small">Aucune balise connue pour l'instant : ajoutez leurs numéros ci-dessous (ou dans « Programmer les boîtiers »).</p>`}
    <div class="picker-add">
      <input class="input input-sm mono" value=${adding} placeholder="Autre balise : 51 ou 51-55" onInput=${(e) => setAdding(e.target.value)} onKeyDown=${(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          add();
        }
      }} />
      <${Button} small icon="plus" onClick=${add} disabled=${!adding.trim()}>Ajouter</${Button}>
    </div>
    ${ordered && value.length > 0 && html`<p class="picker-order small"><span class="muted">Ordre de passage :</span> ${value.join(' → ')}</p>`}
  </div>`;
}
