// Pilote d'une station maître SportIdent (BSM7/BSM8 USB…) via l'API Web Serial.
//
// Configuration attendue du boîtier (réglage d'usine des BSM en lecture) :
//   mode « Lecture » (Readout), protocole étendu, handshake.
//
// Événements émis (CustomEvent, détail entre parenthèses) :
//   state          ({state, message})        changement d'état de connexion
//   card-inserted  ({number, type})          puce détectée
//   card-reading   ({number, type})          lecture en cours
//   card           ({card, source})          puce lue et décodée
//   card-error     ({number, message})       échec de lecture
//   card-removed   ()
//   punch          ({code, number, time})    poinçon transmis (station en autosend / radio)
//   log            (ligne du journal)
import { ACK, NAK, FrameParser, buildFrame, toHex } from './frames.js';
import { CMD, MS_DIRECT, MS_REMOTE, MODE_NAMES, modelName } from './constants.js';
import { decodeStationTime, encodeStationTime, parseSystemData } from './sysdata.js';
import { MODERN_LAYOUT, decodeCardNumber, decodeModern, decodeSi5, decodeSi6, detectionInfo } from './cards.js';

// Silicon Labs CP210x : PID spécifique SPORTident (0x800A) et PID générique (0xEA60)
export const SI_USB_FILTERS = [
  { usbVendorId: 0x10c4, usbProductId: 0x800a },
  { usbVendorId: 0x10c4, usbProductId: 0xea60 },
];

/** Port USB d'un lecteur SportIdent (BSM7 / BSM8 : puce Silicon Labs, identifiants connus). */
export function isSiPort(port) {
  const a = port?.getInfo?.() || {};
  return SI_USB_FILTERS.some((f) => f.usbVendorId === a.usbVendorId && f.usbProductId === a.usbProductId);
}

export function humanError(e) {
  const name = e?.name || '';
  const msg = e?.message || String(e || '');
  if (name === 'NotFoundError') return 'Aucun port sélectionné.';
  if (name === 'SecurityError') return "L'accès au port série a été refusé.";
  if (name === 'InvalidStateError') return 'Le port est déjà ouvert (dans un autre onglet ?).';
  if (name === 'NetworkError')
    return "Impossible d'ouvrir le port : il est peut-être utilisé par un autre logiciel (SI-Config, SportSoftware…).";
  if (msg === 'timeout') return "Le boîtier ne répond pas. Vérifiez qu'il est allumé et branché.";
  if (msg === 'nak') return 'Le boîtier a refusé la commande.';
  if (msg === 'removed') return 'puce retirée trop tôt';
  return msg;
}

const MODE_READOUT_CODE = 0x05;
const CLEARING_KEY = 'p3ops.lecteur-en-effacement';
function clearingMarker() {
  try {
    return localStorage.getItem(CLEARING_KEY) === '1';
  } catch {
    return false;
  }
}
function setClearingMarker(on) {
  try {
    if (on) localStorage.setItem(CLEARING_KEY, '1');
    else localStorage.removeItem(CLEARING_KEY);
  } catch {}
}

export class Station extends EventTarget {
  constructor() {
    super();
    this.state = 'disconnected'; // disconnected | connecting | connected | error
    this.message = '';
    this.info = null;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readLoopDone = null;
    this.baudRate = null;
    this.simulated = false;
    this.pending = null;
    this.queue = Promise.resolve();
    this.cardQueue = Promise.resolve();
    this.reading = null;
    this.logLines = [];
    this.wanted = null; // port à reconnecter automatiquement s'il est rebranché
    this.manualOff = false; // vrai après « Déconnecter » : pas de connexion automatique
    this.parser = new FrameParser({
      onFrame: (f) => this.onFrame(f),
      onControl: (b) => this.onControl(b),
      onError: (e) => this.log('!', null, e),
    });
    if (Station.supported) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) this.lost('Le boîtier a été débranché.');
      });
      navigator.serial.addEventListener('connect', (e) => {
        if (this.state === 'connected' || this.state === 'connecting') return;
        const a = e.target.getInfo?.() || {};
        const wantedPort = this.wanted && (e.target === this.wanted.port || (a.usbVendorId === this.wanted.vid && a.usbProductId === this.wanted.pid));
        // Le lecteur habituel (déjà autorisé une fois) est rebranché : connexion automatique.
        if (wantedPort || isSiPort(e.target)) {
          this.manualOff = false;
          this.log('i', null, 'Lecteur branché : connexion automatique…');
          setTimeout(() => this.connect(e.target).catch(() => {}), 600);
        }
      });
    }
  }

  /**
   * Connexion automatique au lecteur SportIdent déjà autorisé dans ce navigateur (la toute première
   * fois, le navigateur impose de le choisir dans sa liste ; ensuite il est reconnu tout seul).
   */
  async autoConnect() {
    if (!Station.supported || this.port || this.state === 'connecting' || this.manualOff) return false;
    try {
      const ports = await navigator.serial.getPorts();
      const port = ports.find(isSiPort);
      if (!port || this.port || this.state === 'connecting') return false;
      this.log('i', null, 'Lecteur reconnu : connexion automatique…');
      await this.connect(port);
      return true;
    } catch {
      return false;
    }
  }

  static get supported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get connected() {
    return this.state === 'connected';
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('state', { state, message });
  }

  log(dir, bytes, text = '') {
    const line = { t: Date.now(), dir, hex: bytes ? toHex(bytes) : '', text };
    this.logLines.push(line);
    if (this.logLines.length > 400) this.logLines.splice(0, this.logLines.length - 400);
    this.emit('log', line);
  }

  // --- connexion ----------------------------------------------------------------
  async choosePort({ anyPort = false } = {}) {
    if (!Station.supported) throw new Error("Ce navigateur ne gère pas Web Serial : utilisez Microsoft Edge ou Google Chrome.");
    const port = await navigator.serial.requestPort(anyPort ? {} : { filters: SI_USB_FILTERS });
    this.manualOff = false;
    return this.connect(port);
  }

  async connect(port, { simulated = false } = {}) {
    if (this.port) await this.disconnect({ keepWanted: true });
    this.simulated = simulated;
    this.setState('connecting', 'Connexion au boîtier…');
    let lastErr = null;
    for (const baud of [38400, 4800]) {
      try {
        await this.openPort(port, baud);
        await this.command(CMD.SET_MS, [MS_DIRECT], { timeout: 1200 });
        this.baudRate = baud;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await this.closePort();
        if (e?.name && e.name !== 'Error') break; // le port ne s'ouvre pas : inutile d'insister
      }
    }
    if (lastErr) {
      this.setState('error', humanError(lastErr));
      throw lastErr;
    }
    this.info = await this.readInfo();
    const pi = port.getInfo?.() || {};
    this.wanted = simulated ? null : { port, vid: pi.usbVendorId, pid: pi.usbProductId };
    this.log('i', null, `Connecté à ${this.baudRate} bauds — ${this.info.model}, mode ${this.info.modeName || '?'}`);
    this.setState('connected');
    // Lecteur resté en « Effacement » après une coupure pendant l'effacement des puces : remis en « Lecture ».
    if (this.info.mode === 0x07 && clearingMarker()) {
      try {
        await this.programReader(MODE_READOUT_CODE);
        setClearingMarker(false);
        this.log('i', null, 'Lecteur resté en mode Effacement : remis en mode Lecture');
      } catch {}
    }
    return this.info;
  }

  async disconnect({ keepWanted = false, manual = false } = {}) {
    // Effacement des puces en cours : le lecteur est d'abord remis en « Lecture ».
    if (this.clearing && this.writer) await this.stopClearing().catch(() => {});
    this.clearing = false;
    if (!keepWanted) this.wanted = null;
    // « Déconnecter » à la main : pas de reconnexion automatique avant que le lecteur soit rebranché.
    if (manual) this.manualOff = true;
    await this.closePort();
    this.info = null;
    this.setState('disconnected');
  }

  async lost(message) {
    if (!this.port) return;
    this.log('!', null, message);
    await this.closePort();
    this.info = null;
    this.setState('error', message);
  }

  async openPort(port, baud) {
    await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 8192 });
    this.port = port;
    this.parser.reset();
    this.writer = port.writable.getWriter();
    this.readLoopDone = this.readLoop(port);
  }

  async readLoop(port) {
    const reader = port.readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) {
          this.log('←', value);
          this.parser.push(value);
        }
      }
    } catch (e) {
      if (this.port === port) this.lost('Communication interrompue avec le boîtier.');
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  async closePort() {
    const port = this.port;
    this.port = null;
    this.failPending(new Error('closed'));
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      await this.readLoopDone;
    } catch {}
    this.reader = null;
    this.readLoopDone = null;
    try {
      this.writer?.releaseLock();
    } catch {}
    this.writer = null;
    try {
      await port?.close();
    } catch {}
  }

  // --- commandes ------------------------------------------------------------------
  write(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    this.log('→', data);
    return this.writer.write(data);
  }

  /** Envoie une commande et attend `count` trames de réponse portant le même code. */
  command(cmd, params = [], { timeout = 2000, count = 1 } = {}) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (!this.writer) return reject(new Error('Boîtier non connecté'));
        const timer = setTimeout(() => {
          if (this.pending && this.pending.timer === timer) {
            this.pending = null;
            reject(new Error('timeout'));
          }
        }, timeout);
        this.pending = { cmd, count, frames: [], resolve, reject, timer };
        this.write(buildFrame(cmd, params)).catch((err) => {
          clearTimeout(timer);
          if (this.pending?.timer === timer) this.pending = null;
          reject(err);
        });
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  failPending(err) {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    p.reject(err);
  }

  onControl(byte) {
    if (byte === NAK && this.pending) {
      this.log('!', null, 'NAK reçu');
      this.failPending(new Error('nak'));
    }
  }

  onFrame(frame) {
    const { cmd, data } = frame;
    const p = this.pending;
    if (p && cmd === p.cmd) {
      p.frames.push(frame);
      if (p.frames.length >= p.count) {
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(p.frames);
      }
      return;
    }
    switch (cmd) {
      case CMD.SI5_DET:
      case CMD.SI6_DET:
      case CMD.SI8_DET:
        return this.onDetect(cmd, data);
      case CMD.SI_REM:
        return this.onRemoved();
      case CMD.TRANS_REC:
        return this.onPunch(data);
      default:
        this.log('?', null, `Trame inattendue 0x${cmd.toString(16).toUpperCase()}`);
    }
  }

  async readInfo() {
    const info = {
      code: null,
      mode: null,
      modeName: '',
      serial: null,
      model: 'Station SportIdent',
      modelId: 0,
      firmware: '',
      extended: true,
      autoSend: false,
      handshake: true,
    };
    try {
      // 0x70 programme, 0x71 mode, 0x72 code, 0x73 retour, 0x74 configuration du protocole
      const [f] = await this.command(CMD.GET_SYS_VAL, [0x70, 0x06], { timeout: 1500 });
      const d = f.data;
      info.code = (d[0] << 8) | d[1];
      const v = d.subarray(3);
      info.mode = v[1];
      info.modeName = MODE_NAMES[v[1]] || `mode ${v[1]}`;
      info.extended = !!(v[4] & 1);
      info.autoSend = !!(v[4] & 2);
      info.handshake = !!(v[4] & 4);
    } catch {
      this.log('!', null, 'Configuration du boîtier illisible');
    }
    try {
      const [f] = await this.command(CMD.GET_SYS_VAL, [0x00, 0x0e], { timeout: 1500 });
      const v = f.data.subarray(3);
      info.serial = v[0] * 0x1000000 + (v[1] << 16) + (v[2] << 8) + v[3];
      info.firmware = String.fromCharCode(v[5], v[6], v[7]).replace(/[^\x20-\x7e]/g, '');
      info.modelId = (v[0x0b] << 8) | v[0x0c];
      info.model = modelName(info.modelId);
    } catch {}
    return info;
  }

  // --- programmation des boîtiers ----------------------------------------------------
  async setMs(param) {
    const [f] = await this.command(CMD.SET_MS, [param], { timeout: 2500 });
    if (f.data[2] !== param) throw new Error('Le lecteur a refusé le changement de mode.');
  }

  /**
   * Exécute fn() en s'adressant soit au boîtier posé sur le lecteur (remote = true),
   * soit au lecteur lui-même. Le lecteur repasse toujours en mode direct ensuite.
   */
  async withTarget(remote, fn) {
    if (!this.connected) throw new Error("Connectez d'abord le lecteur.");
    if (this.reading) throw new Error('Une lecture de puce est en cours.');
    this.configuring = true;
    try {
      if (remote) {
        await this.setMs(MS_REMOTE);
        await this.reachRemote();
        this.remote = true;
      }
      return await fn();
    } finally {
      this.remote = false;
      if (remote) {
        try {
          await this.setMs(MS_DIRECT);
        } catch {
          this.log('!', null, 'Retour du lecteur en mode direct impossible : débranchez-le et rebranchez-le.');
        }
      }
      this.configuring = false;
    }
  }

  /**
   * Boîtier posé sur le lecteur : les premières commandes reçoivent souvent un refus (NAK) le temps que la
   * liaison entre les deux boîtiers s'établisse (constaté avec BSM8 + BSF8). On insiste avant d'abandonner.
   */
  async reachRemote(maxMs = this.remoteWaitMs ?? 8000) {
    const end = Date.now() + maxMs;
    for (let i = 1; ; i++) {
      try {
        await this.command(CMD.GET_TIME, [], { timeout: 2500 });
        return;
      } catch (e) {
        if (Date.now() >= end || (e.message !== 'nak' && e.message !== 'timeout')) {
          throw new Error(
            e.message === 'nak' || e.message === 'timeout'
              ? "Le boîtier posé sur le lecteur ne répond pas. Réveillez-le (insérez une puce : il bipe), posez-le aussitôt contre le lecteur, zones de poinçonnage face à face, sans bouger, puis recommencez."
              : e.message
          );
        }
        this.log('i', null, `Boîtier posé sur le lecteur : pas encore de réponse (essai ${i})`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  /** Commande vers le boîtier posé sur le lecteur : nouvel essai en cas de refus passager. */
  async cmdRetry(cmd, params, opts) {
    for (let i = 1; ; i++) {
      try {
        return await this.command(cmd, params, opts);
      } catch (e) {
        if (!this.remote || e.message !== 'nak' || i >= 4) throw e;
        this.log('i', null, `Refus passager du boîtier, nouvel essai (${i})`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  async readSystem() {
    const [f] = await this.cmdRetry(CMD.GET_SYS_VAL, [0x00, 0x80], { timeout: 5000 });
    if (f.data.length < 3 + 0x80 || f.data[2] !== 0x00) throw new Error('réponse incomplète du boîtier');
    return parseSystemData(f.data.subarray(3, 3 + 0x80));
  }

  async readClock() {
    const [f] = await this.cmdRetry(CMD.GET_TIME, [], { timeout: 4000 });
    return decodeStationTime(f.data.subarray(2));
  }

  async setClock(date = new Date()) {
    await this.cmdRetry(CMD.SET_TIME, encodeStationTime(date), { timeout: 4000 });
  }

  async writeSys(address, bytes) {
    const [f] = await this.cmdRetry(CMD.SET_SYS_VAL, [address, ...bytes], { timeout: 4000 });
    if (f.data[2] !== address) throw new Error("le boîtier n'a pas confirmé l'écriture");
  }

  /** Lit la configuration, la batterie et l'horloge d'un boîtier. */
  inspect(remote) {
    return this.withTarget(remote, async () => {
      const info = await this.readSystem();
      const clock = await this.readClock().catch(() => null);
      return { ...info, clock, clockReadAt: new Date() };
    });
  }

  /** Change la fonction du lecteur lui-même (même numéro), vérifiée par relecture. */
  async programReader(mode) {
    const code = this.info?.code || 1;
    const { after } = await this.program(false, { mode, code, syncTime: false });
    this.info = { ...this.info, mode: after.mode, modeName: MODE_NAMES[after.mode] || `mode ${after.mode}` };
    this.emit('state', { state: this.state, message: this.message });
    return after;
  }

  /**
   * Effacement des puces : le lecteur passe en fonction « Effacement » ; chaque puce insérée est vidée
   * (poinçons, départ, arrivée). stopClearing() le remet en « Lecture ».
   */
  async startClearing() {
    if (!this.connected) throw new Error("Connectez d'abord le lecteur.");
    setClearingMarker(true); // en cas de coupure, le lecteur sera remis en « Lecture » à la reconnexion
    try {
      await this.programReader(0x07);
    } catch (e) {
      setClearingMarker(false);
      throw e;
    }
    this.clearing = true;
    this.emit('clearing', { on: true });
  }

  async stopClearing() {
    if (!this.clearing && this.info?.mode !== 0x07) return;
    this.clearing = false;
    await this.programReader(MODE_READOUT_CODE);
    setClearingMarker(false);
    this.emit('clearing', { on: false });
  }

  /** Met le boîtier à l'heure de l'appareil, puis relit son horloge. */
  syncClock(remote) {
    return this.withTarget(remote, async () => {
      await this.setClock(new Date());
      const clock = await this.readClock();
      return { clock, clockReadAt: new Date() };
    });
  }

  /** Programme la fonction et le n° de poste (et l'heure), puis relit pour vérifier. */
  program(remote, { mode, code, syncTime = true, expectSerial = null }) {
    if (!Number.isInteger(code) || code < 1 || code > 1023) return Promise.reject(new Error('N° de poste invalide (1 à 1023).'));
    return this.withTarget(remote, async () => {
      const before = await this.readSystem();
      if (expectSerial && before.serial !== expectSerial)
        throw new Error(`ce n'est plus le boîtier lu (n° ${expectSerial}) qui est posé sur le lecteur, mais le n° ${before.serial} : relisez-le d'abord`);
      const b73 = (before.raw[0x73] & 0x3f) | (((code >> 8) & 3) << 6);
      await this.writeSys(0x71, [mode, code & 0xff, b73]);
      if (syncTime) await this.setClock(new Date());
      const after = await this.readSystem();
      const clock = await this.readClock().catch(() => null);
      if (after.mode !== mode || after.code !== code) throw new Error('la relecture ne correspond pas à la programmation');
      if (after.serial !== before.serial) throw new Error("le boîtier a changé pendant l'opération");
      return { before, after: { ...after, clock, clockReadAt: new Date() } };
    });
  }

  // --- lecture des puces --------------------------------------------------------
  onDetect(cmd, data) {
    const det = detectionInfo(cmd, data);
    if (!det) return;
    if (this.clearing) {
      this.log('i', null, `Puce ${det.number} insérée dans le lecteur en mode Effacement`);
      this.emit('card-cleared', det);
      return;
    }
    if (this.configuring) {
      this.log('i', null, `Puce ${det.number} ignorée pendant la programmation d'un boîtier`);
      return;
    }
    this.log('i', null, `Puce ${det.number} (${det.type}) insérée`);
    this.emit('card-inserted', det);
    this.cardQueue = this.cardQueue.then(() => this.readCard(det)).catch(() => {});
  }

  onRemoved() {
    this.emit('card-removed', {});
    if (this.reading) {
      this.reading.removed = true;
      this.failPending(new Error('removed'));
    }
  }

  onPunch(data) {
    if (data.length < 9) return;
    const code = (data[0] << 8) | data[1];
    const number = decodeCardNumber(data[2], data[3], data[4], data[5]);
    const raw = (data[7] << 8) | data[8];
    const time = raw === 0xeeee ? null : raw + (data[6] & 1 ? 43200 : 0);
    this.emit('punch', { code, number, time });
  }

  async readBlock(cmd, bn, mem) {
    const [f] = await this.command(cmd, [bn], { timeout: 2500 });
    if (f.data.length < 131) throw new Error('bloc incomplet');
    mem.set(f.data.subarray(3, 131), f.data[2] * 128);
  }

  async readCard(det) {
    this.reading = { ...det, removed: false };
    this.emit('card-reading', det);
    try {
      const mem = new Uint8Array(1024).fill(0xee);
      let card;
      if (det.type === 'SI5') {
        const [f] = await this.command(CMD.GET_SI5, [], { timeout: 3000 });
        if (f.data.length < 130) throw new Error('données incomplètes');
        card = decodeSi5(f.data.subarray(2, 130));
      } else if (det.type === 'SI6') {
        for (const bn of [0, 6, 7]) await this.readBlock(CMD.GET_SI6, bn, mem);
        card = decodeSi6(mem);
      } else {
        const layout = MODERN_LAYOUT[det.type] || MODERN_LAYOUT.SI9;
        if (layout.blocks) {
          for (const bn of layout.blocks) await this.readBlock(CMD.GET_SI8, bn, mem);
        } else {
          // SI10/SI11/SIAC : bloc 8 = blocs 0, 4, 5, 6, 7 en une seule commande
          try {
            const frames = await this.command(CMD.GET_SI8, [8], { timeout: 4000, count: 5 });
            for (const f of frames) mem.set(f.data.subarray(3, 131), f.data[2] * 128);
          } catch (e) {
            if (e.message === 'removed' || this.reading.removed) throw e;
            this.log('i', null, 'Lecture groupée impossible, lecture bloc par bloc');
            await this.readBlock(CMD.GET_SI8, 0, mem);
            const blocks = Math.ceil(Math.min(mem[22], layout.max) / 32);
            for (let i = 0; i < blocks; i++) await this.readBlock(CMD.GET_SI8, 4 + i, mem);
          }
        }
        card = decodeModern(mem, det.type);
      }
      if (card.number !== det.number) this.log('!', null, `Numéro en mémoire ${card.number} ≠ ${det.number}`);
      card.number = det.number;
      card.type = det.type;
      if (this.writer) await this.write([ACK]); // bip + voyant : la puce peut être retirée
      this.emit('card', { card, source: this.simulated ? 'simulation' : 'station' });
    } catch (e) {
      const removed = this.reading?.removed || e.message === 'removed';
      const message = removed
        ? `Puce ${det.number} retirée trop tôt : réinsérez-la.`
        : `Lecture de la puce ${det.number} impossible (${humanError(e)}). Réinsérez la puce.`;
      this.log('!', null, message);
      this.emit('card-error', { number: det.number, message });
    } finally {
      this.reading = null;
    }
  }
}

export const station = new Station();
