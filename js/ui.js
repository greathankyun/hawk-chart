// Small DOM helpers shared by the feature modules.
export const $ = s => document.querySelector(s);
export function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Create (once) a modal with the app's standard structure. Returns { modal, body, head, open }.
export function makeModal(app, id, title, size = '') {
  let m = document.getElementById(id);
  if (!m) {
    m = el('div', 'modal'); m.id = id; m.hidden = true;
    m.innerHTML = `<div class="modal-card ${size}"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close title="關閉">✕</button></div><div class="mbody"></div></div>`;
    document.body.append(m);
    app.bindModal(m);
  }
  const body = m.querySelector('.mbody');
  return { modal: m, body, head: m.querySelector('.modal-head'), open: () => { app.closeModals(); m.hidden = false; } };
}

// Build a <select> from [[value, label], ...]
export function select(options, value, onchange) {
  const s = el('select');
  for (const [v, l] of options) s.append(new Option(l, v));
  if (value != null) s.value = value;
  if (onchange) s.onchange = () => onchange(s.value);
  return s;
}
export function numInput(value, onchange, { step = 'any', min, width } = {}) {
  const i = el('input'); i.type = 'number'; i.step = step; if (min != null) i.min = min; i.value = value;
  i.inputMode = 'decimal';
  if (width) i.style.width = width;
  if (onchange) i.onchange = () => onchange(parseFloat(i.value));
  return i;
}
export const uid = () => Math.random().toString(36).slice(2, 10);
export function download(name, text, type = 'application/json') {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function pickFile(accept = '.json,application/json') {
  return new Promise(res => {
    const i = el('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); };
    i.click();
  });
}
