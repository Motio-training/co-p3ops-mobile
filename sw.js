// CO - P3OPS Mobile : fonctionnement hors connexion. Tous les fichiers de l'application sont gardés
// dans le téléphone à la première ouverture ; ensuite l'appli s'ouvre même sans réseau.
// (Fichier généré par mobile/construire-mobile.py : la liste et la version sont remplies à la construction.)
const VERSION = "co-p3ops-mobile-20261125-3019550945";
const FILES = [
 "./",
 "css/mobile.css",
 "css/styles.css",
 "favicon.svg",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png",
 "index.html",
 "js/core/api.js",
 "js/core/bus.js",
 "js/core/prefs.js",
 "js/core/readout.js",
 "js/core/settings.js",
 "js/core/sound.js",
 "js/core/store.js",
 "js/core/time.js",
 "js/core/util.js",
 "js/domain/results.js",
 "js/domain/scoring.js",
 "js/domain/simulate.js",
 "js/domain/startlist.js",
 "js/io/csv.js",
 "js/io/entries-check.js",
 "js/io/iof.js",
 "js/io/reports.js",
 "js/lib.js",
 "js/main.js",
 "js/mobile/boot.js",
 "js/mobile/local-server.js",
 "js/mobile/usb-serial.js",
 "js/mobile/xlsx.js",
 "js/sportident/cards.js",
 "js/sportident/constants.js",
 "js/sportident/crc.js",
 "js/sportident/frames.js",
 "js/sportident/simulator.js",
 "js/sportident/station.js",
 "js/sportident/sysdata.js",
 "js/ui/components.js",
 "js/ui/hooks.js",
 "js/ui/icons.js",
 "js/ui/layout.js",
 "js/ui/pages/bareme.js",
 "js/ui/pages/classes.js",
 "js/ui/pages/competitors.js",
 "js/ui/pages/courses.js",
 "js/ui/pages/dashboard.js",
 "js/ui/pages/display.js",
 "js/ui/pages/event-form.js",
 "js/ui/pages/guide.js",
 "js/ui/pages/home.js",
 "js/ui/pages/import-check.js",
 "js/ui/pages/readout-view.js",
 "js/ui/pages/readout.js",
 "js/ui/pages/results.js",
 "js/ui/pages/settings.js",
 "js/ui/pages/starts.js",
 "js/ui/pages/stations.js",
 "js/ui/quit.js",
 "manifest.webmanifest",
 "vendor/preact-htm.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(new URL('index.html', self.registration.scope).href).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
