// Boîtier SportIdent simulé : imite un port série relié à une BSM8 en mode Lecture,
// avec un poste BSF8 « posé dessus » pour essayer la programmation des boîtiers.
// Il parle le vrai protocole (trames, CRC, blocs mémoire), ce qui permet de tester
// toute la chaîne sans matériel.
import { ACK, FrameParser, NAK, buildFrame } from './frames.js';
import { CMD, MS_REMOTE } from './constants.js';
import { encodeCard } from './cards.js';
import { decodeStationTime, encodeStationTime } from './sysdata.js';

function makeSys({ serial, modelId, mode, code, battery = null }) {
  const s = new Uint8Array(0x80);
  s[0] = (serial >>> 24) & 0xff;
  s[1] = (serial >> 16) & 0xff;
  s[2] = (serial >> 8) & 0xff;
  s[3] = serial & 0xff;
  s[5] = 0x36; // « 656 »
  s[6] = 0x35;
  s[7] = 0x36;
  s[8] = 20; // fabriqué le 15/03/2020
  s[9] = 3;
  s[10] = 15;
  s[0x0b] = modelId >> 8;
  s[0x0c] = modelId & 0xff;
  if (battery) {
    s[0x15] = 24; // pile changée le 02/09/2024
    s[0x16] = 9;
    s[0x17] = 2;
    s[0x19] = battery.capRaw >> 8;
    s[0x1a] = battery.capRaw & 0xff;
    s[0x35] = (battery.usedRaw >> 16) & 0xff;
    s[0x36] = (battery.usedRaw >> 8) & 0xff;
    s[0x37] = battery.usedRaw & 0xff;
  }
  s[0x71] = mode;
  s[0x72] = code & 0xff;
  s[0x73] = 0x05 | (((code >> 8) & 3) << 6); // bip + voyant
  s[0x74] = 0b101; // protocole étendu + handshake
  return s;
}

export class SimulatedPort {
  constructor({ code = 10, modelId = 0x9198, serial = 412345 } = {}) {
    this.master = { sys: makeSys({ serial, modelId, mode: 0x05, code }), clockOffset: 0 };
    // Poste BSF8 posé sur le lecteur : batterie de 1000 mAh dont 22 % consommés, horloge en retard de 13 min
    this.remote = {
      sys: makeSys({ serial: 813456, modelId: 0x8198, mode: 0x02, code: 44, battery: { capRaw: 14062, usedRaw: 790000 } }),
      clockOffset: -13 * 60 * 1000,
    };
    this.remotePresent = true;
    this.remoteWarmup = 2; // comme un vrai BSM8 : les 2 premières commandes après le passage en distant sont refusées
    this.warmupLeft = 0;
    this.target = 'M';
    this.card = null;
    this.readable = null;
    this.writable = null;
    this.controller = null;
    this.parser = new FrameParser({
      onFrame: (f) => this.handle(f),
      onControl: (b) => {
        if (b === ACK) this.onAck();
      },
    });
  }

  getInfo() {
    return { usbVendorId: 0x10c4, usbProductId: 0x800a };
  }

  async open({ baudRate }) {
    if (this.readable) throw new DOMException('Port déjà ouvert', 'InvalidStateError');
    this.baudRate = baudRate;
    this.target = 'M';
    this.readable = new ReadableStream({
      start: (c) => {
        this.controller = c;
      },
      cancel: () => {
        this.controller = null;
      },
    });
    this.writable = new WritableStream({
      write: (chunk) => {
        if (this.baudRate === 38400) this.parser.push(chunk);
      },
    });
  }

  async close() {
    try {
      this.controller?.close();
    } catch {}
    this.controller = null;
    this.readable = null;
    this.writable = null;
  }

  // Envoie des octets au PC, en deux morceaux pour éprouver le découpage des trames.
  // Onglet en arrière-plan : le navigateur ralentit les minuteries, on répond donc sans délai.
  send(bytes, delay = 15) {
    const data = Uint8Array.from(bytes);
    const cut = 1 + Math.floor(Math.random() * (data.length - 1));
    const later = (fn, ms) => (document.hidden ? queueMicrotask(fn) : setTimeout(fn, ms));
    later(() => {
      try {
        this.controller?.enqueue(data.slice(0, cut));
        later(() => {
          try {
            this.controller?.enqueue(data.slice(cut));
          } catch {}
        }, 4);
      } catch {}
    }, delay + Math.random() * 20);
  }

  get dev() {
    return this.target === 'S' ? this.remote : this.master;
  }

  reply(cmd, data, delay) {
    const s = this.dev.sys;
    const code = s[0x72] | (((s[0x73] >> 6) & 3) << 8);
    this.send(buildFrame(cmd, [(code >> 8) & 0xff, code & 0xff, ...data], { wakeup: false }), delay);
  }

  handle({ cmd, data }) {
    // En mode distant : refus (NAK) tant que la liaison avec le boîtier posé dessus n'est pas établie,
    // et toujours s'il n'y a pas de boîtier (comportement constaté avec BSM8 + BSF8).
    if (this.target === 'S' && cmd !== CMD.SET_MS) {
      if (!this.remotePresent) return this.send([NAK], 40);
      if (this.warmupLeft > 0) {
        this.warmupLeft--;
        return this.send([NAK], 40);
      }
    }
    switch (cmd) {
      case CMD.SET_MS:
        this.target = data[0] === MS_REMOTE ? 'S' : 'M';
        this.target = 'M'; // la réponse vient du lecteur lui-même
        this.reply(CMD.SET_MS, [data[0]]);
        this.target = data[0] === MS_REMOTE ? 'S' : 'M';
        this.warmupLeft = this.target === 'S' ? this.remoteWarmup : 0;
        return;
      case CMD.GET_SYS_VAL: {
        const [adr, len] = data;
        return this.reply(cmd, [adr, ...this.dev.sys.slice(adr, adr + len)], this.target === 'S' ? 80 : 15);
      }
      case CMD.SET_SYS_VAL: {
        const [adr, ...bytes] = data;
        this.dev.sys.set(bytes, adr);
        return this.reply(cmd, [adr]);
      }
      case CMD.GET_TIME:
        return this.reply(cmd, encodeStationTime(new Date(Date.now() + this.dev.clockOffset)));
      case CMD.SET_TIME: {
        const d = decodeStationTime(data);
        if (d) this.dev.clockOffset = d.getTime() - Date.now();
        return this.reply(cmd, data);
      }
      case CMD.GET_SI5:
        if (!this.card || this.card.type !== 'SI5') return this.send([NAK]);
        return this.reply(cmd, [...this.card.mem.slice(0, 128)], 60);
      case CMD.GET_SI6:
      case CMD.GET_SI8: {
        if (!this.card) return this.send([NAK]);
        const bn = data[0];
        const blocks = bn === 8 ? (this.card.type === 'SI6' ? [0, 6, 7] : [0, 4, 5, 6, 7]) : [bn];
        blocks.forEach((b, i) => this.reply(cmd, [b, ...this.card.mem.slice(b * 128, b * 128 + 128)], 40 + i * 35));
        return;
      }
      default:
        return this.send([NAK]);
    }
  }

  /** Simule l'insertion d'une puce dans le boîtier. */
  insert(card) {
    if (!this.controller) return false;
    this.card = encodeCard(card);
    const n = card.number;
    const { type, series } = this.card;
    let cmd;
    let det;
    if (type === 'SI5') {
      cmd = CMD.SI5_DET;
      const num = n >= 100000 ? n % 100000 : n;
      det = [0, n >= 100000 ? Math.floor(n / 100000) : 1, num >> 8, num & 0xff];
    } else {
      cmd = type === 'SI6' ? CMD.SI6_DET : CMD.SI8_DET;
      det = [series, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }
    const t = this.target;
    this.target = 'M';
    this.reply(cmd, det);
    this.target = t;
    return true;
  }

  onAck() {
    // le coureur retire sa puce après le bip
    setTimeout(() => {
      this.card = null;
      const t = this.target;
      this.target = 'M';
      this.reply(CMD.SI_REM, [0, 0, 0, 0]);
      this.target = t;
    }, 350);
  }
}
