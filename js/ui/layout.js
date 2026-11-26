// Cadre d'une épreuve : menu latéral, barre supérieure, page courante.
import { html, useEffect } from '../lib.js';
import { getDerived, openEvent } from '../core/store.js';
import { formatDate } from '../core/util.js';
import { Icon, Logo } from './icons.js';
import { Button, EmptyState, Spinner } from './components.js';
import { go, useStation, useStore } from './hooks.js';
import { MODE_READOUT } from '../sportident/constants.js';
import { DashboardPage } from './pages/dashboard.js';
import { CoursesPage } from './pages/courses.js';
import { ClassesPage } from './pages/classes.js';
import { CompetitorsPage } from './pages/competitors.js';
import { StartsPage } from './pages/starts.js';
import { ReadoutPage } from './pages/readout.js';
import { ResultsPage } from './pages/results.js';
import { GuidePage, preparationChecks } from './pages/guide.js';
import { isScoreMode } from '../domain/results.js';
import { QuitButton } from './quit.js';
import { StationsPage } from './pages/stations.js';

const PAGES = {
  deroule: GuidePage,
  tableau: DashboardPage,
  circuits: CoursesPage,
  categories: ClassesPage,
  coureurs: CompetitorsPage,
  departs: StartsPage,
  lecture: ReadoutPage,
  resultats: ResultsPage,
  boitiers: StationsPage,
};

// Menu d'une course d'orientation militaire (au score)
const NAV_SCORE = [
  {
    items: [
      { id: 'deroule', label: 'Déroulé de la course', icon: 'flag' },
      { id: 'tableau', label: 'Tableau de bord', icon: 'grid' },
    ],
  },
  {
    title: 'Préparation',
    items: [
      { id: 'coureurs', label: 'Personnels', icon: 'users' },
      { id: 'circuits', label: 'Balises', icon: 'route' },
      { id: 'categories', label: 'Catégories', icon: 'tag' },
      { id: 'boitiers', label: 'Programmer les boîtiers', icon: 'settings' },
    ],
  },
  {
    title: 'Jour de course',
    items: [
      { id: 'lecture', label: 'Lecture des doigts', icon: 'chip' },
      { id: 'resultats', label: 'Résultats et notes', icon: 'trophy' },
    ],
  },
];

const NAV = [
  { items: [{ id: 'tableau', label: 'Tableau de bord', icon: 'grid' }] },
  {
    title: 'Préparation',
    items: [
      { id: 'circuits', label: 'Circuits', icon: 'route' },
      { id: 'categories', label: 'Catégories', icon: 'tag' },
      { id: 'coureurs', label: 'Coureurs', icon: 'users' },
      { id: 'departs', label: 'Départs', icon: 'clock' },
      { id: 'boitiers', label: 'Programmer les boîtiers', icon: 'settings' },
    ],
  },
  {
    title: 'Jour de course',
    items: [
      { id: 'lecture', label: 'Lecture des puces', icon: 'chip' },
      { id: 'resultats', label: 'Résultats', icon: 'trophy' },
    ],
  },
];

/**
 * État du lecteur pour le menu : rouge (non branché ou mal réglé), orange (branché, course à préparer),
 * vert (branché, reconnu et course prête à être lancée).
 */
export function readerStatus(st, s) {
  const score = isScoreMode(s.event);
  const prepOk = !score || preparationChecks(s).every((c) => c.ok);
  const badMode = st.connected && st.info?.mode != null && st.info.mode !== MODE_READOUT;
  if (st.state === 'connecting') return { kind: 'warn', label: 'Connexion du lecteur…' };
  if (!st.connected) return { kind: 'bad', label: st.state === 'error' ? 'Lecteur déconnecté' : 'Lecteur non branché' };
  if (badMode) return { kind: 'bad', label: 'Lecteur pas en mode Lecture' };
  if (st.reading) return { kind: 'ok', label: `Lecture de la puce ${st.reading.number}…`, reading: true };
  if (!prepOk) return { kind: 'warn', label: 'Lecteur prêt · course à préparer' };
  return { kind: 'ok', label: st.simulated ? 'Lecteur prêt (simulation)' : 'Lecteur prêt' };
}

function StationChip({ eventId, status }) {
  return html`<a class=${'station-chip chip-' + status.kind + (status.reading ? ' reading' : '')} href=${`#/e/${eventId}/lecture`} title="Lecture des puces">
    <span class="dot"></span>${status.label}
  </a>`;
}

export function EventShell({ eventId, page, sub }) {
  const s = useStore();
  const st = useStation(); // le menu suit l'état du lecteur (rouge / orange / vert)
  useEffect(() => {
    openEvent(eventId);
  }, [eventId]);

  if (s.eventId !== eventId || s.status === 'loading' || s.status === 'idle') {
    return html`<div class="fullscreen-center"><${Spinner} label="Ouverture de l'épreuve…" /></div>`;
  }
  if (s.status === 'error') {
    return html`<div class="fullscreen-center"><div class="card narrow"><${EmptyState} icon="alert" title="Épreuve indisponible" text=${s.error}>
      <${Button} icon="arrowLeft" onClick=${() => go('')}>Retour à l'accueil</${Button}>
    <//></div></div>`;
  }

  const d = getDerived();
  const counts = {
    circuits: s.courses.size,
    categories: s.classes.size,
    // Personnes réellement inscrites (nom, prénom) : les puces vacantes du fichier d'inscription ne comptent pas
    coureurs: [...s.competitors.values()].filter((c) => c.lastName || c.firstName).length,
    lecture: d.unassigned.length,
  };
  const score = isScoreMode(s.event);
  const nav = score ? NAV_SCORE : NAV;
  const status = readerStatus(st, s);
  const current = PAGES[page] ? page : score ? 'deroule' : 'tableau';
  const Page = PAGES[current];

  return html`<div class="app-shell">
    <aside class="sidebar">
      <a class="sidebar-brand" href="#/"><${Logo} size=${26} /><span>CO - P3OPS</span></a>
      <nav class="nav">
        ${nav.map(
          (group) => html`<div class="nav-group">
            ${group.title && html`<div class="nav-title">${group.title}</div>`}
            ${group.items.map(
              (item) => html`<a class=${'nav-item' + (current === item.id ? ' active' : '')} href=${`#/e/${eventId}/${item.id}`}>
                <${Icon} name=${item.icon} size=${18} />
                <span>${item.label}</span>
                ${item.id === 'lecture'
                  ? html`${counts.lecture > 0 && html`<span class="nav-count warn" title="Puces à traiter">${counts.lecture}</span>`}<span class=${'nav-dot ' + status.kind} title=${status.label}></span>`
                  : counts[item.id] > 0 && html`<span class="nav-count">${counts[item.id]}</span>`}
              </a>`
            )}
          </div>`
        )}
      </nav>
      <div class="sidebar-foot">
        <span class=${'sync ' + (s.live ? 'on' : 'off')} title=${s.live ? 'Synchronisé avec le serveur' : 'Connexion au serveur perdue : reconnexion…'}>
          <span class="dot"></span>${s.live ? 'Enregistré' : 'Hors ligne'}
        </span>
        <a class="nav-item" href="#/"><${Icon} name="arrowLeft" size=${18} /><span>Accueil</span></a>
        ${!s.readonly && html`<${QuitButton} />`}
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">
          <strong>${s.event.name}</strong>
          <span class="muted">${formatDate(s.event.date)}</span>
        </div>
        <div class="topbar-right">
          <${StationChip} eventId=${eventId} status=${status} />
          <${Button} small icon="monitor" onClick=${() => window.open(`#/ecran/${eventId}`, `balise-ecran-${eventId}`)} title="Écran de résultats pour le public">Écran</${Button}>
        </div>
      </header>
      ${s.readonly && html`<div class="banner banner-info"><${Icon} name="info" /> Consultation seule : ce poste peut afficher l'épreuve mais pas la modifier.</div>`}
      <main class="page" key=${current}>
        <${Page} sub=${sub} />
      </main>
    </div>
  </div>`;
}
