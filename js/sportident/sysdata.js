// Données système d'un boîtier SportIdent (128 octets lus à l'adresse 0x00) et horloge.
// Adresses recoupées avec les implémentations libres sportident.js et sireader.
import { MODE_NAMES, modelName } from './constants.js';

const yymmdd = (v, o) => {
  const y = v[o];
  const m = v[o + 1];
  const d = v[o + 2];
  if (!m || m > 12 || !d || d > 31) return null;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${2000 + y}`;
};

/** Décode les 128 octets de données système. */
export function parseSystemData(v) {
  const serial = v[0] * 0x1000000 + (v[1] << 16) + (v[2] << 8) + v[3];
  const modelId = (v[0x0b] << 8) | v[0x0c];
  const mode = v[0x71];
  const code = v[0x72] | (((v[0x73] >> 6) & 3) << 8);

  // Batterie : capacité (0x19-0x1A, unité 14,0625 mAh) et consommation (0x35-0x37, en mA·s)
  const capRaw = (v[0x19] << 8) | v[0x1a];
  const usedRaw = (v[0x35] << 16) | (v[0x36] << 8) | v[0x37];
  const capacityMah = capRaw && capRaw !== 0xffff ? Math.round(capRaw * 14.0625) : null;
  const usedMah = usedRaw !== 0xffffff ? Math.round(usedRaw / 3600) : null;
  let batteryPercent = null;
  if (capacityMah && capacityMah >= 100 && capacityMah <= 20000 && usedMah != null) {
    batteryPercent = Math.max(0, Math.min(100, Math.round(100 - (usedMah / capacityMah) * 100)));
  }

  return {
    serial,
    firmware: String.fromCharCode(v[5], v[6], v[7]).replace(/[^\x20-\x7e]/g, ''),
    buildDate: yymmdd(v, 0x08),
    modelId,
    model: modelName(modelId),
    mode,
    modeName: MODE_NAMES[mode] || `mode ${mode}`,
    code,
    feedback: v[0x73],
    proto: v[0x74],
    batteryDate: yymmdd(v, 0x15),
    capacityMah,
    usedMah,
    batteryPercent,
    memoryOverflow: v[0x3d] !== 0 && v[0x3d] !== 0xff,
    raw: Uint8Array.from(v),
  };
}

/** Horloge d'un boîtier → Date. Octets : AA MM JJ TD HH LL SS (TD bit 0 = après-midi). */
export function decodeStationTime(b) {
  if (!b || b.length < 7) return null;
  const secs = (b[4] << 8) | b[5];
  if (secs === 0xeeee || !b[1] || b[1] > 12) return null;
  const hours = (b[3] & 1) * 12 + Math.floor(secs / 3600);
  return new Date(2000 + b[0], b[1] - 1, b[2], hours, Math.floor((secs % 3600) / 60), secs % 60, Math.round((b[6] * 1000) / 256));
}

/** Date → 7 octets pour la commande de réglage de l'heure (0xF6). Dimanche = 0. */
export function encodeStationTime(d) {
  const h = d.getHours();
  const secs = (h % 12) * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return [d.getFullYear() % 100, d.getMonth() + 1, d.getDate(), (d.getDay() << 1) + (h >= 12 ? 1 : 0), secs >> 8, secs & 0xff, Math.floor((d.getMilliseconds() * 256) / 1000)];
}
