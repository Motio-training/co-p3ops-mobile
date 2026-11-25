// Bus d'événements de l'application (notifications, dialogues, lectures…).
const target = new EventTarget();

export const bus = {
  on(type, fn) {
    const handler = (e) => fn(e.detail);
    target.addEventListener(type, handler);
    return () => target.removeEventListener(type, handler);
  },
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};

/** Affiche une notification. kind : info | success | error | warning */
export function toast(message, kind = 'info', opts = {}) {
  bus.emit('toast', { message, kind, ...opts });
}

/** Demande une confirmation ; renvoie une promesse de booléen. */
export function confirmDialog({ title = 'Confirmer', message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => bus.emit('confirm', { title, message, confirmLabel, danger, resolve }));
}
