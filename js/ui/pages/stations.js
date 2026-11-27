// Programmation des boîtiers SportIdent : fonction, n° de poste, heure, batterie.
import { html, useEffect, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { station, humanError } from '../../sportident/station.js';
import { CONFIG_MODES, MODE_NAMES, MODE_READOUT, isControlMode } from '../../sportident/constants.js';
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
  return CONFIG_MODES.find((m) => m.value === mode)?.label || MODE_NAMES[mode] || `mode ${mode}`;
}

const settingLabel = (mode, code) => `${modeLabel(mode)} n° ${code}`;

/** Heure du boîtier, qui avance en direct (d'après l'écart mesuré à la lecture). */
function LiveClock({ info }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const drift = driftOf(info);
  if (drift == null) return html`<span class="muted">illisible</span>`;
  const now = new Date(Date.now() + drift * 1000);
  return html`<span class="mono clock-big">${now.toLocaleTimeString('fr-FR')}</span>
    <span class=${Math.abs(drift) > 2 ? 'text-warn' : 'text-ok'}> ${fmtDrift(drift)}</span>`;
}

function BatteryGauge({ percent }) {
  if (percent == null) return html`<span class="muted">non disponible</span>`;
  const kind = percent < 20 ? 'err' : percent < 40 ? 'warn' : 'ok';
  return html`<span class="battery">
    <span class=${'battery-bar battery-' + kind}><span style=${`width:${percent}%`}></span></span>
    <strong class=${'text-' + (kind === 'warn' ? 'warn' : kind)}>${percent} %</strong>
  </span>`;
}

function InfoGrid({ info, onSyncClock, busy }) {
  const drift = driftOf(info);
  const late = drift == null || Math.abs(drift) > 2;
  return html`<dl class="facts station-facts">
    <dt>Boîtier</dt><dd><strong>${info.model}</strong> n° ${info.serial} <span class="muted small">· firmware ${info.firmware}</span></dd>
    <dt>Fonction</dt><dd><strong>${modeLabel(info.mode)}</strong> · n° <strong>${info.code}</strong></dd>
    <dt>Batterie</dt>
    <dd>
      <${BatteryGauge} percent=${info.batteryPercent} />
      ${info.capacityMah && html`<span class="muted small"> · ${info.usedMah} mAh consommés sur ${info.capacityMah} mAh</span>`}
      ${info.batteryPercent != null && info.batteryPercent < 20 && html`<br /><span class="text-err small"><b>Pile à changer</b> avant la prochaine course.</span>`}
      ${info.batteryDate && html`<br /><span class="muted small">Pile changée le ${info.batteryDate}</span>`}
    </dd>
    <dt>Heure</dt>
    <dd>
      <${LiveClock} info=${info} />
      ${onSyncClock &&
      html`<div class="mt-sm"><${Button} small variant=${late ? 'primary' : 'secondary'} icon="clock" onClick=${onSyncClock} disabled=${busy}>${late ? "Mettre à l'heure" : "Resynchroniser l'heure"}</${Button}></div>`}
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
  const [done, setDone] = useState(null); // dernier boîtier programmé (relu)
  const [confirmed, setConfirmed] = useState(null); // résumé « avant → après » de la dernière programmation
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
      setConfirmed(null);
      if (CONFIG_MODES.some((m) => m.value === i.mode)) setMode(i.mode);
      setCodeText(String(i.code));
      record(i, 'Contrôle');
      noteBaliseChecked({ ...i, drift: driftOf(i) }).catch(() => {});
    });

  // Mise à l'heure seule (sans toucher à la fonction ni au numéro)
  const syncClock = () =>
    run(async () => {
      const target = info || done;
      const c = await station.syncClock(remote);
      const next = { ...target, ...c };
      if (info) setInfo(next);
      else setDone(next);
      record(next, "Mis à l'heure");
      noteBaliseChecked({ ...next, drift: driftOf(next) }).catch(() => {});
      toast(`Boîtier n° ${next.serial} mis à l'heure (${fmtDrift(driftOf(next))}).`, 'success');
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
      const { before, after } = await station.program(remote, { mode, code, syncTime, expectSerial: info?.serial || null });
      setConfirmed({ from: info ? settingLabel(before.mode, before.code) : null, to: settingLabel(after.mode, after.code), serial: after.serial, synced: syncTime });
      setInfo(null);
      setDone(after);
      record(after, 'Programmé');
      noteBaliseChecked({ ...after, drift: driftOf(after) }).catch(() => {});
      toast(`Boîtier n° ${after.serial} programmé : ${modeLabel(after.mode)} ${after.code}${syncTime ? ', heure réglée' : ''}.`, 'success');
      if (isControlMode(mode)) setCodeText(String(Math.min(1023, code + 1))); // prêt pour le boîtier suivant
    });

  const codeNum = Number(codeText);
  const codeValid = Number.isInteger(codeNum) && codeNum >= 1 && codeNum <= 1023;
  const shown = info || done;
  // Boîtier lu : les réglages proposés partent de ses réglages actuels ; « Valider » n'écrit que s'ils changent.
  const changed = !!info && codeValid && (mode !== info.mode || codeNum !== info.code);
  const contactless = (m) => m >= 0x32 && m <= 0x34;

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
              <li>Cliquez sur <b>Lire le boîtier</b> : sa batterie et son heure s'affichent.</li>
              <li>Au besoin, <b>mettez-le à l'heure</b>, ou changez sa fonction ou son numéro puis <b>Valider les réglages</b>.</li>
            </ol>`
          : html`<p class="muted small mt">Le lecteur USB doit rester en fonction « Lecture » pour lire les doigts.</p>`}
        <div class="row-actions">
          <${Button} icon="search" onClick=${read} disabled=${!st.connected || busy}>${busy ? 'Communication…' : 'Lire le boîtier'}</${Button}>
        </div>
        ${confirmed &&
        html`<div class="alert alert-ok mt"><${Icon} name="check" /> <span>
          Boîtier n° ${confirmed.serial}${confirmed.from && confirmed.from !== confirmed.to ? html` : <s>${confirmed.from}</s> → ` : ' : '}<b>${confirmed.to}</b>, vérifié par relecture${confirmed.synced ? ', heure réglée' : ''}.
          Vous pouvez poser le boîtier suivant.
        </span></div>`}
        ${shown &&
        html`<div class="mt">
          ${!info && html`<p class="muted small">Dernier boîtier programmé :</p>`}
          <${InfoGrid} info=${shown} onSyncClock=${syncClock} busy=${busy} />
        </div>`}
      <//>

      <${Card} title=${info ? 'Réglages du boîtier lu' : 'Nouvelle programmation'}>
        ${info && html`<p class="muted small">Réglages actuels : <b>${settingLabel(info.mode, info.code)}</b>. Modifiez la fonction ou le numéro, puis validez.</p>`}
        <${Field} label="Fonction">
          <select class="input" value=${mode} onChange=${(e) => setMode(Number(e.target.value))}>
            ${CONFIG_MODES.map((m) => html`<option value=${m.value}>${m.label}</option>`)}
          </select>
        <//>
        <${Field} label=${isControlMode(mode) ? 'Numéro de poste' : 'Numéro du boîtier'} hint=${isControlMode(mode) ? 'De 31 à 255 en général (1 à 1023 possible). Il augmente de 1 après chaque programmation.' : 'Numéro libre (ex. : 1 pour le départ, 2 pour l\'arrivée).'} error=${codeText && !codeValid ? 'Entre 1 et 1023' : ''}>
          <input class="input mono" value=${codeText} inputmode="numeric" onInput=${(e) => setCodeText(e.target.value)} />
        <//>
        <label class="check"><input type="checkbox" checked=${syncTime} onChange=${(e) => setSyncTime(e.target.checked)} /><span>Mettre le boîtier à l'heure de l'ordinateur (recommandé)</span></label>
        ${info &&
        (changed
          ? html`<div class="alert alert-warn mt"><${Icon} name="alert" /> <span>
              Changement : <s>${settingLabel(info.mode, info.code)}</s> → <b>${settingLabel(mode, codeNum)}</b>
              ${contactless(info.mode) && !contactless(mode) ? html`<br />Attention : le poinçonnage sans contact (SIAC) sera désactivé.` : ''}
            </span></div>`
          : html`<p class="muted small mt">Aucun changement par rapport au boîtier lu.</p>`)}
        <div class="row-actions">
          ${info
            ? html`<${Button} variant="primary" icon="check" onClick=${program} disabled=${!st.connected || busy || !changed}>Valider les réglages</${Button}>`
            : html`<${Button} variant="primary" icon="settings" onClick=${program} disabled=${!st.connected || busy || !codeValid}>Programmer ${remote ? 'le boîtier' : 'le lecteur'}</${Button}>`}
        </div>
        <p class="muted small mt">CO - P3OPS écrit la fonction et le numéro${syncTime ? ", règle l'heure" : ''}, puis relit le boîtier pour vérifier. Pour régler seulement l'heure : bouton « Mettre à l'heure », sous l'heure du boîtier.</p>
      <//>
    </div>

    <${KnownBalises}
      onPick=${(code) => {
        setMode(info && isControlMode(info.mode) ? info.mode : 0x02);
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
                  <td>${e.action === 'Programmé' ? html`<${Badge} kind="ok">programmé<//>` : e.action === "Mis à l'heure" ? html`<${Badge} kind="info">mis à l'heure<//>` : html`<${Badge} kind="muted">contrôlé<//>`}</td>
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
