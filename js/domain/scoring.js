// Notation /20 des courses au score militaires (barème « CM1 Course d'Orientation Militaire »).
//
//  - Note de temps : 20 en moins de 30 min, puis -1 point toutes les 3 min (10 en moins de 60 min).
//  - Au-delà du dernier seuil (1 h) : -1 point par minute entamée (comme SportSoftware : 1 h 00 min 35 → -1).
//  - 1re balise imposée non respectée : -3 points.
//  - Chaque balise manquante : -5 points.
//  Toutes les pénalités s'appliquent sur la note finale, bornée entre 0 et 20.

export const DEFAULT_SCORING = {
  steps: [
    [30, 20],
    [33, 19],
    [36, 18],
    [39, 17],
    [42, 16],
    [45, 15],
    [48, 14],
    [51, 13],
    [54, 12],
    [57, 11],
    [60, 10],
  ],
  overtimePerMinute: 1,
  overtimeRounding: 'started', // 'started' : par minute entamée · 'full' : par minute écoulée
  firstPenalty: 3,
  missingPenalty: 5,
  minNote: 0,
  maxNote: 20,
};

export function scoringOf(event) {
  const cfg = { ...DEFAULT_SCORING, ...(event?.scoring || {}) };
  cfg.steps = [...(cfg.steps?.length ? cfg.steps : DEFAULT_SCORING.steps)]
    .map(([m, n]) => [Number(m), Number(n)])
    .filter(([m, n]) => Number.isFinite(m) && Number.isFinite(n))
    .sort((a, b) => a[0] - b[0]);
  return cfg;
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/**
 * time : durée de course en secondes · missing : nombre de balises manquantes
 * firstOk : true / false / null (pas de 1re balise imposée)
 * Renvoie { base, penalties: [{label, points}], raw, note } ou null si le temps est inconnu.
 */
export function computeNote({ time, missing = 0, firstOk = null }, cfg = DEFAULT_SCORING) {
  if (time == null || !Number.isFinite(time) || time < 0) return null;
  const steps = cfg.steps;
  const penalties = [];
  let base;
  const step = steps.find(([limit]) => time < limit * 60);
  if (step) {
    base = step[1];
  } else {
    const [limit, note] = steps[steps.length - 1];
    const over = time - limit * 60;
    // Minute entamée : 1 h 00 min 00 s → 0 · 1 h 00 min 01 s → 1 · 1 h 01 min 00 s → 1 · 1 h 01 min 38 s → 2
    const minutes = cfg.overtimeRounding === 'started' ? Math.ceil(over / 60) : Math.floor(over / 60);
    base = note;
    if (minutes > 0 && cfg.overtimePerMinute) {
      penalties.push({ label: `Temps au-delà de ${limit} min : ${plural(minutes, 'minute', 'minutes')}`, points: minutes * cfg.overtimePerMinute });
    }
  }
  if (firstOk === false && cfg.firstPenalty) penalties.push({ label: '1re balise imposée non respectée', points: cfg.firstPenalty });
  if (missing > 0 && cfg.missingPenalty) {
    penalties.push({ label: plural(missing, 'balise manquante', 'balises manquantes'), points: missing * cfg.missingPenalty });
  }
  const raw = base - penalties.reduce((sum, p) => sum + p.points, 0);
  return { base, penalties, raw, note: Math.max(cfg.minNote, Math.min(cfg.maxNote, raw)) };
}
