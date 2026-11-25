// Bouton « Quitter » : arrête le serveur local et ferme la fenêtre.
import { html, render } from '../lib.js';
import { api } from '../core/api.js';
import { confirmDialog, toast } from '../core/bus.js';
import { station } from '../sportident/station.js';
import { Icon, Logo } from './icons.js';

export async function quitApp() {
  const ok = await confirmDialog({
    title: 'Quitter CO - P3OPS',
    message: 'Toutes les données sont déjà enregistrées. Fermer CO - P3OPS maintenant ?',
    confirmLabel: 'Quitter',
  });
  if (!ok) return;
  try {
    if (station.connected) await station.disconnect();
  } catch {}
  try {
    await api.quit();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  render(
    html`<div class="fullscreen-center"><div class="card narrow quit-card">
      <${Logo} size=${44} />
      <h2>CO - P3OPS est fermé</h2>
      <p class="muted">Vous pouvez fermer cette fenêtre. Pour le relancer, utilisez l'icône « CO - P3OPS » du Bureau.</p>
    </div></div>`,
    document.getElementById('app')
  );
  setTimeout(() => window.close(), 400);
}

export function QuitButton({ class: cls = 'nav-item' }) {
  return html`<button type="button" class=${cls + ' quit-btn'} onClick=${quitApp} title="Arrêter CO - P3OPS">
    <${Icon} name="power" size=${18} /><span>Quitter</span>
  </button>`;
}
