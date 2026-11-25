// Signaux sonores de la lecture des puces.
import { getPref } from './prefs.js';

let ctx = null;

const SEQUENCES = {
  ok: [
    [880, 0.08],
    [1320, 0.14],
  ],
  mp: [
    [330, 0.22],
    [0, 0.06],
    [330, 0.22],
  ],
  unknown: [
    [660, 0.12],
    [520, 0.18],
  ],
  error: [[220, 0.4]],
};

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

export function playSound(kind) {
  if (!getPref('sound')) return;
  const seq = SEQUENCES[kind];
  if (!seq) return;
  try {
    unlockAudio();
    let t = ctx.currentTime + 0.01;
    for (const [freq, dur] of seq) {
      if (freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
      t += dur + 0.03;
    }
  } catch {}
}
