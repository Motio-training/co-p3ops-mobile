// Lecteur SportIdent branché sur un téléphone Android (câble USB OTG).
//
// Chrome pour Android ne donne pas (encore) accès aux ports série USB. Il donne en revanche accès aux
// appareils USB (WebUSB). Le BSM7 / BSM8 contient une puce USB-série Silicon Labs CP210x : ce fichier
// en est le pilote, présenté sous la même forme que l'API Web Serial (navigator.serial). Le reste de
// CO - P3OPS (sportident/station.js) l'utilise donc sans modification.

const SILABS = 0x10c4;
// Requêtes « vendeur » du CP210x (documentation Silicon Labs AN571)
const IFC_ENABLE = 0x00;
const SET_BAUDDIV = 0x01;
const SET_LINE_CTL = 0x03;
const SET_MHS = 0x07;
const PURGE = 0x12;
const SET_BAUDRATE = 0x1e;

const ports = new Map(); // USBDevice → UsbSerialPort

class UsbSerialPort extends EventTarget {
  constructor(device) {
    super();
    this.device = device;
    this.readable = null;
    this.writable = null;
    this.iface = 0;
    this.epIn = 1;
    this.epOut = 1;
    this.packet = 64;
    this.closing = false;
  }

  getInfo() {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  }

  async control(request, value, data) {
    const setup = { requestType: 'vendor', recipient: 'interface', request, value, index: this.iface };
    const r = data ? await this.device.controlTransferOut(setup, data) : await this.device.controlTransferOut(setup);
    if (r.status !== 'ok') throw new Error(`Commande USB refusée (${request})`);
  }

  async open({ baudRate = 38400 } = {}) {
    const d = this.device;
    if (this.readable) throw Object.assign(new Error('Port déjà ouvert'), { name: 'InvalidStateError' });
    try {
      if (!d.opened) await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      const iface = d.configuration.interfaces.find((i) => i.alternate.endpoints.some((e) => e.type === 'bulk')) || d.configuration.interfaces[0];
      this.iface = iface.interfaceNumber;
      const eps = iface.alternate.endpoints;
      const epIn = eps.find((e) => e.direction === 'in' && e.type === 'bulk');
      const epOut = eps.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (!epIn || !epOut) throw new Error("Ce boîtier USB n'a pas de liaison série reconnue.");
      this.epIn = epIn.endpointNumber;
      this.epOut = epOut.endpointNumber;
      this.packet = epIn.packetSize || 64;
      await d.claimInterface(this.iface);
    } catch (e) {
      throw Object.assign(new Error(e.message), { name: e.name === 'SecurityError' ? 'SecurityError' : 'NetworkError' });
    }

    await this.control(IFC_ENABLE, 0x0001);
    await this.control(SET_LINE_CTL, 0x0800); // 8 bits, sans parité, 1 bit de stop
    const baud = new DataView(new ArrayBuffer(4));
    baud.setUint32(0, baudRate, true);
    try {
      await this.control(SET_BAUDRATE, 0, baud.buffer);
    } catch {
      await this.control(SET_BAUDDIV, Math.round(3686400 / baudRate)); // anciens CP210x
    }
    await this.control(SET_MHS, 0x0303).catch(() => {}); // DTR et RTS actifs
    await this.control(PURGE, 0x000f).catch(() => {});

    this.closing = false;
    const self = this;
    const end = (controller) => {
      try {
        controller.close();
      } catch {}
    };
    this.readable = new ReadableStream({
      async pull(controller) {
        for (;;) {
          if (self.closing) return end(controller);
          let r;
          try {
            r = await d.transferIn(self.epIn, self.packet);
          } catch (e) {
            if (self.closing) return end(controller);
            try {
              controller.error(e);
            } catch {}
            return;
          }
          if (r.status === 'stall') {
            await d.clearHalt('in', self.epIn).catch(() => {});
            continue;
          }
          if (r.data && r.data.byteLength) {
            controller.enqueue(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice());
            return;
          }
        }
      },
      cancel() {
        self.closing = true;
      },
    });
    this.writable = new WritableStream({
      async write(chunk) {
        const r = await d.transferOut(self.epOut, chunk);
        if (r.status !== 'ok') throw new Error('Envoi USB refusé');
      },
    });
  }

  async close() {
    this.closing = true;
    const d = this.device;
    try {
      await this.control(IFC_ENABLE, 0x0000);
    } catch {}
    try {
      await d.releaseInterface(this.iface);
    } catch {}
    try {
      await d.close();
    } catch {}
    this.readable = null;
    this.writable = null;
  }
}

function portFor(device) {
  if (!ports.has(device)) ports.set(device, new UsbSerialPort(device));
  return ports.get(device);
}

/** Événement dont la cible est le port (comme avec Web Serial). */
function portEvent(type, port) {
  const ev = new Event(type);
  Object.defineProperty(ev, 'target', { value: port });
  return ev;
}

class UsbSerial extends EventTarget {
  constructor() {
    super();
    navigator.usb.addEventListener('connect', (e) => {
      if (e.device.vendorId === SILABS) this.dispatchEvent(portEvent('connect', portFor(e.device)));
    });
    navigator.usb.addEventListener('disconnect', (e) => {
      const port = ports.get(e.device);
      if (!port) return;
      port.closing = true;
      this.dispatchEvent(portEvent('disconnect', port));
    });
  }

  async requestPort({ filters = [] } = {}) {
    const usbFilters = filters.length
      ? filters.map((f) => ({ vendorId: f.usbVendorId, ...(f.usbProductId != null ? { productId: f.usbProductId } : {}) }))
      : [{ vendorId: SILABS }];
    try {
      return portFor(await navigator.usb.requestDevice({ filters: usbFilters }));
    } catch (e) {
      throw Object.assign(new Error(e.message), { name: e.name || 'NotFoundError' });
    }
  }

  async getPorts() {
    const devices = await navigator.usb.getDevices();
    return devices.filter((d) => d.vendorId === SILABS).map(portFor);
  }
}

// La version téléphone passe toujours par ce pilote USB dès que le navigateur le permet : le port série
// « natif » de Chrome sur Android ne voit pas le lecteur (« aucun appareil compatible »), et l'on ne peut
// pas se fier au nom du système (Chrome en « version pour ordinateur » ne dit plus qu'il est sur Android).
if ('usb' in navigator) {
  if ('serial' in navigator) Object.defineProperty(navigator, 'serialNative', { value: navigator.serial, configurable: true });
  Object.defineProperty(navigator, 'serial', { value: new UsbSerial(), configurable: true });
}
