// Point d'entrée de l'interface CO - P3OPS.
import { html, render } from './lib.js';
import { initInfo } from './core/store.js';
import { startHeartbeat } from './core/api.js';
import { initReadout } from './core/readout.js';
import { station } from './sportident/station.js';
import { DialogHost, ToastHost } from './ui/components.js';
import { useRoute } from './ui/hooks.js';
import { EventShell } from './ui/layout.js';
import { HomePage } from './ui/pages/home.js';
import { DisplayPage } from './ui/pages/display.js';
import { StationsPage } from './ui/pages/stations.js';
import { SettingsPage } from './ui/pages/settings.js';
import { ExportPreviewHost } from './ui/pages/export-preview.js';

function App() {
  const route = useRoute();
  let content;
  if (route[0] === 'ecran' && route[1]) content = html`<${DisplayPage} eventId=${route[1]} />`;
  else if (route[0] === 'boitiers') content = html`<div class="page standalone"><${StationsPage} /></div>`;
  else if (route[0] === 'reglages') content = html`<div class="page standalone"><${SettingsPage} tab=${route[1]} /></div>`;
  else if (route[0] === 'circuits' || route[0] === 'baremes') content = html`<div class="page standalone"><${SettingsPage} tab=${route[0]} /></div>`;
  else if (route[0] === 'e' && route[1]) content = html`<${EventShell} eventId=${route[1]} page=${route[2]} sub=${route[3]} />`;
  else content = html`<${HomePage} />`;
  return html`${content}<${ExportPreviewHost} /><${ToastHost} /><${DialogHost} />`;
}

// Fermer la fenêtre alors que le boîtier est connecté demande confirmation.
window.addEventListener('beforeunload', (e) => {
  if (station.connected && !station.simulated) {
    e.preventDefault();
    e.returnValue = '';
  }
});

await initInfo();
initReadout();
startHeartbeat();
render(html`<${App} />`, document.getElementById('app'));

// L'interface a démarré : le diagnostic « navigateur incompatible » (index.html) n'a plus lieu d'être.
window.__p3opsStarted = true;
document.getElementById('fallback')?.remove();
