// Plan des postes : fond de carte IGN, position GPS, orientation (nord, sens de marche, libre),
// placement des postes. Un poste contrôlé sur place est situé avec le GPS (onglet « Réglages des boîtiers »).
import { html, useEffect, useReducer, useRef, useState } from '../../lib.js';
import { confirmDialog, toast } from '../../core/bus.js';
import { addBalises, setBalisePosition } from '../../core/settings.js';
import { TILE, bearingTo, distance, fmtDistance, metersPerPixel, project, rotate, unproject } from '../../map/geo.js';
import { LAYERS, cachedCount, downloadArea, getTile, onTiles, peekTile, tilesInArea } from '../../map/tiles.js';
import { currentHeading, gps, onGps, startGps, stopGps } from '../../map/gps.js';
import { fmtDuration as fmtWalk, planTour } from '../../map/route.js';
import { saveTerrain } from '../../map/terrain.js';
import { Button, Card, Icon } from '../components.js';
import { useSettings } from '../hooks.js';

const VIEW_KEY = 'p3ops.carte';
const MODES = [
  { value: 'nord', label: 'Nord en haut' },
  { value: 'marche', label: 'Sens de marche' },
  { value: 'libre', label: 'Libre' },
];
const MIN_Z = 3;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(p));
  } catch {}
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm360 = (a) => ((a % 360) + 360) % 360;
const fmtWhen = (at) => (at ? new Date(at).toLocaleDateString('fr-FR') : '');

/** Vue de départ : la dernière vue, sinon les postes déjà placés, sinon la France. */
function initialView(balises) {
  const p = loadPrefs();
  if (p.view) return { ...p.view, bearing: p.mode === 'libre' ? p.view.bearing || 0 : 0 };
  const placed = balises.filter((b) => b.pos);
  if (placed.length) {
    const lat = placed.reduce((s, b) => s + b.pos.lat, 0) / placed.length;
    const lon = placed.reduce((s, b) => s + b.pos.lon, 0) / placed.length;
    return { lat, lon, z: 15, bearing: 0 };
  }
  return { lat: 46.6, lon: 2.4, z: 6, bearing: 0 };
}

export function PlanTab() {
  const st = useSettings();
  const balises = st.balises;
  const prefs = loadPrefs();
  const wrapRef = useRef();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState(() => initialView(balises));
  const viewRef = useRef(view);
  const [mode, setModeState] = useState(prefs.mode || 'nord');
  const [follow, setFollow] = useState(prefs.follow !== false);
  const [layer, setLayer] = useState(LAYERS[prefs.layer] ? prefs.layer : 'plan');
  const [selected, setSelected] = useState(null);
  const [multi, setMulti] = useState(false); // itinéraire par plusieurs postes
  const [picks, setPicks] = useState([]); // postes choisis pour l'itinéraire (dans n'importe quel ordre)
  const [back, setBack] = useState(false); // revenir au point de départ
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(null); // calcul en cours
  const [chain, setChain] = useState(false); // mode « Placer / déplacer les postes »
  const [drag, setDrag] = useState(null); // poste déplacé au doigt : { code, lat, lon }
  const [newCode, setNewCode] = useState('');
  const routeReq = useRef(0);
  const multiRef = useRef(multi);
  const chainRef = useRef(chain);
  const chainDone = useRef(new Set());
  multiRef.current = multi;
  chainRef.current = chain;
  const [placing, setPlacing] = useState(null);
  const [dl, setDl] = useState(null); // enregistrement hors ligne en cours
  const [cached, setCached] = useState(null);
  const [, redraw] = useReducer((n) => n + 1, 0);
  const modeRef = useRef(mode);
  const followRef = useRef(follow);
  const placingRef = useRef(placing);
  modeRef.current = mode;
  followRef.current = follow;
  placingRef.current = placing;

  const setView = (v) => {
    viewRef.current = v;
    setViewState(v);
  };
  const setMode = (m) => {
    setModeState(m);
    if (m === 'nord') setView({ ...viewRef.current, bearing: 0 });
  };

  // Préférences gardées (vue, fond, orientation)
  useEffect(() => {
    const t = setTimeout(() => savePrefs({ view, mode, follow, layer }), 400);
    return () => clearTimeout(t);
  }, [view, mode, follow, layer]);

  // Taille de la carte
  useEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // GPS, boussole, tuiles
  useEffect(() => {
    startGps();
    const offTiles = onTiles(redraw);
    let first = true;
    const offGps = onGps((g) => {
      let v = viewRef.current;
      if (followRef.current && g.fix) {
        v = { ...v, lat: g.fix.lat, lon: g.fix.lon, z: first && v.z < 14 ? 16 : v.z };
        first = false;
      }
      if (modeRef.current === 'marche') {
        const h = currentHeading();
        if (h != null) v = { ...v, bearing: h };
      }
      if (v !== viewRef.current) setView(v);
      else redraw();
    });
    cachedCount().then(setCached);
    return () => {
      offTiles();
      offGps();
      stopGps();
    };
  }, []);

  // --- Conversions écran ↔ carte ------------------------------------------------------------------
  const W = size.w;
  const H = size.h;
  const v = view;
  const center = project(v.lat, v.lon, v.z);
  const toScreen = (lat, lon) => {
    const p = project(lat, lon, v.z);
    return { x: p.x - center.x, y: p.y - center.y }; // repère tourné (dans le « rotor »)
  };
  const screenToLatLon = (sx, sy, vw = viewRef.current) => {
    const c = project(vw.lat, vw.lon, vw.z);
    const d = rotate(sx - W / 2, sy - H / 2, vw.bearing);
    return unproject(c.x + d.x, c.y + d.y, vw.z);
  };

  // --- Gestes : glisser, pincer (zoom), tourner à deux doigts, molette, toucher ---------------------
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const maxZ = LAYERS[layer].maxZoom + 1; // un niveau d'agrandissement au-delà des tuiles

  /** Garde le point du monde `world` (au zoom vw.z) sous le point écran (sx, sy) après changement de vue. */
  const keepUnder = (world, wz, sx, sy, z, bearing) => {
    const k = 2 ** (z - wz);
    const d = rotate(sx - W / 2, sy - H / 2, bearing);
    const c = unproject(world.x * k - d.x, world.y * k - d.y, z);
    return { lat: c.lat, lon: c.lon, z, bearing };
  };

  const onPointerDown = (e) => {
    if (e.target.closest('.map-ctl')) return;
    try {
      wrapRef.current.setPointerCapture(e.pointerId);
    } catch {}
    const r = wrapRef.current.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    startGesture();
    if (pointers.current.size === 1) {
      gesture.current.tap = { x: e.clientX, y: e.clientY, t: Date.now() };
      // Mode placement : appuyer sur un poste puis glisser le déplace
      gesture.current.drag = chainRef.current ? hitPoste(e.clientX - r.left, e.clientY - r.top) : null;
    } else gesture.current.drag = null;
  };

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const vw = viewRef.current;
    const c = project(vw.lat, vw.lon, vw.z);
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const d = rotate(mid.x - W / 2, mid.y - H / 2, vw.bearing);
    gesture.current = {
      ...(gesture.current || {}),
      view: vw,
      world: { x: c.x + d.x, y: c.y + d.y },
      dist: pts.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : null,
      angle: pts.length > 1 ? (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI : null,
    };
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const r = wrapRef.current.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    const g = gesture.current;
    if (!g) return;
    if (g.tap && Math.hypot(e.clientX - g.tap.x, e.clientY - g.tap.y) > 8) g.tap = null;
    if (g.tap) return;
    if (g.drag != null && pointers.current.size === 1) {
      const q = pointers.current.get(e.pointerId);
      setDrag({ code: g.drag, ...screenToLatLon(q.x, q.y) });
      return;
    }
    const pts = [...pointers.current.values()];
    const vw = g.view;
    let z = vw.z;
    let bearing = vw.bearing;
    let mid = pts[0];
    if (pts.length > 1 && g.dist) {
      mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      z = clamp(vw.z + Math.log2(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) / g.dist), MIN_Z, maxZ);
      const angle = (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI;
      let da = angle - g.angle;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      if (modeRef.current === 'libre') bearing = norm360(vw.bearing - da);
      else if (modeRef.current === 'nord' && Math.abs(da) > 25) {
        setModeState('libre'); // rotation volontaire à deux doigts : orientation libre
        modeRef.current = 'libre';
      }
    }
    if (modeRef.current === 'marche') bearing = viewRef.current.bearing;
    if (followRef.current) setFollow(false);
    setView(keepUnder(g.world, vw.z, mid.x, mid.y, z, bearing));
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    const wasTap = g?.tap && pointers.current.size === 1 && Date.now() - g.tap.t < 500;
    if (g?.drag != null && !wasTap && drag && drag.code === g.drag) {
      const code = g.drag;
      setBalisePosition(code, { lat: drag.lat, lon: drag.lon, acc: null, source: 'manuel' })
        .then(() => toast(`Poste ${code} déplacé.`, 'success'))
        .catch((err) => toast(err.message, 'error'))
        .finally(() => setDrag(null));
      setSelected(code);
      if (placingRef.current === code) setPlacing(null);
    }
    pointers.current.delete(e.pointerId);
    if (wasTap) {
      const r = wrapRef.current.getBoundingClientRect();
      onTap(e.clientX - r.left, e.clientY - r.top);
    }
    if (pointers.current.size) startGesture();
    else gesture.current = null;
    if (gesture.current) gesture.current.tap = null;
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const vw = viewRef.current;
    const c = project(vw.lat, vw.lon, vw.z);
    const d = rotate(sx - W / 2, sy - H / 2, vw.bearing);
    const z = clamp(vw.z - Math.sign(e.deltaY) * 0.5, MIN_Z, maxZ);
    setView(keepUnder({ x: c.x + d.x, y: c.y + d.y }, vw.z, sx, sy, z, vw.bearing));
  };

  useEffect(() => {
    const el = wrapRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onTap = (sx, sy) => {
    const code = placingRef.current;
    if (code != null) {
      const p = screenToLatLon(sx, sy);
      setBalisePosition(code, { ...p, acc: null, source: 'manuel' }).catch((err) => toast(err.message, 'error'));
      if (chainRef.current) {
        chainDone.current.add(code);
        const next = nextUnplaced(code);
        if (next != null) {
          setPlacing(next);
          setSelected(next);
          toast(`Poste ${code} placé. Touchez maintenant l'emplacement du poste ${next}.`, 'success');
        } else {
          setPlacing(null);
          setSelected(code);
          toast(`Poste ${code} placé. Touchez un poste pour le déplacer, ou « Terminer ».`, 'success');
        }
      } else {
        setPlacing(null);
        setSelected(code);
        toast(`Poste ${code} placé sur la carte. Il sera précisé au GPS lors de son contrôle sur place.`, 'success');
      }
      return;
    }
    const hit = hitPoste(sx, sy);
    if (chainRef.current) {
      // Mode placement : toucher un poste déjà placé pour le déplacer
      if (hit != null) {
        setPlacing(hit);
        setSelected(hit);
      }
      return;
    }
    if (multiRef.current) {
      if (hit != null) togglePick(hit);
      return;
    }
    setSelected(hit);
  };

  /** Poste sous le doigt (à 26 px près), ou null. */
  const hitPoste = (sx, sy) => {
    let best = null;
    for (const b of balises) {
      if (!b.pos) continue;
      const p = toScreen(b.pos.lat, b.pos.lon);
      const q = rotate(p.x, p.y, -viewRef.current.bearing);
      const dd = Math.hypot(q.x + W / 2 - sx, q.y + H / 2 - sy);
      if (dd < 26 && (!best || dd < best.d)) best = { code: b.code, d: dd };
    }
    return best ? best.code : null;
  };

  /** Poste suivant à placer (numéro croissant, sans position), après `code`. */
  const nextUnplaced = (code) => {
    const todo = balises.filter((b) => !b.pos && b.code !== code && !chainDone.current.has(b.code)).map((b) => b.code);
    return todo.find((c) => c > code) ?? todo[0] ?? null;
  };
  const startChain = (code = null) => {
    chainDone.current = new Set();
    const first = code ?? balises.find((b) => !b.pos)?.code ?? null;
    setMulti(false);
    setChain(true);
    setPlacing(first);
    if (first != null) setSelected(first);
  };
  const stopChain = () => {
    setChain(false);
    setPlacing(null);
    setDrag(null);
  };
  const addPoste = async () => {
    const code = Number(newCode);
    if (!Number.isInteger(code) || code < 1 || code > 1023) return toast('Numéro de poste entre 1 et 1023.', 'warning');
    try {
      await addBalises([code]);
      setNewCode('');
      startChain(code);
      toast(`Touchez la carte à l'emplacement du poste ${code}.`, 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const togglePick = (code) => {
    const b = balises.find((x) => x.code === code);
    if (!b?.pos) return toast(`Le poste ${code} n'est pas encore placé sur la carte.`, 'warning');
    setPicks((l) => (l.includes(code) ? l.filter((c) => c !== code) : [...l, code]));
  };

  // --- Itinéraire à pied -------------------------------------------------------------------------------
  // Départ : position GPS (sinon centre de la carte, pour préparer l'itinéraire au bureau)
  const startPoint = () =>
    gps.fix ? { lat: gps.fix.lat, lon: gps.fix.lon, gps: true } : { lat: viewRef.current.lat, lon: viewRef.current.lon, gps: false };
  const targets = (multi ? picks : selected != null ? [selected] : [])
    .map((c) => balises.find((b) => b.code === c))
    .filter((b) => b?.pos);
  const targetKey = targets.map((b) => `${b.code}:${b.pos.lat.toFixed(5)},${b.pos.lon.toFixed(5)}`).join('|') + (multi && back ? '|retour' : '');
  const computeRoute = async () => {
    const id = ++routeReq.current;
    if (!targets.length) {
      setRoute(null);
      setRouting(null);
      return;
    }
    const from = startPoint();
    const pts = targets.map((b) => ({ code: b.code, lat: b.pos.lat, lon: b.pos.lon }));
    setRouting({ step: 'calcul', done: 0, total: 1 });
    try {
      const r = await planTour(from, pts, {
        back: multi && back,
        onProgress: (step, done, total) => id === routeReq.current && setRouting({ step, done, total }),
      });
      if (id === routeReq.current) setRoute({ ...r, from, key: targetKey });
    } catch (e) {
      if (id === routeReq.current) toast(`Itinéraire impossible : ${e.message}`, 'error');
    } finally {
      if (id === routeReq.current) setRouting(null);
    }
  };
  const computeRef = useRef(computeRoute);
  computeRef.current = computeRoute;
  useEffect(() => {
    const tm = setTimeout(() => computeRef.current(), multi ? 700 : 0);
    return () => clearTimeout(tm);
  }, [targetKey, multi]);
  // En marchant : l'itinéraire repart de la position actuelle (tous les 50 m environ)
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const iv = setInterval(() => {
      const r = routeRef.current;
      if (!r || !gps.fix) return;
      if (!r.from.gps || distance(r.from, gps.fix) > 50) computeRef.current();
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  const zoomBy = (dz) => setView({ ...viewRef.current, z: clamp(Math.round(viewRef.current.z + dz), MIN_Z, maxZ) });
  const locate = () => {
    startGps();
    setFollow(true);
    if (gps.fix) setView({ ...viewRef.current, lat: gps.fix.lat, lon: gps.fix.lon, z: Math.max(viewRef.current.z, 16) });
    else toast(gps.error || 'Recherche de la position…', 'info');
  };
  const cycleMode = () => setMode(mode === 'nord' ? 'marche' : mode === 'marche' ? 'libre' : 'nord');
  const fullscreen = () => {
    const el = wrapRef.current.closest('.plan');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el?.requestFullscreen?.().catch(() => {});
  };

  // --- Tuiles visibles ----------------------------------------------------------------------------------
  const L = LAYERS[layer];
  const tz = clamp(Math.round(v.z), MIN_Z, L.maxZoom);
  const scale = 2 ** (v.z - tz);
  const tc = project(v.lat, v.lon, tz);
  const radius = Math.hypot(W, H) / 2 / scale;
  const n = 2 ** tz;
  const tiles = [];
  if (W && H) {
    for (let ty = Math.floor((tc.y - radius) / TILE); ty <= Math.floor((tc.y + radius) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor((tc.x - radius) / TILE); tx <= Math.floor((tc.x + radius) / TILE); tx++) {
        const x = ((tx % n) + n) % n;
        const left = (tx * TILE - tc.x) * scale;
        const top = (ty * TILE - tc.y) * scale;
        const sz = TILE * scale + 0.6;
        const t = getTile(layer, tz, x, ty);
        if (t.state === 'ok') {
          tiles.push(html`<img key=${`${tz}/${x}/${ty}`} class="map-tile" src=${t.url} style=${`left:${left}px;top:${top}px;width:${sz}px;height:${sz}px`} alt="" draggable="false" />`);
          continue;
        }
        // Tuile absente (chargement, ou hors ligne) : la tuile d'un niveau moins détaillé, agrandie
        for (let k = 1; k <= 5 && tz - k >= 0; k++) {
          const f = 2 ** k;
          const px = Math.floor(x / f);
          const py = Math.floor(ty / f);
          const parent = t.state === 'error' ? getTile(layer, tz - k, px, py) : peekTile(layer, tz - k, px, py);
          if (parent?.state === 'ok') {
            const big = sz * f;
            tiles.push(html`<div key=${`p${tz}/${x}/${ty}`} class="map-tile map-tile-parent" style=${`left:${left}px;top:${top}px;width:${sz}px;height:${sz}px`}>
              <img src=${parent.url} alt="" draggable="false" style=${`width:${big}px;height:${big}px;left:${-(x % f) * TILE * scale}px;top:${-(ty % f) * TILE * scale}px`} />
            </div>`);
            break;
          }
          if (parent?.state !== 'error' && t.state !== 'error') break;
        }
      }
    }
  }

  // --- Postes et position ----------------------------------------------------------------------------
  const fix = gps.fix;
  const heading = currentHeading();
  const mpp = metersPerPixel(v.lat, v.z);
  const sel = balises.find((b) => b.code === selected);
  const markers = balises
    .filter((b) => b.pos)
    .map((b) => {
      const at = drag && drag.code === b.code ? drag : b.pos;
      const p = toScreen(at.lat, at.lon);
      const rank = multi && route ? route.order.findIndex((o) => o.code === b.code) : -1;
      const picked = multi ? picks.includes(b.code) : b.code === selected;
      return html`<div key=${b.code} class=${'map-poste' + (b.pos.source === 'gps' ? ' gps' : ' manuel') + (picked ? ' sel' : '')} style=${`left:${p.x}px;top:${p.y}px`}>
        <div class="map-poste-in" style=${`transform:rotate(${v.bearing}deg)`}><span>${b.code}</span>${rank >= 0 && html`<b class="map-order">${rank + 1}</b>`}</div>
      </div>`;
    });
  let me = null;
  if (fix) {
    const p = toScreen(fix.lat, fix.lon);
    const r = Math.max(8, fix.acc / mpp);
    me = html`<div class="map-me" style=${`left:${p.x}px;top:${p.y}px`}>
      <div class="map-me-acc" style=${`width:${2 * r}px;height:${2 * r}px`}></div>
      ${heading != null && html`<div class="map-me-dir" style=${`transform:rotate(${heading}deg)`}></div>`}
      <div class="map-me-dot"></div>
    </div>`;
  }
  // Tracé de l'itinéraire (trait plein : chemins ; pointillés : hors chemin)
  let line = null;
  if (route && route.key === targetKey) {
    const segs = route.legs.flatMap((l) => l.legs.map((s) => ({ pts: s.coords.map((q) => toScreen(q.lat, q.lon)), off: s.offTrail })));
    const all = segs.flatMap((s) => s.pts);
    if (all.length) {
      const minX = Math.min(...all.map((q) => q.x)) - 8;
      const minY = Math.min(...all.map((q) => q.y)) - 8;
      const w = Math.max(...all.map((q) => q.x)) - minX + 8;
      const h = Math.max(...all.map((q) => q.y)) - minY + 8;
      const pts = (s) => s.pts.map((q) => `${(q.x - minX).toFixed(1)},${(q.y - minY).toFixed(1)}`).join(' ');
      line = html`<svg class="map-route" style=${`left:${minX}px;top:${minY}px`} width=${w} height=${h}>
        ${segs.map((s) => html`<polyline class="casing" points=${pts(s)} />`)}
        ${segs.map((s) => html`<polyline class=${s.off ? 'off' : 'on'} points=${pts(s)} />`)}
      </svg>`;
    }
  }

  // Échelle : longueur « ronde » d'environ 90 px
  const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
  const scaleM = nice.find((m) => m / mpp >= 70) || nice[nice.length - 1];

  // --- Hors ligne --------------------------------------------------------------------------------------
  const visibleBounds = () => {
    const pts = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ].map(([x, y]) => screenToLatLon(x, y, v));
    return {
      north: Math.max(...pts.map((p) => p.lat)),
      south: Math.min(...pts.map((p) => p.lat)),
      west: Math.min(...pts.map((p) => p.lon)),
      east: Math.max(...pts.map((p) => p.lon)),
    };
  };
  const saveArea = async () => {
    const zMin = clamp(Math.floor(v.z) - 3, 8, 17);
    let zMax = 17;
    let list = tilesInArea(visibleBounds(), zMin, zMax);
    while (list.length > 3000 && zMax > zMin) list = tilesInArea(visibleBounds(), zMin, --zMax);
    const ok = await confirmDialog({
      title: 'Enregistrer la zone pour le hors ligne',
      message: `${list.length} morceaux de carte (${L.label}, environ ${Math.max(1, Math.round((list.length * (layer === 'plan' ? 35 : 25)) / 1000))} Mo) et le terrain (végétation, eau, chemins, pour les itinéraires) seront enregistrés dans l'appareil, pour la zone affichée et jusqu'au niveau de détail ${zMax}. À faire avec une connexion (Wi-Fi de préférence).`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    const ctrl = new AbortController();
    setDl({ done: 0, total: list.length, errors: 0, ctrl });
    const r = await downloadArea(layer, list, (done, total, errors) => setDl({ done, total, errors, ctrl }), ctrl.signal);
    // Terrain (végétation, eau, chemins…) pour calculer les itinéraires sans réseau
    if (!ctrl.signal.aborted) {
      const tr = await saveTerrain(visibleBounds(), (done, total) => setDl({ done, total, errors: 0, ctrl, terrain: true }), ctrl.signal);
      r.errors += tr.errors;
    }
    setDl(null);
    cachedCount().then(setCached);
    toast(
      r.errors ? `Zone enregistrée, sauf ${r.errors} morceau${r.errors > 1 ? 'x' : ''} (réseau ?).` : 'Zone enregistrée : la carte est disponible sans réseau.',
      r.errors ? 'warning' : 'success'
    );
  };

  // --- Poste choisi ------------------------------------------------------------------------------------------
  const placeHere = (code) => {
    if (!fix) return toast(gps.error || 'Position GPS pas encore disponible.', 'warning');
    setBalisePosition(code, { lat: fix.lat, lon: fix.lon, acc: Math.round(fix.acc), source: 'gps' })
      .then(() => toast(`Poste ${code} placé à votre position (±${Math.round(fix.acc)} m).`, 'success'))
      .catch((err) => toast(err.message, 'error'));
  };
  const centerOn = (b) => {
    setFollow(false);
    setView({ ...viewRef.current, lat: b.pos.lat, lon: b.pos.lon, z: Math.max(viewRef.current.z, 16) });
  };
  const removePos = async (code) => {
    const ok = await confirmDialog({ title: `Retirer le poste ${code} de la carte`, message: 'Sa position sera effacée (le poste reste dans la liste des balises).', confirmLabel: 'Retirer', danger: true });
    if (ok) setBalisePosition(code, null).catch((err) => toast(err.message, 'error'));
  };

  const placedCount = balises.filter((b) => b.pos).length;
  const modeLabel = MODES.find((m) => m.value === mode).label;

  return html`<div class="plan">
    <div class=${'map-wrap' + (placing != null ? ' placing' : '')} ref=${wrapRef}
      onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${onPointerUp}>
      <div class="map-rotor" style=${`left:${W / 2}px;top:${H / 2}px;transform:rotate(${-v.bearing}deg)`}>
        <div class="map-tilelayer">${tiles}</div>
        ${line}
        ${markers}
        ${me}
      </div>

      ${chain && placing == null && html`<div class="map-banner map-ctl">
        <span>Touchez un poste pour le déplacer, ou faites-le glisser</span>
        <button type="button" class="map-btn-text" onClick=${stopChain}>Terminer</button>
      </div>`}
      ${placing != null && html`<div class="map-banner map-ctl">
        <span>Touchez la carte à l'emplacement du poste <b>${placing}</b></span>
        ${chain && html`<button type="button" class="map-btn-text" onClick=${() => {
          chainDone.current.add(placing);
          const next = nextUnplaced(placing);
          if (next == null) {
            setPlacing(null);
            setChain(false);
          } else {
            setPlacing(next);
            setSelected(next);
          }
        }}>Passer</button>`}
        <button type="button" class="map-btn-text" onClick=${() => (chain ? stopChain() : setPlacing(null))}>${chain ? 'Terminer' : 'Annuler'}</button>
      </div>`}

      <div class="map-ctl map-ctl-tl">
        <button type="button" class="map-btn" title="Fond de carte" onClick=${() => setLayer(layer === 'plan' ? 'photo' : 'plan')}><${Icon} name="layers" /></button>
        <button type="button" class="map-btn" title="Plein écran" onClick=${fullscreen}><${Icon} name="maximize" /></button>
      </div>
      <div class="map-ctl map-ctl-tr">
        <button type="button" class=${'map-btn map-compass' + (mode !== 'nord' ? ' on' : '')} title=${`Orientation : ${modeLabel} (toucher pour changer)`} onClick=${cycleMode}>
          <svg viewBox="0 0 24 24" width="28" height="28" style=${`transform:rotate(${-v.bearing}deg)`}><path d="M12 2 16 12H8z" fill="#d32f2f" /><path d="M12 22 8 12h8z" fill="#9aa3ae" /></svg>
        </button>
        <span class="map-mode">${modeLabel}</span>
      </div>
      <div class="map-ctl map-ctl-r">
        <button type="button" class="map-btn" title="Zoomer" onClick=${() => zoomBy(1)}><${Icon} name="plus" /></button>
        <button type="button" class="map-btn" title="Dézoomer" onClick=${() => zoomBy(-1)}><${Icon} name="minus" /></button>
        <button type="button" class=${'map-btn' + (follow ? ' on' : '')} title="Me suivre (position GPS au centre)" onClick=${locate}><${Icon} name="crosshair" /></button>
      </div>
      <div class="map-ctl map-ctl-bl">
        <div class="map-scale"><span style=${`width:${scaleM / mpp}px`}></span>${fmtDistance(scaleM)}</div>
        <div class="map-gps">${fix ? `GPS ±${Math.round(fix.acc)} m` : gps.error || 'Recherche GPS…'}</div>
      </div>
      <div class="map-attrib">${L.attribution}</div>
      ${dl &&
      html`<div class="map-banner map-ctl">
        <span>${dl.terrain ? 'Enregistrement du terrain' : 'Enregistrement de la carte'} : ${dl.done} / ${dl.total}</span>
        <button type="button" class="map-btn-text" onClick=${() => dl.ctrl.abort()}>Arrêter</button>
      </div>`}
    </div>

    <div class="plan-bar">
      <div class="segmented" role="tablist">
        ${MODES.map(
          (m) => html`<button type="button" role="tab" aria-selected=${m.value === mode} class=${m.value === mode ? 'active' : ''} onClick=${() => setMode(m.value)}>${m.label}</button>`
        )}
      </div>
      <${Button} small icon="download" onClick=${saveArea} disabled=${!!dl || !W}>Enregistrer la zone (hors ligne)</${Button}>
      ${cached != null && html`<span class="muted small">${cached} morceaux de carte gardés dans l'appareil</span>`}
    </div>

    ${(route || routing) &&
    html`<div class="route-sum mt">
      ${routing && !route
        ? html`<span>${routing.step === 'terrain' ? `Téléchargement du terrain de la zone… ${routing.done} / ${routing.total}` : `Calcul de l'itinéraire…${routing.total > 1 ? ` ${routing.done} / ${routing.total}` : ''}`}</span>`
        : html`<div>
              <div class="route-total"><${Icon} name="route" /> <strong>${fmtDistance(route.distance)}</strong> · <strong>${fmtWalk(route.duration)}</strong> à pied${routing ? ' · mise à jour…' : ''}</div>
              <div class="route-order">
                ${route.from.gps ? 'Vous' : 'Centre de la carte'}${route.order.map((o) => html` → <b>${o.code}</b>`)}${route.legs.length > route.order.length ? ' → départ' : ''}
              </div>
              ${route.legs.length > 1 &&
              html`<ol class="route-legs">
                ${route.legs.map((l) => html`<li>${l.to ? html`Poste <b>${l.to.code}</b>` : 'Retour au départ'} : ${fmtDistance(l.distance)}, ${fmtWalk(l.duration)}</li>`)}
              </ol>`}
              <div class="muted small">
                ${route.offline
                  ? route.reason || "Trajet à vol d'oiseau pour une partie de l'itinéraire."
                  : "Trait plein : routes et chemins ; pointillés : à travers champs ou bois. Calcul d'après la BD TOPO de l'IGN (végétation, eau, bâtiments, haies, talus) : clôtures, cultures et dénivelé ne sont pas connus."}
                ${!route.from.gps && ' Départ : centre de la carte (pas de position GPS).'}
              </div>
            </div>
            <${Button} small icon="refresh" onClick=${() => computeRef.current()} disabled=${!!routing}>Recalculer</${Button}>`}
    </div>`}

    <${Card} title=${`Postes sur la carte (${placedCount} / ${balises.length})`} class="mt"
      actions=${chain
        ? html`<${Button} small variant="primary" icon="check" onClick=${stopChain}>Terminer le placement</${Button}>`
        : html`<${Button} small icon="pin" onClick=${() => startChain()}>Placer / déplacer les postes</${Button}>`}>
      <div class="plan-modes">
        <span class="muted small">Itinéraire vers :</span>
        <div class="segmented" role="tablist">
          <button type="button" class=${!multi ? 'active' : ''} onClick=${() => setMulti(false)}>Un poste</button>
          <button type="button" class=${multi ? 'active' : ''} onClick=${() => {
            setMulti(true);
            setPlacing(null);
            setChain(false);
            if (!picks.length && sel?.pos) setPicks([sel.code]);
          }}>Plusieurs postes</button>
        </div>
        ${multi &&
        html`<label class="check"><input type="checkbox" checked=${back} onChange=${(e) => setBack(e.target.checked)} /><span>Revenir au départ</span></label>
          ${picks.length > 0 && html`<${Button} small variant="ghost" onClick=${() => setPicks([])}>Vider la sélection</${Button}>`}`}
      </div>
      <p class="muted small">
        ${multi
          ? "Touchez les postes à rejoindre (sur la carte ou ci-dessous), dans n'importe quel ordre : CO - P3OPS calcule l'ordre de passage le plus rapide et trace l'itinéraire à pied."
          : chain
            ? "Mode placement : touchez la carte pour placer le poste indiqué (les postes pas encore placés s'enchaînent). Pour déplacer un poste déjà placé, touchez-le puis touchez son nouvel emplacement, ou faites-le glisser."
            : "Touchez un poste : l'itinéraire à pied depuis votre position est tracé. « Placer / déplacer les postes » : placez-les à la main avant d'aller les contrôler ; sur place, le boîtier posé sur le lecteur, validez sa position GPS (onglet « Réglages des boîtiers »)."}
        Cercle plein : position GPS ; pointillés : placé à la main.
      </p>
      <div class="picker-grid balise-grid">
        ${balises.map((b) => {
          const on = multi ? picks.includes(b.code) : b.code === selected;
          const rank = multi && route ? route.order.findIndex((o) => o.code === b.code) : -1;
          return html`<span key=${b.code} class=${'balise-chip ' + (b.pos ? (b.pos.source === 'gps' ? 'level-ok' : 'level-warn') : 'level-unknown') + (on ? ' chip-sel' : '')}>
            <button type="button" class="balise-num" onClick=${() => {
              if (multi) return togglePick(b.code);
              if (chain) {
                setPlacing(b.code);
                setSelected(b.code);
                if (b.pos) centerOn(b);
                return;
              }
              setSelected(b.code);
              if (b.pos) centerOn(b);
            }}>${b.code}${rank >= 0 && html`<small class="chip-rank">${rank + 1}</small>`}</button>
          </span>`;
        })}
      </div>
      <div class="picker-add mt">
        <input class="input input-sm mono" value=${newCode} inputmode="numeric" placeholder="N° de poste" onInput=${(e) => setNewCode(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && addPoste()} />
        <${Button} small icon="plus" onClick=${addPoste} disabled=${!newCode.trim()}>Ajouter un poste</${Button}>
      </div>
      ${!multi && sel &&
      html`<div class="plan-sel mt">
        <div>
          <strong>Poste ${sel.code}</strong>
          ${sel.pos
            ? html`<span class="muted small"> · ${sel.pos.source === 'gps' ? `position GPS ±${sel.pos.acc ?? '?'} m` : 'placé à la main'} le ${fmtWhen(sel.pos.at)}</span>
                ${fix && html`<div class="small">À <b>${fmtDistance(distance(fix, sel.pos))}</b> de vous à vol d'oiseau, direction <b>${Math.round(bearingTo(fix, sel.pos))}°</b></div>`}`
            : html`<span class="muted small"> · pas encore placé</span>`}
        </div>
        <div class="row-actions">
          <${Button} small icon="pin" onClick=${() => setPlacing(sel.code)}>${sel.pos ? 'Déplacer sur la carte' : 'Placer sur la carte'}</${Button}>
          <${Button} small icon="crosshair" onClick=${() => placeHere(sel.code)} disabled=${!fix}>Placer à ma position</${Button}>
          ${sel.pos && html`<${Button} small icon="search" onClick=${() => centerOn(sel)}>Centrer</${Button}>`}
          ${sel.pos && html`<${Button} small variant="ghost" icon="trash" onClick=${() => removePos(sel.code)}>Retirer</${Button}>`}
        </div>
      </div>`}
    <//>
  </div>`;
}
