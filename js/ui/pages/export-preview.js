// Aperçu du fichier Excel des notes avant téléchargement : un onglet par section, comme dans Excel.
// La remarque des personnes dont la puce n'a pas été lue se modifie ici (« Inapte », « Absent »…).
import { html, useEffect, useState } from '../../lib.js';
import { bus, toast } from '../../core/bus.js';
import { getDerived, mutate, putOp, store, updateEvent } from '../../core/store.js';
import { compareText } from '../../core/util.js';
import { fmtDuration } from '../../core/time.js';
import { exportExcel, remarkFor } from '../../io/reports.js';
import { Button, Modal } from '../components.js';
import { useStore } from '../hooks.js';

const QUICK = ['Inapte', 'Absent', 'A dénoncé son contrat'];

/** Ouvre l'aperçu (n'importe où dans une course). */
export function openExportPreview() {
  bus.emit('export-preview', true);
}

export function ExportPreviewHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => bus.on('export-preview', () => setOpen(true)), []);
  return open ? html`<${ExportPreviewModal} onClose=${() => setOpen(false)} />` : null;
}

const unread = (res) => !res.readId && (res.status === 'RUN' || res.status === 'DNS');

function ExportPreviewModal({ onClose }) {
  const s = useStore();
  const d = getDerived();
  const [drafts, setDrafts] = useState({}); // remarques en cours de saisie, par personne
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);

  // Mêmes lignes que dans le fichier Excel : un onglet par section, ordre alphabétique
  const groups = d.groups
    .map((g) => ({
      name: g.name,
      rows: g.rows
        .filter((r) => r.comp.lastName || r.comp.firstName || r.res.readId)
        .sort((a, b) => compareText(a.comp.lastName || '~', b.comp.lastName || '~') || compareText(a.comp.firstName, b.comp.firstName)),
    }))
    .filter((g) => g.rows.length);
  const current = groups[Math.min(tab, groups.length - 1)];
  const used = [...new Set([...QUICK, ...[...s.competitors.values()].map((c) => c.exportComment).filter(Boolean)])];

  const valueOf = (comp) => (comp.id in drafts ? drafts[comp.id] : comp.exportComment || '');
  const setDraft = (comp, v) => setDrafts((x) => ({ ...x, [comp.id]: v }));
  const saveOne = (comp, v) => {
    const text = String(v ?? '').trim();
    if ((comp.exportComment || '') === text) return;
    mutate([putOp('competitor', { ...comp, exportComment: text })]);
  };

  // Remarques saisies, enregistrées dans la course
  const flush = () => {
    const ops = [];
    for (const [id, v] of Object.entries(drafts)) {
      const comp = store.competitors.get(id);
      const text = String(v ?? '').trim();
      if (comp && (comp.exportComment || '') !== text) ops.push(putOp('competitor', { ...comp, exportComment: text }));
    }
    if (ops.length) mutate(ops);
    setDrafts({});
  };

  const download = async () => {
    setBusy(true);
    try {
      flush();
      await exportExcel();
      updateEvent({ exportedAt: Date.now() });
      toast('Fichier Excel téléchargé (dossier Téléchargements).', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    flush();
    onClose();
  };

  const nbUnread = groups.reduce((n, g) => n + g.rows.filter((r) => unread(r.res)).length, 0);

  return html`<${Modal}
    title="Exporter les notes : aperçu du fichier Excel"
    size="xl"
    onClose=${close}
    autoFocus=${false}
    footer=${html`<span class="muted small">${nbUnread ? `${nbUnread} personne${nbUnread > 1 ? 's' : ''} sans lecture de puce : complétez leur remarque si besoin.` : 'Toutes les puces ont été lues.'}</span>
      <span class="spacer"></span>
      <${Button} onClick=${close}>Fermer</${Button}>
      <${Button} variant="primary" icon="download" onClick=${download} disabled=${busy || !groups.length}>${busy ? 'Création…' : 'Télécharger le fichier Excel'}</${Button}>`}
  >
    ${!groups.length
      ? html`<p class="muted">Aucune donnée à exporter pour l'instant.</p>`
      : html`
        <div class="xp-tabs" role="tablist">
          ${groups.map(
            (g, i) => html`<button type="button" role="tab" class=${'xp-tab' + (g === current ? ' on' : '')} aria-selected=${g === current} onClick=${() => setTab(i)}>
              ${g.name} <small>${g.rows.length}</small>
            </button>`
          )}
        </div>
        <datalist id="xp-remarks">${used.map((r) => html`<option value=${r} />`)}</datalist>
        <div class="table-wrap bordered xp-table">
          <table class="table table-tight">
            <thead>
              <tr><th>Nom</th><th>Prénom</th><th class="num">Temps</th><th class="num">Balises validées</th><th>Balises manquantes</th><th class="num">Note /20</th><th class="xp-rem">Remarques</th></tr>
            </thead>
            <tbody>
              ${current.rows.map(({ comp, res }) => {
                const editable = unread(res);
                const v = valueOf(comp);
                return html`<tr key=${comp.id} class=${editable ? 'xp-unread' : ''}>
                  <td class="xp-name"><strong>${comp.lastName || '—'}</strong> <span class="xp-first">${comp.firstName}</span></td>
                  <td class="xp-firstcol">${comp.firstName}</td>
                  <td class="num mono" data-l="Temps">${res.status === 'RUN' || res.status === 'DNS' || res.time == null ? '' : fmtDuration(res.time)}</td>
                  <td class="num" data-l="Balises validées">${res.readId ? res.validated : ''}</td>
                  <td class="mono" data-l="Balises manquantes">${res.readId ? res.missing.join(', ') : ''}</td>
                  <td class="num" data-l="Note /20">${res.note != null ? html`<strong>${res.note}</strong>` : ''}</td>
                  <td class="xp-rem" data-l="Remarques">
                    ${editable
                      ? html`<div class="xp-edit">
                          <input class="input input-sm" list="xp-remarks" value=${v} placeholder=${remarkFor({ ...comp, exportComment: '' }, res)}
                            onInput=${(e) => setDraft(comp, e.target.value)} onBlur=${(e) => saveOne(comp, e.target.value)} />
                          <div class="xp-quick">
                            ${QUICK.map(
                              (q) => html`<button type="button" class=${'xp-chip' + (v === q ? ' on' : '')} onClick=${() => {
                                const next = v === q ? '' : q;
                                setDraft(comp, next);
                                saveOne(comp, next);
                              }}>${q}</button>`
                            )}
                          </div>
                        </div>`
                      : remarkFor(comp, res) ? html`<span class="small">${remarkFor(comp, res)}</span>` : ''}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      `}
  <//>`;
}
