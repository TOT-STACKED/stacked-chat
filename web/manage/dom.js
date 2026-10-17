// Tiny DOM helpers. Everything user-supplied goes in as TEXT (never innerHTML), so names and
// emails can never inject markup.
// Element.append / prepend turn an empty value into the WORDS "null" / "false" / "undefined" on the page. Screens build
// optional pieces like `note ? h(...) : null`, so make every append and prepend (all three apps load this file) skip empties.
for (const method of ['append', 'prepend']) {
  const native = Element.prototype[method];
  Element.prototype[method] = function (...nodes) { return native.apply(this, nodes.filter((n) => n != null && n !== false)); };
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') el.style.cssText = v; // via the style API: allowed under our strict content policy
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (v) el[k] = true; }
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/** Open a dialog. `build(close)` returns the body nodes. Esc or a click outside closes it. */
export function modal(title, build) {
  const root = document.getElementById('modal-root');
  const prev = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dlghead' }, h('h2', { text: title }), h('button', { class: 'xbtn', 'aria-label': 'Close', onclick: () => close() }, '×')), build(close));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.append(dlg); root.append(overlay);
  document.addEventListener('keydown', onKey);
  const first = dlg.querySelector('input,select,textarea') || dlg.querySelector('button');
  if (first) first.focus();
  return close;
}
