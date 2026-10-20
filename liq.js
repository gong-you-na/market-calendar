/* WizView 비트코인 청산맵 — data/liq.json(격자: 시간×가격, 추정 청산 밀집도)을 캔버스에 그림.
   사용: new LiqMap(canvas, tipEl, data, {days:3}); .set({days}); .update(data); .draw() */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v, d = 0) => Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + Math.round(v);
  // Coinglass 계열 컬러맵: 짙은 남보라 → 파랑 → 청록 → 초록 → 노랑
  const STOPS = [[0, [20, 16, 52]], [0.18, [40, 44, 140]], [0.4, [26, 120, 190]], [0.62, [40, 190, 140]], [0.82, [170, 220, 60]], [1, [255, 240, 80]]];
  const LUT = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let k = 0; k < STOPS.length - 1; k++) if (t >= STOPS[k][0] && t <= STOPS[k + 1][0]) { a = STOPS[k]; b = STOPS[k + 1]; break; }
    const u = (t - a[0]) / ((b[0] - a[0]) || 1);
    LUT[i] = a[1].map((c, j) => Math.round(c + (b[1][j] - c) * u));
  }
  function decode(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

  class LiqMap {
    constructor(canvas, tip, data, opts = {}) {
      this.cv = canvas; this.ctx = canvas.getContext("2d"); this.tip = tip; this.opts = Object.assign({ days: 3 }, opts);
      this.update(data);
      this.hover = null;
      canvas.addEventListener("mousemove", (e) => this.onMove(e));
      canvas.addEventListener("mouseleave", () => { this.hover = null; this.tip.style.display = "none"; this.draw(); });
      window.addEventListener("resize", () => { clearTimeout(this._t); this._t = setTimeout(() => this.draw(), 120); });
    }
    update(data) { this.d = data; this.g = data.grid; this.cells = decode(this.g.b64); this.draw(); }
    set(o) { Object.assign(this.opts, o); this.draw(); }
    dark() { const r = document.documentElement.getAttribute("data-theme"); return r === "dark" || (!r && matchMedia("(prefers-color-scheme: dark)").matches); }
    layout() {
      const W = this.cv.parentElement.clientWidth || 800, H = this.cv.parentElement.clientHeight || 440;
      const dpr = window.devicePixelRatio || 1;
      if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.cv.style.width = W + "px"; this.cv.style.height = H + "px"; }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const PL = 8, PR = 72, PT = 10, PB = 26;
      const cols = this.g.cols, nVis = Math.min(cols, Math.round(this.opts.days * 86400 / this.g.dt));
      const c0 = cols - nVis;
      const cds = this.d.candles.slice(c0);
      let lo = Infinity, hi = -Infinity; for (const c of cds) { lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); }
      const pad = (hi - lo) * 0.18 || hi * 0.02; lo -= pad; hi += pad;
      return { W, H, PL, PR, PT, PB, c0, nVis, lo, hi, x: (i) => PL + (W - PL - PR) * ((i - c0) / nVis), cw: (W - PL - PR) / nVis, y: (p) => PT + (H - PT - PB) * (1 - (p - lo) / (hi - lo)) };
    }
    draw() {
      if (!this.d) return;
      const L = this.layout(), ctx = this.ctx, g = this.g, dark = this.dark();
      this.L = L;
      ctx.clearRect(0, 0, L.W, L.H);
      ctx.fillStyle = dark ? "#0f1020" : "#f3f1ec"; ctx.fillRect(L.PL, L.PT, L.W - L.PL - L.PR, L.H - L.PT - L.PB);
      // 격자: 보이는 가격 구간만. 행 높이(px)만큼 셀 병합 없이 그대로 그림
      const bLo = Math.max(0, Math.floor((L.lo - g.p0) / g.dp)), bHi = Math.min(g.bins - 1, Math.ceil((L.hi - g.p0) / g.dp));
      const rowH = (L.H - L.PT - L.PB) / ((L.hi - L.lo) / g.dp);
      const bg = dark ? [15, 16, 32] : [243, 241, 236];
      for (let i = L.c0; i < g.cols; i++) {
        const x = L.x(i), w = Math.max(1, L.cw + 0.6);
        const row = i * g.bins;
        for (let b = bLo; b <= bHi; b++) {
          const v = this.cells[row + b]; if (!v) continue;
          const c = LUT[v]; const a = 0.12 + 0.88 * Math.pow(v / 255, 1.6);
          ctx.fillStyle = `rgb(${Math.round(bg[0] + (c[0] - bg[0]) * a)},${Math.round(bg[1] + (c[1] - bg[1]) * a)},${Math.round(bg[2] + (c[2] - bg[2]) * a)})`;
          const y = L.y(g.p0 + (b + 1) * g.dp);
          ctx.fillRect(x, y, w, Math.max(1, rowH + 0.6));
        }
      }
      // 가격선
      ctx.beginPath(); ctx.lineWidth = 1.8; ctx.strokeStyle = dark ? "#ffffff" : "#191F28"; ctx.lineJoin = "round";
      this.d.candles.forEach((c, i) => { if (i < L.c0) return; const x = L.x(i) + L.cw / 2, y = L.y(c[4]); i === L.c0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
      // 현재가 점선 + 라벨
      const px = this.d.price, ypx = L.y(px);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = "#D4AE5A"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L.PL, ypx); ctx.lineTo(L.W - L.PR, ypx); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#B8923A"; ctx.fillRect(L.W - L.PR + 2, ypx - 9, L.PR - 4, 18);
      ctx.fillStyle = "#fff"; ctx.font = "700 11px Pretendard, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$" + fmt(px), L.W - L.PR / 2, ypx);
      // 가격 축
      ctx.fillStyle = dark ? "#8B919B" : "#6B7684"; ctx.font = "600 10.5px Pretendard, sans-serif"; ctx.textAlign = "left";
      const step = niceStep((L.hi - L.lo) / 7);
      for (let p = Math.ceil(L.lo / step) * step; p < L.hi; p += step) {
        const y = L.y(p); if (Math.abs(y - ypx) < 10) continue;
        ctx.fillText("$" + fmt(p), L.W - L.PR + 6, y);
        ctx.strokeStyle = dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.06)"; ctx.beginPath(); ctx.moveTo(L.PL, y); ctx.lineTo(L.W - L.PR, y); ctx.stroke();
      }
      // 시간 축(KST)
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const n = L.nVis, every = n > 400 ? 96 : n > 200 ? 48 : n > 100 ? 24 : 8; // 15분 단위 → 24h/12h/6h/2h
      for (let i = L.c0; i < g.cols; i++) {
        const t = this.d.candles[i][0]; const kst = new Date(t * 1000);
        const m = Math.round(((t + 9 * 3600) % 86400) / g.dt);
        if (m % every !== 0) continue;
        const h = kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
        const lb = (m === 0) ? kst.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).replace(/\s/g, "").replace(/\.$/, "") : h;
        ctx.fillStyle = dark ? "#8B919B" : "#6B7684"; ctx.fillText(lb, L.x(i), L.H - 8);
        ctx.strokeStyle = dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.06)"; ctx.beginPath(); ctx.moveTo(L.x(i), L.PT); ctx.lineTo(L.x(i), L.H - L.PB); ctx.stroke();
      }
      // 호버 십자선
      if (this.hover) {
        const { i, b } = this.hover; const x = L.x(i) + L.cw / 2, y = L.y(g.p0 + (b + 0.5) * g.dp);
        ctx.strokeStyle = dark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.4)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, L.PT); ctx.lineTo(x, L.H - L.PB); ctx.moveTo(L.PL, y); ctx.lineTo(L.W - L.PR, y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    onMove(e) {
      const L = this.L; if (!L) return;
      const r = this.cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < L.PL || mx > L.W - L.PR || my < L.PT || my > L.H - L.PB) { this.hover = null; this.tip.style.display = "none"; this.draw(); return; }
      const i = Math.min(this.g.cols - 1, L.c0 + Math.floor((mx - L.PL) / L.cw));
      const p = L.lo + (L.hi - L.lo) * (1 - (my - L.PT) / (L.H - L.PT - L.PB));
      const b = Math.max(0, Math.min(this.g.bins - 1, Math.floor((p - this.g.p0) / this.g.dp)));
      this.hover = { i, b }; this.draw();
      const v = this.cells[i * this.g.bins + b]; const est = v ? Math.pow(v / 255, 1 / (this.g.gamma || 0.55)) * this.g.max_usd : 0;
      const c = this.d.candles[i]; const t = new Date(c[0] * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
      const pl = this.g.p0 + b * this.g.dp, ph = pl + this.g.dp;
      this.tip.innerHTML = `<div class="lt-h">${esc(t)} KST</div><div class="lt-r"><span>가격 구간</span><b>$${fmt(pl)}–${fmt(ph)}</b></div><div class="lt-r"><span>추정 청산 물량</span><b>${est > 0 ? usd(est) : "—"}</b></div><div class="lt-r"><span>BTC 종가</span><b>$${fmt(c[4])}</b></div>`;
      this.tip.style.display = "block";
      let tx = mx + 14, ty = my + 14; if (tx + 230 > L.W) tx = mx - 240; if (ty + 110 > L.H) ty = my - 120;
      this.tip.style.left = tx + "px"; this.tip.style.top = ty + "px";
    }
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  window.LiqMap = LiqMap;
  window.liqFmt = { usd, fmt };
})();
