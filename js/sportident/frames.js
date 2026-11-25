// Construction et découpage des trames du protocole étendu SportIdent :
//   STX CMD LEN DATA… CRC1 CRC0 ETX
import { crc16 } from './crc.js';

export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
export const WAKEUP = 0xff;

export function buildFrame(cmd, params = [], { wakeup = true } = {}) {
  const body = [cmd, params.length, ...params];
  const crc = crc16(body);
  const out = wakeup ? [WAKEUP, STX] : [STX];
  out.push(...body, crc >> 8, crc & 0xff, ETX);
  return Uint8Array.from(out);
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/**
 * Découpe un flux d'octets en trames. Tolère les octets de réveil (0xFF),
 * un STX doublé, le bruit, et les trames reçues en plusieurs morceaux.
 */
export class FrameParser {
  constructor({ onFrame, onControl, onError } = {}) {
    this.onFrame = onFrame;
    this.onControl = onControl;
    this.onError = onError;
    this.buf = [];
    this.staleTimer = null;
  }

  reset() {
    this.buf = [];
    clearTimeout(this.staleTimer);
  }

  push(chunk) {
    for (const b of chunk) this.buf.push(b);
    this.process();
  }

  process() {
    const b = this.buf;
    let i = 0;
    while (i < b.length) {
      const c = b[i];
      if (c === STX) {
        if (i + 1 < b.length && b[i + 1] === STX) {
          i++;
          continue;
        }
        if (b.length - i < 3) break; // attendre CMD et LEN
        const cmd = b[i + 1];
        const len = b[i + 2];
        if (cmd < 0x80) {
          // protocole de base (non étendu) : non pris en charge
          this.onError?.('Trame au protocole de base ignorée (activez le protocole étendu)');
          i++;
          continue;
        }
        const total = len + 6;
        if (b.length - i < total) break; // trame incomplète
        if (b[i + total - 1] !== ETX) {
          this.onError?.('Trame mal terminée ignorée');
          i++;
          continue;
        }
        const body = b.slice(i + 1, i + 3 + len);
        const crc = (b[i + 3 + len] << 8) | b[i + 4 + len];
        if (crc16(body) !== crc) {
          this.onError?.('Trame avec CRC invalide ignorée');
          i++;
          continue;
        }
        this.onFrame?.({ cmd, data: Uint8Array.from(b.slice(i + 3, i + 3 + len)) });
        i += total;
        continue;
      }
      if (c === ACK || c === NAK) this.onControl?.(c);
      i++; // WAKEUP, ACK/NAK ou bruit
    }
    this.buf = b.slice(i);
    clearTimeout(this.staleTimer);
    if (this.buf.length) {
      // Si une trame reste incomplète trop longtemps, on abandonne son premier octet.
      this.staleTimer = setTimeout(() => {
        if (this.buf.length) {
          this.buf.shift();
          this.process();
        }
      }, 800);
    }
  }
}
