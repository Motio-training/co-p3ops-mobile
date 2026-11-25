// Décodage (et encodage, pour le simulateur et les tests) de la mémoire des puces SportIdent.
//
// Toutes les heures sont exprimées en secondes depuis minuit.
//  - SI-Card 5 : heures sur 12 h (sans indication matin/après-midi) → h24 = false
//  - SI-Card 6 et suivantes : bit matin/après-midi présent → h24 = true
//
// Les blocs lus sont placés à leur adresse réelle dans une image mémoire
// (bloc n → octets n*128 … n*128+127), ce qui permet d'utiliser les adresses
// documentées directement.

export const TIME_NONE = 0xeeee;
const HALF_DAY = 43200;

/** Type de puce d'après son numéro (séries SportIdent). */
export function cardTypeFromNumber(n) {
  if (n < 500000) return 'SI5';
  if (n < 1000000) return 'SI6';
  if (n < 2000000) return 'SI9';
  if (n >= 2003001 && n <= 2003400) return 'SI6';
  if (n < 3000000) return 'SI8';
  if (n >= 4000000 && n < 5000000) return 'pCard';
  if (n >= 6000000 && n < 7000000) return 'tCard';
  if (n >= 7000000 && n < 8000000) return 'SI10';
  if (n >= 8000000 && n < 9000000) return 'SIAC';
  if (n >= 9000000 && n < 10000000) return 'SI11';
  if (n >= 14000000 && n < 15000000) return 'fCard';
  if (n >= 16711680) return 'SI6';
  return 'SI9';
}

/** Numéro imprimé d'une SI-Card 5 (série + numéro sur 16 bits). */
export function si5Number(series, num) {
  return series < 2 ? num : series * 100000 + num;
}

/** Numéro de puce à partir des 4 octets SI3 SI2 SI1 SI0 (trames de détection et de poinçon). */
export function decodeCardNumber(s3, s2, s1, s0) {
  const n24 = (s2 << 16) | (s1 << 8) | s0;
  if (s3 === 0 && n24 < 500000) return si5Number(s2, (s1 << 8) | s0);
  return n24;
}

/** Informations d'une trame de détection (E5/E6/E8) : données = CN1 CN0 SI3 SI2 SI1 SI0. */
export function detectionInfo(cmd, data) {
  if (!data || data.length < 6) return null;
  const s3 = data[2];
  const s2 = data[3];
  const s1 = data[4];
  const s0 = data[5];
  if (cmd === 0xe5) return { type: 'SI5', number: si5Number(s2, (s1 << 8) | s0) };
  const n = (s2 << 16) | (s1 << 8) | s0;
  if (cmd === 0xe6) return { type: 'SI6', number: n };
  let type = cardTypeFromNumber(n);
  if (type === 'SI5' || type === 'SI6') type = 'SI9';
  return { type, number: n, series: s3 };
}

// Disposition des puces lues avec la commande 0xEF.
//   offset : adresse du premier poinçon, max : nombre de poinçons maximum,
//   blocks : blocs à lire (null = blocs 4 à 7 selon le nombre de poinçons).
export const MODERN_LAYOUT = {
  SI8: { offset: 136, max: 30, blocks: [0, 1], series: 0x02 },
  SI9: { offset: 56, max: 50, blocks: [0, 1], series: 0x01 },
  pCard: { offset: 176, max: 20, blocks: [0, 1], series: 0x04 },
  tCard: { offset: 56, max: 50, blocks: [0, 1], series: 0x06 },
  fCard: { offset: 56, max: 50, blocks: [0, 1], series: 0x0e },
  SI10: { offset: 512, max: 128, blocks: null, series: 0x0f },
  SI11: { offset: 512, max: 128, blocks: null, series: 0x0f },
  SIAC: { offset: 512, max: 128, blocks: null, series: 0x0f },
};

// --- lecture d'un enregistrement de 4 octets : TD CN TH TL ---------------------
// TD : bit 0 = après-midi, bits 7-6 = bits 9-8 du numéro de poste.
function recordTime(mem, o) {
  const raw = (mem[o + 2] << 8) | mem[o + 3];
  if (raw === TIME_NONE) return null;
  return raw + (mem[o] & 1 ? HALF_DAY : 0);
}

function recordPunch(mem, o) {
  const td = mem[o];
  return { code: mem[o + 1] | ((td & 0xc0) << 2), time: recordTime(mem, o) };
}

/** SI-Card 5 : image mémoire de 128 octets. */
export function decodeSi5(mem) {
  const t = (o) => {
    const raw = (mem[o] << 8) | mem[o + 1];
    return raw === TIME_NONE ? null : raw;
  };
  const number = si5Number(mem[6], (mem[4] << 8) | mem[5]);
  let count = mem[23] - 1; // pointeur vers le prochain poinçon
  count = Math.max(0, Math.min(count, 36));
  const punches = [];
  for (let p = 0; p < Math.min(count, 30); p++) {
    const o = 32 + Math.floor(p / 5) * 16 + 1 + (p % 5) * 3;
    punches.push({ code: mem[o], time: t(o + 1) });
  }
  for (let p = 30; p < count; p++) {
    // poinçons 31 à 36 : numéro de poste seulement, sans heure
    punches.push({ code: mem[32 + (p - 30) * 16], time: null });
  }
  return {
    number,
    type: 'SI5',
    h24: false,
    check: t(25),
    start: t(19),
    finish: t(21),
    clear: null,
    punches,
  };
}

/** SI-Card 6 : image mémoire contenant les blocs 0, 6 et 7. */
export function decodeSi6(mem) {
  const number = (mem[11] << 16) | (mem[12] << 8) | mem[13];
  const count = Math.min(mem[18], 64);
  const punches = [];
  for (let p = 0; p < count; p++) punches.push(recordPunch(mem, 768 + p * 4));
  return {
    number,
    type: 'SI6',
    h24: true,
    finish: recordTime(mem, 20),
    start: recordTime(mem, 24),
    check: recordTime(mem, 28),
    clear: recordTime(mem, 32),
    punches,
  };
}

/** SI-Card 8, 9, 10, 11, SIAC, pCard, tCard : image mémoire (blocs à leur adresse). */
export function decodeModern(mem, type) {
  const L = MODERN_LAYOUT[type] || MODERN_LAYOUT.SI9;
  const number = (mem[25] << 16) | (mem[26] << 8) | mem[27];
  const count = Math.min(mem[22], L.max);
  const punches = [];
  for (let p = 0; p < count; p++) punches.push(recordPunch(mem, L.offset + p * 4));
  return {
    number,
    type,
    h24: true,
    check: recordTime(mem, 8),
    start: recordTime(mem, 12),
    finish: recordTime(mem, 16),
    clear: null,
    punches,
  };
}

// --- encodage (simulateur, tests) ---------------------------------------------
function writeRecord(mem, o, code, time) {
  if (time == null) {
    mem[o] = mem[o + 1] = mem[o + 2] = mem[o + 3] = 0xee;
    return;
  }
  const t = ((Math.round(time) % 86400) + 86400) % 86400;
  const raw = t % HALF_DAY;
  mem[o] = (t >= HALF_DAY ? 1 : 0) | (((code >> 8) & 3) << 6);
  mem[o + 1] = code & 0xff;
  mem[o + 2] = raw >> 8;
  mem[o + 3] = raw & 0xff;
}

function write12(mem, o, time) {
  if (time == null) {
    mem[o] = mem[o + 1] = 0xee;
    return;
  }
  const raw = (((Math.round(time) % 86400) + 86400) % 86400) % HALF_DAY;
  mem[o] = raw >> 8;
  mem[o + 1] = raw & 0xff;
}

/**
 * Produit l'image mémoire d'une puce (inverse des fonctions de décodage).
 * card = { number, type?, check, start, finish, clear, punches: [{code, time}] }
 */
export function encodeCard(card) {
  const type = card.type || cardTypeFromNumber(card.number);
  const n = card.number;
  if (type === 'SI5') {
    const mem = new Uint8Array(128);
    const series = n >= 100000 ? Math.floor(n / 100000) : 1;
    const num = n >= 100000 ? n % 100000 : n;
    mem[4] = num >> 8;
    mem[5] = num & 0xff;
    mem[6] = series;
    write12(mem, 19, card.start);
    write12(mem, 21, card.finish);
    write12(mem, 25, card.check);
    const punches = card.punches.slice(0, 36);
    mem[23] = punches.length + 1;
    punches.forEach((p, i) => {
      if (i < 30) {
        const o = 32 + Math.floor(i / 5) * 16 + 1 + (i % 5) * 3;
        mem[o] = p.code & 0xff;
        write12(mem, o + 1, p.time);
      } else {
        mem[32 + (i - 30) * 16] = p.code & 0xff;
      }
    });
    return { type, mem, series };
  }
  const mem = new Uint8Array(1024).fill(0xee);
  if (type === 'SI6') {
    mem[10] = 0;
    mem[11] = (n >> 16) & 0xff;
    mem[12] = (n >> 8) & 0xff;
    mem[13] = n & 0xff;
    const punches = card.punches.slice(0, 64);
    mem[18] = punches.length;
    writeRecord(mem, 20, 2, card.finish);
    writeRecord(mem, 24, 1, card.start);
    writeRecord(mem, 28, 3, card.check);
    writeRecord(mem, 32, 4, card.clear);
    punches.forEach((p, i) => writeRecord(mem, 768 + i * 4, p.code, p.time));
    return { type, mem, series: 0 };
  }
  const L = MODERN_LAYOUT[type] || MODERN_LAYOUT.SI9;
  const punches = card.punches.slice(0, L.max);
  writeRecord(mem, 8, 3, card.check);
  writeRecord(mem, 12, 1, card.start);
  writeRecord(mem, 16, 2, card.finish);
  mem[20] = mem[21] = mem[23] = 0;
  mem[22] = punches.length;
  mem[24] = L.series;
  mem[25] = (n >> 16) & 0xff;
  mem[26] = (n >> 8) & 0xff;
  mem[27] = n & 0xff;
  punches.forEach((p, i) => writeRecord(mem, L.offset + i * 4, p.code, p.time));
  return { type, mem, series: L.series };
}
