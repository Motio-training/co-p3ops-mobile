// Composants d'interface réutilisables.
import { html, useEffect, useRef, useState } from '../lib.js';
import { Icon } from './icons.js';
import { bus } from '../core/bus.js';
import { fmtClock, parseClock } from '../core/time.js';
import { STATUS_LABEL, STATUS_TITLE } from '../domain/results.js';

export { Icon };

export function Button({ variant = 'secondary', icon, small, children, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`btn btn-${variant}${small ? ' btn-sm' : ''} ${cls}`} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${small ? 15 : 17} />`}${children != null && children !== false && html`<span>${children}</span>`}
  </button>`;
}

export function IconButton({ icon, title, class: cls = '', ...rest }) {
  return html`<button type="button" class=${'icon-btn ' + cls} title=${title} aria-label=${title} ...${rest}>
    <${Icon} name=${icon} size=${17} />
  </button>`;
}

export function PageHeader({ title, subtitle, children }) {
  return html`<header class="page-head">
    <div>
      <h1>${title}</h1>
      ${subtitle && html`<p class="page-sub">${subtitle}</p>`}
    </div>
    ${children && html`<div class="page-actions">${children}</div>`}
  </header>`;
}

export function Card({ title, actions, children, class: cls = '', pad = true }) {
  return html`<section class=${'card ' + cls}>
    ${(title || actions) &&
    html`<header class="card-head">
      <h2>${title}</h2>
      ${actions && html`<div class="card-actions">${actions}</div>`}
    </header>`}
    <div class=${pad ? 'card-body' : ''}>${children}</div>
  </section>`;
}

export function EmptyState({ icon = 'info', title, text, children }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${26} /></div>
    <h3>${title}</h3>
    ${text && html`<p>${text}</p>`}
    ${children && html`<div class="empty-actions">${children}</div>`}
  </div>`;
}

export function Field({ label, hint, error, children, class: cls = '' }) {
  return html`<label class=${'field ' + cls}>
    <span class="field-label">${label}</span>
    ${children}
    ${error ? html`<span class="field-error">${error}</span>` : hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function StatusPill({ status, nc }) {
  if (status === 'OK' && nc) return html`<span class="pill pill-nc" title="Hors classement">NC</span>`;
  return html`<span class=${'pill pill-' + status.toLowerCase()} title=${STATUS_TITLE[status]}>${STATUS_LABEL[status]}</span>`;
}

export function Badge({ children, kind = 'muted', title }) {
  return html`<span class=${'badge badge-' + kind} title=${title}>${children}</span>`;
}

export function Spinner({ label }) {
  return html`<div class="spinner-wrap"><div class="spinner"></div>${label && html`<span>${label}</span>`}</div>`;
}

/** Fenêtre modale. Avec onSubmit, le contenu est un formulaire (Entrée valide). */
export function Modal({ title, onClose, children, footer, size = 'md', onSubmit, autoFocus = true }) {
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', h);
    const first =
      ref.current?.querySelector('.modal-body input:not([type=checkbox]):not([type=radio]):not([disabled]), .modal-body select, .modal-body textarea') ||
      ref.current?.querySelector('button[type=submit]');
    if (autoFocus) setTimeout(() => first?.focus(), 30);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const inner = html`
    <header class="modal-head">
      <h2>${title}</h2>
      <${IconButton} icon="x" title="Fermer" onClick=${onClose} />
    </header>
    <div class="modal-body">${children}</div>
    ${footer && html`<footer class="modal-foot">${footer}</footer>`}
  `;
  return html`<div class="modal-backdrop">
    ${onSubmit
      ? html`<form
          ref=${ref}
          class=${'modal modal-' + size}
          role="dialog"
          aria-modal="true"
          onSubmit=${(e) => {
            e.preventDefault();
            onSubmit(e);
          }}
        >
          ${inner}
        </form>`
      : html`<div ref=${ref} class=${'modal modal-' + size} role="dialog" aria-modal="true">${inner}</div>`}
  </div>`;
}

/** Saisie d'une heure (hh:mm:ss). La valeur est transmise dès qu'elle est valide. */
export function TimeInput({ value, onChange, placeholder = 'hh:mm:ss', class: cls = '', ...rest }) {
  const [text, setText] = useState(value == null ? '' : fmtClock(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : fmtClock(value));
  }, [value]);
  return html`<input
    class=${`input mono ${bad ? 'invalid' : ''} ${cls}`}
    value=${text}
    placeholder=${placeholder}
    inputmode="numeric"
    onInput=${(e) => {
      const t = e.target.value;
      setText(t);
      setBad(false);
      const v = parseClock(t);
      if (!Number.isNaN(v)) onChange(v);
    }}
    onFocus=${() => (focused.current = true)}
    onBlur=${() => {
      focused.current = false;
      const v = parseClock(text);
      if (Number.isNaN(v)) setBad(true);
      else setText(v == null ? '' : fmtClock(v));
    }}
    ...${rest}
  />`;
}

export function SearchInput({ value, onInput, placeholder = 'Rechercher…', autoFocus }) {
  return html`<div class="search">
    <${Icon} name="search" size=${16} />
    <input class="input" type="search" value=${value} placeholder=${placeholder} autoFocus=${autoFocus} onInput=${(e) => onInput(e.target.value)} />
  </div>`;
}

export function Toggle({ checked, onChange, label, title }) {
  return html`<label class="toggle" title=${title}>
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span class="toggle-track"><span class="toggle-thumb"></span></span>
    <span>${label}</span>
  </label>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="tablist">
    ${options.map(
      (o) => html`<button type="button" role="tab" aria-selected=${o.value === value} class=${o.value === value ? 'active' : ''} onClick=${() => onChange(o.value)}>
        ${o.icon && html`<${Icon} name=${o.icon} size=${15} />`}${o.label}
      </button>`
    )}
  </div>`;
}

/** Menu déroulant : items = [{label, icon, onClick, danger}] */
export function Menu({ label, icon = 'chevronDown', items, variant = 'secondary', small, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return html`<div class="menu" ref=${ref}>
    <button type="button" class=${`btn btn-${variant}${small ? ' btn-sm' : ''}`} onClick=${() => setOpen(!open)} aria-expanded=${open}>
      <span>${label}</span><${Icon} name=${icon} size=${15} />
    </button>
    ${open &&
    html`<div class=${'menu-pop menu-' + align}>
      ${items.filter(Boolean).map((it) =>
        it.separator
          ? html`<div class="menu-sep"></div>`
          : html`<button
              type="button"
              class=${'menu-item' + (it.danger ? ' danger' : '')}
              onClick=${() => {
                setOpen(false);
                it.onClick();
              }}
            >
              ${it.icon && html`<${Icon} name=${it.icon} size=${16} />`}<span>${it.label}</span>
            </button>`
      )}
    </div>`}
  </div>`;
}

export function Stat({ label, value, kind = '', icon, onClick, hint }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${`stat ${kind ? 'stat-' + kind : ''} ${onClick ? 'clickable' : ''}`} onClick=${onClick}>
    <div class="stat-top">${icon && html`<${Icon} name=${icon} size=${16} />`}<span>${label}</span></div>
    <div class="stat-value">${value}</div>
    ${hint && html`<div class="stat-hint">${hint}</div>`}
  <//>`;
}

// --- Notifications ---------------------------------------------------------------------
export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(
    () =>
      bus.on('toast', (t) => {
        const id = Math.random();
        setToasts((list) => [...list.slice(-4), { ...t, id }]);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.duration || (t.kind === 'error' ? 8000 : 4500));
      }),
    []
  );
  const icons = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map(
      (t) => html`<div class=${'toast toast-' + t.kind} key=${t.id}>
        <${Icon} name=${icons[t.kind] || 'info'} size=${17} />
        <span>${t.message}</span>
        <button class="toast-x" onClick=${() => setToasts((l) => l.filter((x) => x.id !== t.id))} aria-label="Fermer">×</button>
      </div>`
    )}
  </div>`;
}

export function DialogHost() {
  const [dlg, setDlg] = useState(null);
  useEffect(() => bus.on('confirm', (d) => setDlg(d)), []);
  if (!dlg) return null;
  const close = (v) => {
    dlg.resolve(v);
    setDlg(null);
  };
  return html`<${Modal}
    title=${dlg.title}
    size="sm"
    onClose=${() => close(false)}
    onSubmit=${() => close(true)}
    footer=${html`<${Button} onClick=${() => close(false)}>Annuler</${Button}>
      <${Button} type="submit" variant=${dlg.danger ? 'danger' : 'primary'}>${dlg.confirmLabel}</${Button}>`}
  >
    <p class="confirm-text">${dlg.message}</p>
  <//>`;
}
