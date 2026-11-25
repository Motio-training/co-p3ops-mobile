// Génère des courses fictives pour essayer la lecture sans matériel.
import { getDerived, store } from '../core/store.js';
import { nowClock } from '../core/time.js';
import { cardTypeFromNumber } from '../sportident/cards.js';

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function unknownNumber() {
  const used = new Set([...store.competitors.values()].map((c) => Number(c.card)));
  for (;;) {
    const n = Math.random() < 0.5 ? rand(8000000, 8999999) : rand(7000000, 7999999);
    if (!used.has(n)) return n;
  }
}

/**
 * Crée le contenu d'une puce. kind : auto | ok | mp | unknown
 * Renvoie { number, type, check, start, finish, punches } (heures sur 24 h).
 */
export function simulatedCard(kind = 'auto') {
  const d = getDerived();
  const candidates = [...store.competitors.values()].filter(
    (c) => c.card && !d.readsByComp.has(c.id) && c.status !== 'DNS'
  );
  const comp = kind !== 'unknown' && candidates.length ? candidates[rand(0, candidates.length - 1)] : null;
  let course = comp ? store.courses.get(store.classes.get(comp.classId)?.courseId) : null;
  if (!course) {
    const all = [...store.courses.values()].filter((c) => c.controls?.length);
    course = all.length ? all[rand(0, all.length - 1)] : null;
  }
  const controls = course?.controls?.length ? course.controls : [31, 32, 33, 34, 35, 36];
  const mp = kind === 'mp' || (kind === 'auto' && Math.random() < 0.12);
  const skip = mp ? rand(0, controls.length - 1) : -1;

  const legs = controls.map(() => rand(70, 420));
  const finishLeg = rand(15, 50);
  const total = legs.reduce((a, b) => a + b, 0) + finishLeg;
  const useList = store.event?.startMode === 'list' && comp?.startTime != null;
  const start = useList ? comp.startTime : nowClock() - total;

  const punches = [];
  let t = start;
  controls.forEach((code, i) => {
    t += legs[i];
    if (i !== skip) punches.push({ code, time: t });
  });
  if (Math.random() < 0.15) punches.splice(rand(0, punches.length), 0, { code: rand(31, 99), time: t - rand(10, 60) });
  const number = comp ? Number(comp.card) : unknownNumber();
  return {
    number,
    type: cardTypeFromNumber(number),
    check: start - rand(120, 900),
    start,
    finish: t + finishLeg,
    clear: null,
    punches,
  };
}
