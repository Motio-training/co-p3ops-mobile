// Démarrage de CO - P3OPS Mobile : chargé AVANT js/main.js (même interface que sur PC).
//  1. pilote USB du lecteur SportIdent (Android, câble OTG) ;
//  2. « serveur » local : les données restent dans le téléphone ;
//  3. fonctionnement hors connexion (le jour de la course, en forêt).
import './usb-serial.js';
import './local-server.js';

document.documentElement.classList.add('mobile-app');

// (Dans l'application Android, les fichiers sont déjà dans l'APK : pas de mise en cache.)
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.__P3OPS_APK) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
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
