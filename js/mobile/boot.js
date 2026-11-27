// Démarrage de CO - P3OPS Mobile : chargé AVANT js/main.js (même interface que sur PC).
//  1. pilote USB du lecteur SportIdent (Android, câble OTG) ;
//  2. « serveur » local : les données restent dans le téléphone ;
//  3. fonctionnement hors connexion (le jour de la course, en forêt).
import './usb-serial.js';
import './local-server.js';

document.documentElement.classList.add('mobile-app');

// (Dans l'application Android, les fichiers sont déjà dans l'APK : pas de mise en cache.)
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.__P3OPS_APK) {
  // Une mise à jour a été installée pendant que l'ancienne version était affichée : on recharge pour
  // l'afficher tout de suite (sauf si le lecteur de puces est branché : on ne coupe pas une lecture).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || reloading) return;
    const { station } = await import('../sportident/station.js');
    if (station.connected && !station.simulated) {
      const { toast } = await import('../core/bus.js');
      toast("Nouvelle version de CO - P3OPS installée : elle s'affichera à la prochaine ouverture.", 'info', { duration: 10000 });
      return;
    }
    reloading = true;
    location.reload();
  });
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => reg.update())
      .catch(() => {});
  });
}

// Garde l'écran allumé pendant la lecture des doigts (si le téléphone l'accepte).
let wakeLock = null;
async function keepAwake() {
  try {
    if (document.visibilityState === 'visible' && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}
document.addEventListener('visibilitychange', keepAwake);
addEventListener('click', keepAwake, { once: true });
