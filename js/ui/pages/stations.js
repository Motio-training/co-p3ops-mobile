// Programmation des boîtiers SportIdent : fonction, n° de poste, heure, batterie.
import { html, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { station, humanError } from '../../sportident/station.js';
import { CONFIG_MODES, MODE_READOUT } from '../../sportident/constants.js';
import { Badge, Button, Card, Field, Icon, PageHeader, Segmented, EmptyState } from '../components.js';
import { useSettings, useStation } from '../hooks.js';
import { addBalises, noteBaliseChecked, removeBalise } from '../../core/settings.js';
import { parseCodeList } from './control-picker.js';
import { StationPanel } from './readout.js';

const LOG_KEY = 'balise.boitiers';

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLog(list) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 300)));
  } catch {}
}

function driftOf(info) {
  if (!info?.clock || !info.clockReadAt) return null;
  return Math.round((info.clock.getTime() - new Date(info.clockReadAt).getTime()) / 1000);
}

function fmtDrift(s) {
  if (s == null) return '—';
  const a = Math.abs(s);
  if (a <= 2) return "à l'heure";
  const m = Math.floor(a / 60);
  const txt = m ? `${m} min ${String(a % 60).padStart(2, '0')} s` : `${a} s`;
  return `${s > 0 ? 'avance' : 'retard'} de ${txt}`;
}

function modeLabel(mode) {
  return CONFIG_MODES.find((m) => m.value === mode)?.label || `mode ${mode}`;
}

function BatteryGauge({ percent }) {
  if (percent == null) return html`<span class="muted">non disponible</span>`;
  const kind = percent < 20 ? 'err' : percent < 40 ? 'warn' : 'ok';
  return html`<span class="battery">
    <span class=${'battery-bar battery-' + kind}><span style=${`width:${percent}%`}></span></span>
    <strong class=${'text-' + (kind === 'warn' ? 'warn' : kind)}>${percent} %</strong>
  </span>`;
}

function InfoGrid({ info }) {
  const drift = driftOf(info);
  return html`<dl class="facts station-facts">
    <dt>Boîtier</dt><dd><strong>${info.model}</strong> n° ${info.serial} <span class="muted small">· firmware ${info.firmware}</span></dd>
    <dt>Fonction</dt><dd><strong>${modeLabel(info.mode)}</strong>${info.mode === 0x02 || info.code ? html` · n° <strong>${info.code}</strong>` : ''}</dd>
    <dt>Batterie</dt>
    <dd>
      <${BatteryGauge} percent=${info.batteryPercent} />
      ${info.capacityMah && html`<span class="muted small"> · ${info.usedMah} mAh consommés sur ${info.capacityMah} mAh</span>`}
      ${info.batteryDate && html`<br /><span class="muted small">Pile changée le ${info.batteryDate}</span>`}
    </dd>
    <dt>Horloge</dt>
    <dd>
      ${info.clock ? html`<span class="mono">${info.clock.toLocaleTimeString('fr-FR')}</span> <span class=${Math.abs(drift) > 2 ? 'text-warn' : 'text-ok'}>(${fmtDrift(drift)})</span>` : html`<span class="muted">illisible</span>`}
    </dd>
    ${info.memoryOverflow && html`<dt>Mémoire</dt><dd class="text-warn">mémoire de sauvegarde pleine</dd>`}
  </dl>`;
}

/** Balises connues de l'application : elles servent au choix des balises des circuits. */
function KnownBalises({ onPick }) {
  const st = useSettings();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const add = async () => {
    const { codes, bad } = parseCodeList(text);
    if (bad.length) return toast(`Numéros non compris : ${bad.join(', ')} (de 1 à 1023).`, 'warning');
    if (!codes.length) return;
    try {
      await addBalises(codes);
      setText('');
      toast(`${codes.length} balise${codes.length > 1 ? 's' : ''} ajoutée${codes.length > 1 ? 's' : ''}.`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const del = async (code) => {
    const ok = await confirmDialog({
      title: 'Retirer la balise',
      message: `Retirer la balise ${code} de la liste ? Les circuits qui l'utilisent la gardent.`,
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (ok) removeBalise(code).catch((e) => toast(e.message, 'error'));
  };
  const detail = (b) =>
    [
      `Balise ${b.code}`,
      b.serial && `boîtier n° ${b.serial}`,
      b.battery != null && `batterie ${b.battery} %`,
      b.drift != null && `horloge : ${fmtDrift(b.drift)}`,
      b.checkedAt && `contrôlée le ${new Date(b.checkedAt).toLocaleDateString('fr-FR')}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const level = (b) => (b.battery == null ? 'unknown' : b.battery < 20 ? 'err' : b.battery < 40 ? 'warn' : 'ok');
  return html`<${Card}
    title=${`Balises connues (${st.balises.length})`}
    class="mt"
    actions=${html`<${Button} small icon=${editing ? 'check' : 'edit'} onClick=${() => setEditing(!editing)}>${editing ? 'Terminer' : 'Modifier la liste'}</${Button}>`}
  >
    <p class="muted small">
      ${editing
        ? 'Ajoutez des numéros (ex. : 51 ou 51-55) ou retirez une balise avec ×.'
        : 'Touchez une balise pour la programmer. Ce sont les balises proposées dans les circuits ; chaque boîtier « poste » lu ou programmé est ajouté ici avec sa batterie.'}
    </p>
    ${st.balises.length
      ? html`<div class="picker-grid balise-grid">
          ${st.balises.map(
            (b) => html`<span key=${b.code} class=${'balise-chip level-' + level(b)} title=${detail(b)}>
              <button type="button" class="balise-num" onClick=${() => !editing && onPick(b.code)} disabled=${editing}>${b.code}</button>
              ${editing && html`<button type="button" class="balise-del" title=${`Retirer la balise ${b.code}`} onClick=${() => del(b.code)}>×</button>`}
            </span>`
          )}
        </div>`
      : html`<p class="muted small">Aucune balise pour l'instant.</p>`}
    ${editing &&
    html`<div class="picker-add mt">
      <input class="input input-sm mono" value=${text} placeholder="51 ou 51-55" onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} />
      <${Button} small icon="plus" onClick=${add} disabled=${!text.trim()}>Ajouter</${Button}>
    </div>`}
    <p class="muted small mt">Pastille de couleur : batterie du dernier contrôle (vert, orange, rouge ; gris si jamais contrôlée).</p>
  <//>`;
}

export function StationsPage() {
  const st = useStation();
  const [remote, setRemote] = useState(true);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState(0x02);
  const [codeText, setCodeText] = useState('31');
  const [syncTime, setSyncTime] = useState(true);
  const [done, setDone] = useState(null);
  const [log, setLog] = useState(loadLog());

  const record = (i, action) => {
    const entry = {
      at: Date.now(),
      action,
      serial: i.serial,
      model: i.model,
      mode: i.mode,
      code: i.code,
      battery: i.batteryPercent,
      drift: driftOf(i),
    };
    const next = [entry, ...log];
    setLog(next);
    saveLog(next);
  };

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const msg = humanError(e);
      toast(
        remote && (msg.includes('ne répond pas') || e.message === 'timeout')
          ? "Le boîtier ne répond pas : réveillez-le en y insérant une puce, posez-le contre le lecteur puis réessayez."
          : `Opération impossible : ${msg}`,
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  const read = () =>
    run(async () => {
      const i = await station.inspect(remote);
      if (remote && i.serial === station.info?.serial) throw new Error("c'est le lecteur lui-même qui a répondu");
      setInfo(i);
      setDone(null);
      if (CONFIG_MODES.some((m) => m.value === i.mode)) setMode(i.mode);
      setCodeText(String(i.code));
      record(i, 'Contrôle');
      noteBaliseChecked({ ...i, drift: driftOf(i) }).catch(() => {});
    });

  const program = () =>
    run(async () => {
      const code = Number(codeText);
      if (!remote && mode !== MODE_READOUT) {
        const ok = await confirmDialog({
          title: 'Programmer le lecteur',
          message: `Le lecteur ne pourra plus lire les doigts s'il devient « ${modeLabel(mode)} ». Continuer ?`,
          confirmLabel: 'Programmer',
          danger: true,
        });
        if (!ok) return;
      }
      const { after } = await station.program(remote, { mode, code, syncTime });
      setInfo(after);
      setDone(after);
      record(after, 'Programmé');
      noteBaliseChecked({ ...after, drift: driftOf(after) }).catch(() => {});
      toast(`Boîtier n° ${after.serial} programmé : ${modeLabel(after.mode)} ${after.code}${syncTime ? ', heure réglée' : ''}.`, 'success');
      if (mode === 0x02) setCodeText(String(Math.min(1023, code + 1)));
    });

  const codeNum = Number(codeText);
  const codeValid = Number.isInteger(codeNum) && codeNum >= 1 && codeNum <= 1023;

  return html`
    <${PageHeader} title="Programmer les boîtiers" subtitle="Fonction, numéro de poste, heure et batterie des boîtiers SportIdent.">
      ${!location.hash.startsWith('#/e/') && html`<${Button} icon="arrowLeft" onClick=${() => (location.hash = '#/')}>Accueil</${Button}>`}
    <//>
    <${StationPanel} />

    <div class="grid-2 stations-grid">
      <${Card} title="Boîtier à programmer">
        <${Segmented}
          value=${remote ? 'remote' : 'direct'}
          onChange=${(v) => {
            setRemote(v === 'remote');
            setInfo(null);
            setDone(null);
          }}
          options=${[
            { value: 'remote', label: 'Boîtier posé sur le lecteur' },
            { value: 'direct', label: 'Le lecteur lui-même' },
          ]}
        />
        ${remote
          ? html`<ol class="howto mt">
              <li><b>Réveillez</b> le boîtier en y insérant une puce (il bipe).</li>
              <li><b>Posez-le contre le lecteur</b> USB, zones de poinçonnage l'une contre l'autre, sans bouger.</li>
              <li>Cliquez sur <b>Lire le boîtier</b>, choisissez sa fonction puis <b>Programmer</b>.</li>
            </ol>`
          : html`<p class="muted small mt">Le lecteur USB doit rester en fonction « Lecture » pour lire les doigts.</p>`}
        <div class="row-actions">
          <${Button} icon="search" onClick=${read} disabled=${!st.connected || busy}>${busy ? 'Communication…' : 'Lire le boîtier'}</${Button}>
        </div>
        ${info && html`<div class="mt"><${InfoGrid} info=${info} /></div>`}
        ${done && html`<div class="alert alert-ok mt"><${Icon} name="check" /> <span>Programmé et vérifié : <b>${modeLabel(done.mode)} ${done.code}</b>${syncTime ? ', heure réglée' : ''}. Vous pouvez poser le boîtier suivant.</span></div>`}
      <//>

      <${Card} title="Nouvelle programmation">
        <${Field} label="Fonction">
          <select class="input" value=${mode} onChange=${(e) => setMode(Number(e.target.value))}>
            ${CONFIG_MODES.map((m) => html`<option value=${m.value}>${m.label}</option>`)}
          </select>
        <//>
        <${Field} label=${mode === 0x02 ? 'Numéro de poste' : 'Numéro du boîtier'} hint=${mode === 0x02 ? 'De 31 à 255 en général (1 à 1023 possible). Il augmente de 1 après chaque programmation.' : 'Numéro libre (ex. : 1 pour le départ, 2 pour l\'arrivée).'} error=${codeText && !codeValid ? 'Entre 1 et 1023' : ''}>
          <input class="input mono" value=${codeText} inputmode="numeric" onInput=${(e) => setCodeText(e.target.value)} />
        <//>
        <label class="check"><input type="checkbox" checked=${syncTime} onChange=${(e) => setSyncTime(e.target.checked)} /><span>Mettre le boîtier à l'heure de l'ordinateur (recommandé)</span></label>
        <div class="row-actions">
          <${Button} variant="primary" icon="settings" onClick=${program} disabled=${!st.connected || busy || !codeValid}>Programmer ${remote ? 'le boîtier' : 'le lecteur'}</${Button}>
        </div>
        <p class="muted small mt">CO - P3OPS écrit la fonction et le numéro, règle l'heure, puis relit le boîtier pour vérifier.</p>
      <//>
    </div>

    <${KnownBalises}
      onPick=${(code) => {
        setMode(0x02);
        setCodeText(String(code));
        setRemote(true);
        toast(`Balise ${code} choisie : posez le boîtier sur le lecteur, puis « Programmer le boîtier ».`, 'info');
      }}
    />

    <${Card}
      title=${`Boîtiers contrôlés (${log.length})`}
      pad=${false}
      class="mt"
      actions=${log.length > 0 && html`<${Button} small onClick=${() => { setLog([]); saveLog([]); }}>Effacer la liste</${Button}>`}
    >
      ${log.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Heure</th><th>Action</th><th>Boîtier</th><th>Fonction</th><th class="num">N°</th><th>Batterie</th><th>Horloge</th></tr></thead>
            <tbody>
              ${log.map(
                (e, i) => html`<tr key=${i}>
                  <td class="mono">${new Date(e.at).toLocaleTimeString('fr-FR').slice(0, 5)}</td>
                  <td>${e.action === 'Programmé' ? html`<${Badge} kind="ok">programmé<//>` : html`<${Badge} kind="muted">contrôlé<//>`}</td>
                  <td>${e.model} <span class="mono">${e.serial}</span></td>
                  <td>${modeLabel(e.mode)}</td>
                  <td class="num mono">${e.code}</td>
                  <td><${BatteryGauge} percent=${e.battery} /></td>
                  <td class=${e.drift != null && Math.abs(e.drift) > 2 ? 'text-warn' : ''}>${fmtDrift(e.drift)}</td>
                </tr>`
              )}
            </tbody>
          </table></div>`
        : html`<${EmptyState} icon="battery" title="Aucun boîtier contrôlé" text="Chaque boîtier lu ou programmé s'ajoute ici : vous voyez d'un coup d'œil les batteries faibles et les horloges décalées." />`}
    <//>
  `;
}
