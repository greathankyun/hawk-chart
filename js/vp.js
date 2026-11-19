// Visible-range volume profile drawn on its own canvas over the price pane:
// up/down volume per price row, point of control (POC) and value area.
export function initVolumeProfile(app) {
  const wrap = document.querySelector('.chart-wrap');
  const cv = document.createElement('canvas');
  cv.className = 'vp-canvas';
  wrap.insertBefore(cv, document.getElementById('overlay'));
  const ctx = cv.getContext('2d');

  function render() {
    requestAnimationFrame(render);
    const ind = app.S.indicators.find(x => x.type === 'VP' && !x.hidden);
    const cw = wrap.clientWidth, ch = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const bars = app.bars, chart = app.chart, ms = app.mainSeries;
    if (!ind || !bars.length || !ms) return;
    let w, h;
    try { w = chart.timeScale().width(); h = chart.paneSize(0).height; } catch { return; }
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    const from = Math.max(0, Math.floor(r.from)), to = Math.min(bars.length - 1, Math.ceil(r.to));
    if (to <= from) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i <= to; i++) { lo = Math.min(lo, bars[i].low); hi = Math.max(hi, bars[i].high); }
    if (!(hi > lo)) return;
    const rows = Math.max(6, Math.min(200, Math.round(ind.p?.rows || 30)));
    const step = (hi - lo) / rows;
    const upV = new Array(rows).fill(0), dnV = new Array(rows).fill(0);
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      const a = Math.max(0, Math.floor((b.low - lo) / step)), z = Math.min(rows - 1, Math.floor((b.high - lo) / step));
      const share = b.volume / (z - a + 1);
      for (let k = a; k <= z; k++) (b.close >= b.open ? upV : dnV)[k] += share;
    }
    const tot = upV.map((u, k) => u + dnV[k]);
    const max = Math.max(...tot);
    if (!max) return;
    let poc = tot.indexOf(max);
    // value area: expand from POC until va% of volume
    const all = tot.reduce((a, b) => a + b, 0), target = all * ((ind.p?.va || 70) / 100);
    let vaLo = poc, vaHi = poc, acc = tot[poc];
    while (acc < target && (vaLo > 0 || vaHi < rows - 1)) {
      const nlo = vaLo > 0 ? tot[vaLo - 1] : -1, nhi = vaHi < rows - 1 ? tot[vaHi + 1] : -1;
      if (nhi >= nlo) acc += tot[++vaHi]; else acc += tot[--vaLo];
    }
    const { up, down } = app.upDown();
    const maxW = w * 0.28;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    for (let k = 0; k < rows; k++) {
      const y1 = ms.priceToCoordinate(lo + (k + 1) * step), y0 = ms.priceToCoordinate(lo + k * step);
      if (y1 == null || y0 == null) continue;
      const hh = Math.max(1, Math.abs(y0 - y1) - 1), y = Math.min(y0, y1);
      const inVA = k >= vaLo && k <= vaHi;
      const wu = (upV[k] / max) * maxW, wd = (dnV[k] / max) * maxW;
      ctx.globalAlpha = inVA ? 0.42 : 0.2;
      ctx.fillStyle = up; ctx.fillRect(w - wu - wd, y, wu, hh);
      ctx.fillStyle = down; ctx.fillRect(w - wd, y, wd, hh);
    }
    ctx.globalAlpha = 1;
    const py = ms.priceToCoordinate(lo + (poc + 0.5) * step);
    if (py != null) {
      ctx.strokeStyle = ind.color || '#f5a524'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(w - maxW * 1.1, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.fillStyle = ind.color || '#f5a524'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('POC ' + app.fmt(lo + (poc + 0.5) * step), w - maxW * 1.1 - 4, py - 2);
    }
    for (const k of [vaLo, vaHi + 1]) {
      const y = ms.priceToCoordinate(lo + k * step);
      if (y == null) continue;
      ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w - maxW, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }
  requestAnimationFrame(render);
}
