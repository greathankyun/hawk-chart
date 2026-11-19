// Drawing tools rendered on a canvas overlay above the main price pane.
// Points are stored as {t: utc seconds of a bar, p: price}; positions beyond the
// last bar are extrapolated with the interval length so lines can extend into the future.

export const TOOLS = [
  { k: 'cursor', name: '游標', icon: 'M5 3l13 7-6 1.6L9.6 18z' },
  { sep: true },
  { k: 'trend', name: '趨勢線', icon: 'M4 19L19 5l1.4 1.4L5.4 20.4z M3 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M17 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { k: 'ray', name: '射線', icon: 'M4 18L21 4.5l.9 1.2L5 19.4z M3 18a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0' },
  { k: 'extended', name: '延伸線', icon: 'M2 20.5L21.5 3l.9 1.1L3 21.6z M8 15.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M13 11a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { k: 'hline', name: '水平線', icon: 'M2 11h20v2H2z M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { k: 'vline', name: '垂直線', icon: 'M11 2h2v20h-2z M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { k: 'rect', name: '矩形', icon: 'M4 6h16v12H4zm2 2v8h12V8z' },
  { k: 'fib', name: '費波那契回撤', icon: 'M3 4h18v1.6H3zm0 4.6h18v1.6H3zm0 4.6h18v1.6H3zm0 4.6h18V20H3z' },
  { k: 'measure', name: '測量', icon: 'M3 17.6L17.6 3 21 6.4 6.4 21zM6.2 15l1.2 1.2 1-1-1.2-1.2zm2.8-2.8 1.8 1.8 1-1L10 11.2zm2.8-2.8 1.2 1.2 1-1-1.2-1.2zm2.8-2.8 1.8 1.8 1-1-1.8-1.8z' },
  { k: 'text', name: '文字', icon: 'M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5z' },
  { sep: true },
  { k: 'magnet', name: '磁吸', toggle: true, icon: 'M6 3h4v8a2 2 0 1 0 4 0V3h4v8a6 6 0 1 1-12 0zm0 2v2h4V5zm8 0v2h4V5z' },
  { k: 'lock', name: '連續畫線', toggle: true, icon: 'M7 10V8a5 5 0 1 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z' },
  { k: 'hide', name: '隱藏畫線', toggle: true, icon: 'M2 5.3L3.3 4 20 20.7 18.7 22l-3.1-3.1A10.6 10.6 0 0 1 12 19.5C6.5 19.5 3 15 2 12c.5-1.4 1.6-3.2 3.3-4.8zM12 4.5c5.5 0 9 4.5 10 7.5-.4 1.2-1.3 2.7-2.6 4.1L16 12.7A4 4 0 0 0 11.3 8L8.9 5.1C9.9 4.7 10.9 4.5 12 4.5z' },
  { k: 'undo', name: '復原 (Ctrl+Z)', action: true, icon: 'M8 5v3.2C13.5 7.6 18.5 10 20 16c-2.2-3-5.6-4.3-12-4V15L2.5 10z' },
  { k: 'trash', name: '清除全部畫線', action: true, icon: 'M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z' },
];

export const COLORS = ['#f5a524', '#38bdf8', '#ef4444', '#10b981', '#a78bfa', '#f472b6', '#e2e8f0'];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#94a3b8', '#ef4444', '#f5a524', '#10b981', '#38bdf8', '#a78bfa', '#94a3b8'];
const TWO_POINT = new Set(['trend', 'ray', 'extended', 'rect', 'fib', 'measure']);

export class Drawings {
  constructor(o) {
    Object.assign(this, o); // chart, getSeries, overlay, container, getBars, getSec, fmt, onSelect, askText, onToolChange
    this.items = [];
    this.tool = 'cursor';
    this.selected = null;
    this.pending = null;   // drawing being created
    this.hover = null;     // pointer pos in draw mode
    this.history = [];
    this.magnet = false; this.lock = false; this.hidden = false;
    this.ctx = this.overlay.getContext('2d');
    this.bind();
    const loop = () => { this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------- persistence ----------
  key() { return 'hawk.drawings.' + this.symbol; }
  setSymbol(sym) {
    this.symbol = sym; this.selected = null; this.pending = null; this.history = [];
    try { this.items = JSON.parse(localStorage.getItem(this.key()) || '[]'); } catch { this.items = []; }
    this.onSelect(null);
  }
  save() { try { localStorage.setItem(this.key(), JSON.stringify(this.items)); } catch {} }
  snapshot() { this.history.push(JSON.stringify(this.items)); if (this.history.length > 50) this.history.shift(); }
  undo() {
    if (this.pending) { this.pending = null; return; }
    const prev = this.history.pop();
    if (prev == null) return;
    this.items = JSON.parse(prev); this.select(null); this.save();
  }
  clearAll() { if (!this.items.length) return; this.snapshot(); this.items = []; this.select(null); this.save(); }
  deleteSelected() {
    if (!this.selected) return;
    this.snapshot();
    this.items = this.items.filter(d => d !== this.selected);
    this.select(null); this.save();
  }
  setColor(c) { if (this.selected) { this.snapshot(); this.selected.color = c; this.save(); } }
  select(d) { this.selected = d; this.onSelect(d); }

  setTool(k) {
    this.tool = k; this.pending = null; this.hover = null;
    this.overlay.classList.toggle('drawing', k !== 'cursor');
    if (k !== 'cursor') this.select(null);
    this.items = this.items.filter(d => d.type !== 'measure');
    this.onToolChange(k);
  }

  // ---------- coordinate mapping ----------
  idxOf(t) {
    const b = this.getBars(); const n = b.length;
    if (!n) return 0;
    const sec = this.getSec();
    if (t >= b[n - 1].utc) return n - 1 + (t - b[n - 1].utc) / sec;
    if (t <= b[0].utc) return (t - b[0].utc) / sec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].utc <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].utc) / (b[hi].utc - b[lo].utc);
  }
  timeOf(i) {
    const b = this.getBars(); const n = b.length; const sec = this.getSec();
    if (!n) return 0;
    if (i >= n - 1) return b[n - 1].utc + Math.round(i - (n - 1)) * sec;
    if (i <= 0) return b[0].utc + Math.round(i) * sec;
    return b[Math.round(i)].utc;
  }
  xOf(t) { const c = this.chart.timeScale().logicalToCoordinate(this.idxOf(t)); return c == null ? null : c; }
  yOf(p) { const c = this.getSeries().priceToCoordinate(p); return c == null ? null : c; }
  fromXY(x, y, snap = this.magnet) {
    const lg = this.chart.timeScale().coordinateToLogical(x);
    const i = Math.round(lg ?? 0);
    let p = this.getSeries().coordinateToPrice(y);
    const bars = this.getBars();
    if (snap && bars[i]) {
      const b = bars[i];
      let best = null, bd = Infinity;
      for (const v of [b.open, b.high, b.low, b.close]) {
        const d = Math.abs(this.yOf(v) - y);
        if (d < bd) { bd = d; best = v; }
      }
      if (bd < 40) p = best;
    }
    return { t: this.timeOf(i), p };
  }
  area() {
    const w = this.chart.timeScale().width();
    const h = this.chart.paneSize(0).height;
    return { w, h };
  }

  // ---------- events ----------
  bind() {
    const ov = this.overlay, ct = this.container;
    const pos = e => { const r = ov.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    // creation (overlay captures input while a tool is active)
    ov.addEventListener('pointerdown', e => {
      if (this.tool === 'cursor') return;
      e.preventDefault();
      const { x, y } = pos(e);
      const pt = this.fromXY(x, y);
      const type = this.tool;
      if (this.pending) { // second click of a click-click line
        this.pending.points[1] = pt; this.finish(); return;
      }
      if (type === 'hline' || type === 'vline') {
        this.snapshot();
        const d = { id: uid(), type, points: [pt], color: this.lastColor || COLORS[0] };
        this.items.push(d); this.save(); this.afterCreate(d); return;
      }
      if (type === 'text') {
        this.askText('').then(txt => {
          if (!txt) return;
          this.snapshot();
          const d = { id: uid(), type, points: [pt], color: this.lastColor || COLORS[6], text: txt };
          this.items.push(d); this.save(); this.afterCreate(d);
        });
        return;
      }
      if (TWO_POINT.has(type)) {
        this.items = this.items.filter(d => d.type !== 'measure');
        this.pending = { id: uid(), type, points: [pt, { ...pt }], color: type === 'measure' ? null : (this.lastColor || COLORS[0]), downX: x, downY: y, dragging: true };
        ov.setPointerCapture(e.pointerId);
      }
    });
    ov.addEventListener('pointermove', e => {
      if (this.tool === 'cursor') return;
      const { x, y } = pos(e);
      this.hover = { x, y };
      if (this.pending) this.pending.points[1] = this.fromXY(x, y);
    });
    ov.addEventListener('pointerup', e => {
      if (!this.pending || !this.pending.dragging) return;
      const { x, y } = pos(e);
      this.pending.dragging = false;
      if (Math.hypot(x - this.pending.downX, y - this.pending.downY) > 6) this.finish();
      // else: wait for a second click
    });
    ov.addEventListener('pointerleave', () => { this.hover = null; });

    // selection & dragging in cursor mode (capture so we act before the chart pans)
    let drag = null;
    ct.addEventListener('pointerdown', e => {
      if (this.tool !== 'cursor' || this.hidden || e.button > 0) return;
      const { x, y } = pos(e);
      const hit = this.hitTest(x, y, e.pointerType === 'touch' ? 14 : 7);
      if (!hit) { if (this.selected) this.select(null); return; }
      this.select(hit.d);
      this.chart.applyOptions({ handleScroll: false, handleScale: false });
      const lg = this.chart.timeScale().coordinateToLogical(x) ?? 0;
      drag = {
        d: hit.d, handle: hit.handle, startLg: lg, startP: this.getSeries().coordinateToPrice(y),
        orig: hit.d.points.map(p => ({ i: this.idxOf(p.t), p: p.p })), moved: false,
      };
      this.snapshot();
    }, true);
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      const { x, y } = pos(e);
      drag.moved = true;
      if (drag.handle != null) {
        const pt = this.fromXY(x, y);
        drag.d.points[drag.handle] = pt;
      } else {
        const lg = this.chart.timeScale().coordinateToLogical(x) ?? drag.startLg;
        const dl = Math.round(lg - drag.startLg);
        const dp = this.getSeries().coordinateToPrice(y) - drag.startP;
        drag.d.points = drag.orig.map(o => ({ t: this.timeOf(Math.round(o.i) + dl), p: o.p + dp }));
      }
    });
    const end = () => {
      if (!drag) return;
      if (!drag.moved) this.history.pop();
      drag = null;
      this.chart.applyOptions({ handleScroll: true, handleScale: true });
      this.save();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    // hover cursor feedback
    ct.addEventListener('pointermove', e => {
      if (this.tool !== 'cursor' || drag || e.pointerType === 'touch') return;
      const { x, y } = pos(e);
      const hit = this.hidden ? null : this.hitTest(x, y, 7);
      ct.style.cursor = hit ? (hit.handle != null ? 'grab' : 'move') : '';
      ct.querySelectorAll('canvas').forEach(c => { if (c !== ov) c.style.cursor = hit ? 'inherit' : ''; });
    });
  }

  finish() {
    const d = this.pending; this.pending = null;
    delete d.downX; delete d.downY; delete d.dragging;
    if (d.type !== 'measure') this.snapshot();
    this.items.push(d);
    if (d.type !== 'measure') this.save();
    this.afterCreate(d);
  }
  afterCreate(d) {
    if (d.type === 'measure') { this.tool = 'cursor'; this.overlay.classList.remove('drawing'); this.onToolChange('cursor'); return; }
    if (!this.lock) this.setTool('cursor');
    this.select(d);
  }

  // ---------- hit testing ----------
  hitTest(x, y, tol) {
    const { w, h } = this.area();
    if (x > w || y > h) return null;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const d = this.items[k];
      if (d.type === 'measure') continue;
      const pts = d.points.map(p => ({ x: this.xOf(p.t), y: this.yOf(p.p) }));
      if (pts.some(p => p.x == null || p.y == null)) continue;
      for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= tol + 3) return { d, handle: d.type === 'hline' || d.type === 'vline' ? null : i };
      const [a, b] = pts;
      let hit = false;
      switch (d.type) {
        case 'trend': hit = segDist(x, y, a, b) <= tol; break;
        case 'ray': hit = segDist(x, y, a, extend(a, b, w, h, false)) <= tol; break;
        case 'extended': { const e1 = extend(b, a, w, h, false), e2 = extend(a, b, w, h, false); hit = segDist(x, y, e1, e2) <= tol; break; }
        case 'hline': hit = Math.abs(y - a.y) <= tol; break;
        case 'vline': hit = Math.abs(x - a.x) <= tol; break;
        case 'rect': hit = x >= Math.min(a.x, b.x) - tol && x <= Math.max(a.x, b.x) + tol && y >= Math.min(a.y, b.y) - tol && y <= Math.max(a.y, b.y) + tol; break;
        case 'fib': {
          const x1 = Math.min(a.x, b.x);
          if (x >= x1 - tol) for (const f of FIB) { const fy = a.y + (b.y - a.y) * (1 - f); if (Math.abs(y - fy) <= tol) { hit = true; break; } }
          break;
        }
        case 'text': { this.ctx.font = '13px sans-serif'; const tw = this.ctx.measureText(d.text).width; hit = x >= a.x - 4 && x <= a.x + tw + 8 && y >= a.y - 18 && y <= a.y + 4; break; }
      }
      if (hit) return { d, handle: null };
    }
    return null;
  }

  // ---------- rendering ----------
  render() {
    const ov = this.overlay, ctx = this.ctx;
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (ov.width !== Math.round(cw * dpr) || ov.height !== Math.round(ch * dpr)) {
      ov.width = Math.round(cw * dpr); ov.height = Math.round(ch * dpr);
      ov.style.width = cw + 'px'; ov.style.height = ch + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!this.getBars().length) return;
    let w, h;
    try { ({ w, h } = this.area()); } catch { return; }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const list = this.hidden ? this.items.filter(d => d.type === 'measure') : this.items;
    for (const d of list) this.drawOne(d, w, h, d === this.selected);
    if (this.pending) this.drawOne(this.pending, w, h, true);
    if (this.tool !== 'cursor' && this.hover) {
      ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hover.x + .5, 0); ctx.lineTo(this.hover.x + .5, h); ctx.moveTo(0, this.hover.y + .5); ctx.lineTo(w, this.hover.y + .5); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawOne(d, w, h, sel) {
    const ctx = this.ctx;
    const pts = d.points.map(p => ({ x: this.xOf(p.t), y: this.yOf(p.p) }));
    if (pts.some(p => p.x == null || p.y == null)) return;
    const [a, b] = pts;
    const col = d.color || COLORS[0];
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2 : 1.5; ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
    const line = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    switch (d.type) {
      case 'trend': line(a, b); break;
      case 'ray': line(a, extend(a, b, w, h, true)); break;
      case 'extended': line(extend(b, a, w, h, true), extend(a, b, w, h, true)); break;
      case 'hline':
        line({ x: 0, y: a.y }, { x: w, y: a.y });
        this.tag(this.fmt(d.points[0].p), w - 4, a.y, col, 'right');
        break;
      case 'vline': line({ x: a.x, y: 0 }, { x: a.x, y: h }); break;
      case 'rect':
        ctx.globalAlpha = 0.12; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.globalAlpha = 1; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        break;
      case 'fib': {
        const x1 = Math.min(a.x, b.x);
        const p1 = d.points[0].p, p2 = d.points[1].p;
        ctx.save(); ctx.setLineDash([]);
        FIB.forEach((f, i) => {
          const price = p2 + (p1 - p2) * f;
          const y = this.yOf(price);
          if (i < FIB.length - 1) {
            const yn = this.yOf(p2 + (p1 - p2) * FIB[i + 1]);
            ctx.globalAlpha = 0.07; ctx.fillStyle = FIB_COLORS[i]; ctx.fillRect(x1, Math.min(y, yn), w - x1, Math.abs(yn - y));
          }
          ctx.globalAlpha = 1; ctx.strokeStyle = FIB_COLORS[i]; ctx.lineWidth = 1;
          line({ x: x1, y }, { x: w, y });
          ctx.fillStyle = FIB_COLORS[i]; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(`${f} (${this.fmt(price)})`, x1 + 4, y - 2);
        });
        ctx.restore();
        ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; line(a, b); ctx.setLineDash([]);
        break;
      }
      case 'text': {
        ctx.font = '13px -apple-system, "Segoe UI", "PingFang TC", sans-serif';
        const tw = ctx.measureText(d.text).width;
        ctx.globalAlpha = .85; ctx.fillStyle = 'rgba(15,23,42,.8)'; roundRect(ctx, a.x - 4, a.y - 18, tw + 12, 22, 5); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(d.text, a.x + 2, a.y - 7);
        if (sel) { ctx.strokeStyle = col; roundRect(ctx, a.x - 4, a.y - 18, tw + 12, 22, 5); ctx.stroke(); }
        return;
      }
      case 'measure': {
        const p1 = d.points[0].p, p2 = d.points[1].p;
        const up = p2 >= p1;
        const c = up ? 'rgba(56,189,248,' : 'rgba(239,68,68,';
        ctx.fillStyle = c + '.15)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = c + '.9)'; ctx.lineWidth = 1;
        line({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
        line({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
        const bars = Math.round(this.idxOf(d.points[1].t) - this.idxOf(d.points[0].t));
        const txt = `${up ? '+' : ''}${this.fmt(p2 - p1)}  (${up ? '+' : ''}${((p2 / p1 - 1) * 100).toFixed(2)}%)  ${bars} 根 · ${durText(Math.abs(d.points[1].t - d.points[0].t))}`;
        ctx.font = '12px -apple-system, "Segoe UI", "PingFang TC", sans-serif';
        const tw = ctx.measureText(txt).width;
        const bx = (a.x + b.x) / 2 - tw / 2 - 8, by = (up ? Math.min(a.y, b.y) - 30 : Math.max(a.y, b.y) + 6);
        ctx.fillStyle = c + '.95)'; roundRect(ctx, bx, by, tw + 16, 24, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 8, by + 12);
        return;
      }
    }
    if (sel) for (const p of (d.type === 'hline' || d.type === 'vline') ? [] : pts) {
      ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  tag(text, x, y, col, align) {
    const ctx = this.ctx;
    const tw = ctx.measureText(text).width;
    const bx = align === 'right' ? x - tw - 10 : x;
    ctx.fillStyle = col; roundRect(ctx, bx, y - 9, tw + 10, 18, 4); ctx.fill();
    ctx.fillStyle = '#0b1220'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 5, y);
  }
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - a.x) * dx + (py - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
// Point far along the a→b direction (beyond the visible area).
function extend(a, b, w, h) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return b;
  const k = (w + h) * 4 / Math.hypot(dx, dy);
  return { x: a.x + dx * k, y: a.y + dy * k };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function durText(s) {
  if (s >= 86400) return (s / 86400).toFixed(s % 86400 ? 1 : 0) + ' 天';
  if (s >= 3600) return (s / 3600).toFixed(s % 3600 ? 1 : 0) + ' 小時';
  return Math.round(s / 60) + ' 分';
}
