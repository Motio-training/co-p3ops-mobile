// Accueil : grandes actions (charger, créer, importer une course…), sans liste encombrante.
import { html, useEffect, useState } from '../../lib.js';
import { api } from '../../core/api.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { store } from '../../core/store.js';
import { compareText, formatDate, norm, pickFile, plural, readFileText } from '../../core/util.js';
import { Badge, Button, EmptyState, Icon, Menu, Modal, SearchInput, Spinner } from '../components.js';
import { Logo } from '../icons.js';
import { go } from '../hooks.js';
import { EventModal } from './event-form.js';
import { quitApp } from '../quit.js';

/** État d'une course, d'après ses données enregistrées. */
export function eventState(item) {
  const ev = item.event;
  const n = item.counts || {};
  if (n.card > 0) return { kind: 'info', label: `Course lancée · ${plural(n.card, 'doigt lu', 'doigts lus')}` };
  const ready = ev.mode === 'score' ? n.competitor > 0 && n.course > 0 && !!ev.scoringConfirmed : n.competitor > 0 && n.course > 0;
  return ready ? { kind: 'ok', label: 'Course prête' } : { kind: 'warn', label: 'En préparation' };
}

function LoadModal({ onClose }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const readonly = store.readonly;

  const load = async () => {
    try {
      setEvents(await api.listEvents());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const exportOne = async (id) => {
    const { downloadFile, slug } = await import('../../core/util.js');
    const data = await api.getEvent(id);
    const payload = { format: 'balise-epreuve', version: 1, exportedAt: new Date().toISOString(), event: data.event, docs: data.docs };
    downloadFile(`${slug(data.event.name)}.balise.json`, JSON.stringify(payload, null, 1), 'application/json');
  };

  const del = async (item) => {
    const ok = await confirmDialog({
      title: 'Supprimer la course',
      message: `Supprimer « ${item.event.name} » et toutes ses données ? Une copie de sécurité sera conservée dans le dossier « donnees/corbeille ».`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEvent(item.event.id);
      toast('Course supprimée.', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const open = (id) => {
    onClose();
    go(`e/${id}`);
  };

  const nq = norm(q);
  const list = (events || [])
    .filter((it) => !nq || norm(`${it.event.name} ${it.event.place || ''} ${formatDate(it.event.date)}`).includes(nq))
    .sort((a, b) => compareText(b.event.date || '', a.event.date || '') || b.updated - a.updated);

  return html`<${Modal} title="Charger une course" size="lg" onClose=${onClose}>
    ${error && html`<div class="banner banner-error"><${Icon} name="alert" /> ${error}</div>`}
    ${!events && !error && html`<${Spinner} label="Chargement…" />`}
    ${events && !events.length && html`<${EmptyState} icon="flag" title="Aucune course enregistrée" text="Créez une nouvelle course depuis l'accueil." />`}
    ${events?.length > 6 && html`<div class="mb"><${SearchInput} value=${q} onInput=${setQ} placeholder="Nom, lieu, date…" autoFocus /></div>`}
    ${events?.length > 0 &&
    html`<div class="event-list">
      ${list.map((item) => {
        const st = eventState(item);
        return html`<div class="event-item" key=${item.event.id}>
          <button type="button" class="event-main" onClick=${() => open(item.event.id)}>
            <div class="event-date">
              <span>${item.event.date ? new Date(item.event.date + 'T12:00').toLocaleDateString('fr-FR', { day: '2-digit' }) : '--'}</span>
              <small>${item.event.date ? new Date(item.event.date + 'T12:00').toLocaleDateString('fr-FR', { month: 'short' }) : ''}</small>
            </div>
            <div class="event-info">
              <strong>${item.event.name}</strong>
              <span class="muted">${[formatDate(item.event.date), item.event.place, item.event.mode === 'score' ? 'Course au score' : 'Course en ligne'].filter(Boolean).join(' · ')}</span>
            </div>
            <${Badge} kind=${st.kind}>${st.label}<//>
            <${Icon} name="chevronRight" />
          </button>
          <${Menu}
            label="Plus"
            small
            items=${[
              { label: 'Exporter (sauvegarde)', icon: 'download', onClick: () => exportOne(item.event.id) },
              { label: "Ouvrir l'écran de résultats", icon: 'monitor', onClick: () => window.open(`#/ecran/${item.event.id}`, '_blank') },
              !readonly && { separator: true },
              !readonly && { label: 'Supprimer', icon: 'trash', danger: true, onClick: () => del(item) },
            ]}
          />
        </div>`;
      })}
      ${!list.length && html`<p class="muted center">Aucune course ne correspond à « ${q} ».</p>`}
    </div>`}
  <//>`;
}

function Tile({ icon, title, text, onClick, primary, disabled }) {
  return html`<button type="button" class=${'home-tile' + (primary ? ' primary' : '')} onClick=${onClick} disabled=${disabled}>
    <span class="home-tile-icon"><${Icon} name=${icon} size=${primary ? 30 : 22} /></span>
    <span class="home-tile-text"><strong>${title}</strong>${text && html`<span>${text}</span>`}</span>
  </button>`;
}

export function HomePage() {
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const readonly = store.readonly;

  const create = async (ev) => {
    try {
      const { event } = await api.createEvent(ev);
      setCreating(false);
      go(`e/${event.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const importFile = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const payload = JSON.parse(await readFileText(file));
      const { event } = await api.importEvent(payload);
      toast(`Course « ${event.name} » importée.`, 'success');
      go(`e/${event.id}`);
    } catch (e) {
      toast(e instanceof SyntaxError ? "Ce fichier n'est pas un fichier de course CO - P3OPS valide." : e.message, 'error');
    }
  };

  return html`<div class="home">
    <header class="home-head">
      <div class="brand-lg"><${Logo} size=${40} /><div><h1>CO - P3OPS</h1><p>Gestion de course d'orientation · SportIdent</p></div></div>
    </header>

    <div class="home-main">
      <${Tile} primary icon="flag" title="Charger une course" text="Reprendre une course préparée ou déjà réalisée" onClick=${() => setLoading(true)} />
      ${!readonly && html`<${Tile} primary icon="plus" title="Nouvelle course" text="Préparer une course étape par étape" onClick=${() => setCreating(true)} />`}
    </div>
    ${!readonly &&
    html`<div class="home-more">
      <${Tile} icon="upload" title="Importer une course" text="Fichier de sauvegarde .balise.json" onClick=${importFile} />
      <${Tile} icon="settings" title="Programmer les boîtiers" text="Fonction, numéro, batterie, heure" onClick=${() => go('boitiers')} />
      <${Tile} icon="list" title="Réglages" text="Circuits et barèmes" onClick=${() => go('reglages')} />
    </div>`}

    <p class="home-foot muted">
      Les données sont enregistrées dans ce téléphone. Après la course, exportez-la (« Charger une course », puis « Plus » et « Exporter ») pour la garder ou l'ouvrir sur le PC.
      ${store.serverInfo?.network &&
      store.serverInfo.addresses?.length > 0 &&
      html`<br />Résultats consultables depuis le réseau local : ${store.serverInfo.addresses.map((a) => html`<code>http://${a}:${store.serverInfo.port}/</code> `)}`}
    </p>
    ${loading && html`<${LoadModal} onClose=${() => setLoading(false)} />`}
    ${creating && html`<${EventModal} title="Nouvelle course" submitLabel="Créer la course" onSubmit=${create} onClose=${() => setCreating(false)} />`}
  </div>`;
}
