// Position GPS et boussole de l'appareil (téléphone, tablette). Sur un PC sans GPS, la position peut
// être approximative (Wi-Fi) ou absente : la carte reste utilisable à la main.
const state = {
  fix: null, // { lat, lon, acc, heading, speed, at }
  compass: null, // cap de l'appareil (0 = nord), lissé
  error: null,
  watching: false,
};
const listeners = new Set();
let watchId = null;
let orientationOn = false;
const ENABLED_KEY = 'p3ops.gps';

export const gps = state;

function notify() {
  for (const fn of listeners) fn(state);
}

export function onGps(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Le GPS a déjà été activé sur cet appareil (la carte a été ouverte) : on peut s'en servir sans surprise. */
export function gpsWasEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function startGps() {
  startCompass();
  if (state.watching || !('geolocation' in navigator)) {
    if (!('geolocation' in navigator)) {
      state.error = "Cet appareil ne donne pas sa position.";
      notify();
    }
    return;
  }
  state.watching = true;
  try {
    localStorage.setItem(ENABLED_KEY, '1');
  } catch {}
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const c = p.coords;
      state.fix = {
        lat: c.latitude,
        lon: c.longitude,
        acc: c.accuracy,
        heading: c.heading != null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 0.7 ? c.heading : null,
        speed: c.speed,
        at: p.timestamp || Date.now(),
      };
      state.error = null;
      notify();
    },
    (e) => {
      state.error =
        e.code === 1
          ? "Position refusée : autorisez la localisation pour CO - P3OPS dans les réglages de l'appareil."
          : e.code === 3
            ? 'Recherche du signal GPS…'
            : 'Position indisponible (GPS désactivé ?).';
      notify();
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
  );
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  state.watching = false;
  stopCompass();
}

/**
 * Position actuelle assez récente et précise (pour situer un poste que l'on contrôle).
 * Attend jusqu'à `wait` ms une position plus précise que `maxAcc` mètres.
 */
export function currentFix({ maxAcc = 40, maxAge = 20000, wait = 12000 } = {}) {
  const good = () => state.fix && state.fix.acc <= maxAcc && Date.now() - state.fix.at <= maxAge;
  if (good()) return Promise.resolve(state.fix);
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  startGps();
  return new Promise((resolve) => {
    const off = onGps(() => {
      if (good()) {
        off();
        clearTimeout(t);
        resolve(state.fix);
      }
    });
    const t = setTimeout(() => {
      off();
      resolve(null);
    }, wait);
  });
}

// --- Boussole -------------------------------------------------------------------------------------
function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}

function onOrientation(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading; // iPhone / iPad
  else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + screenAngle() + 360) % 360;
  if (state.compass == null) state.compass = h;
  else {
    // lissage (en tenant compte du passage 359° → 0°)
    let d = h - state.compass;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    state.compass = (state.compass + d * 0.25 + 360) % 360;
  }
  notify();
}

function startCompass() {
  if (orientationOn) return;
  orientationOn = true;
  // iPhone / iPad : la boussole demande une autorisation (appel fait depuis un bouton)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().catch(() => {});
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  else window.addEventListener('deviceorientation', onOrientation);
}

function stopCompass() {
  if (!orientationOn) return;
  orientationOn = false;
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  state.compass = null;
}

/** Cap pour le mode « sens de marche » : boussole, sinon direction du déplacement GPS. */
export function currentHeading() {
  if (state.compass != null) return state.compass;
  return state.fix?.heading ?? null;
}
