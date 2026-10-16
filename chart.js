/* WizView 엑스레이 차트 — 증권사식 캔들 + 거래량 + MA + 크로스헤어 + 매물대(우측) + 옵션 OI 벽
   사용: new XrayChart(canvasEl, data, opts).  data = xray.json의 symbols[sym] */
(function () {
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (v, d = 2) => Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtK = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(Math.round(v));
  const dstr = (t) => { const d = new Date(t * 1000); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };

  class XrayChart {
    constructor(canvas, data, opts = {}) {
      this.cv = canvas; this.ctx = canvas.getContext("2d"); this.data = data;
      this.opts = Object.assign({ months: 6, profile: "v60", options: "all", showMA: { 20: true, 50: true, 200: true }, showOI: true, showProfile: true }, opts);
      this.hover = null;
      this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas.parentElement);
      canvas.addEventListener("mousemove", (e) => { const r = canvas.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.draw(); });
      canvas.addEventListener("mouseleave", () => { this.hover = null; this.draw(); });
      canvas.addEventListener("touchstart", (e) => { const t = e.touches[0], r = canvas.getBoundingClientRect(); this.hover = { x: t.clientX - r.left, y: t.clientY - r.top }; this.draw(); }, { passive: true });
      canvas.addEventListener("touchmove", (e) => { const t = e.touches[0], r = canvas.getBoundingClientRect(); this.hover = { x: t.clientX - r.left, y: t.clientY - r.top }; this.draw(); }, { passive: true });
      this.draw();
    }
    set(o) { Object.assign(this.opts, o); this.draw(); }
    update(data) { this.data = data; this.draw(); }

    draw() {
      const cv = this.cv, ctx = this.ctx, d = this.data, o = this.opts;
      const W = cv.parentElement.clientWidth, H = cv.parentElement.clientHeight || 420;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const C = { bg: css("--card"), grid: css("--line"), ink: css("--ink"), grey: css("--grey2"), grey3: css("--grey3"), up: css("--up"), down: css("--down"), gold: css("--gold"), goldDeep: css("--gold-deep"), ma20: "#7B61FF", ma50: css("--gold"), ma200: css("--grey") };
      const mobile = W < 640;
      const PL = 8, PR_axis = 58, PR_prof = (o.showProfile || o.showOI) ? (mobile ? 90 : 150) : 0, PT = 10, PB_time = 22, VOLH = Math.round(H * 0.16);
      const x0 = PL, x1 = W - PR_axis - PR_prof, px1 = W - PR_axis;
      const priceH = H - PT - PB_time - VOLH - 6, py0 = PT, py1 = PT + priceH, vy0 = py1 + 6, vy1 = vy0 + VOLH;

      // 기간 자르기
      const n = Math.min(d.candles.length, Math.round(o.months * 21));
      const start = d.candles.length - n, candles = d.candles.slice(start);
      const maSeries = {}; for (const k of ["20", "50", "200"]) maSeries[k] = (d.ma[k] || []).slice(start);
      let lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h));
      for (const k in maSeries) if (o.showMA[k]) for (const v of maSeries[k]) if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      const Y = (p) => py1 - (p - lo) / (hi - lo) * priceH;
      const slot = (x1 - x0) / n, X = (i) => x0 + slot * (i + 0.5), bw = Math.max(1.5, Math.min(14, slot * 0.68));

      // 격자 + 가격축
      ctx.font = `${mobile ? 10 : 11}px Pretendard, sans-serif`; ctx.textBaseline = "middle";
      const ticks = niceTicks(lo, hi, 6);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (const t of ticks) { const y = Math.round(Y(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(px1, y); ctx.stroke(); ctx.fillStyle = C.grey; ctx.textAlign = "left"; ctx.fillText(fmt(t, t > 1000 ? 0 : 2), px1 + 6, y); }
      // 시간축 (월 경계)
      let lastM = -1; ctx.textAlign = "center";
      candles.forEach((c, i) => { const m = new Date(c.t * 1000).getMonth(); if (m !== lastM) { lastM = m; const x = Math.round(X(i)) + 0.5; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, vy1); ctx.stroke(); ctx.fillStyle = C.grey; ctx.fillText(`${m + 1}월`, x, vy1 + 11); } });

      // 매물대 (우측)
      if (o.showProfile && d.profile) {
        const P = d.profile, prof = P[o.profile] || P.v60, step = (P.hi - P.lo) / P.bins, mx = Math.max(...prof) || 1;
        const area = (PR_prof - 8) * (o.showOI && d.options ? 0.55 : 0.95);
        prof.forEach((v, i) => {
          const pLo = P.lo + i * step, pHi = pLo + step; if (pHi < lo || pLo > hi) return;
          const yA = Y(pHi), yB = Y(pLo), w = (v / mx) * area;
          const inVA = pLo >= P.va_lo - 1e-9 && pHi <= P.va_hi + 1e-9;
          ctx.fillStyle = inVA ? hexA(C.gold, 0.45) : hexA(C.grey3, 0.35);
          ctx.fillRect(x1 + 4, yA + 0.5, w, Math.max(1, yB - yA - 1));
        });
        // POC
        const yp = Math.round(Y(P.poc)) + 0.5;
        ctx.strokeStyle = C.goldDeep; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x0, yp); ctx.lineTo(px1, yp); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.goldDeep; ctx.textAlign = "left"; ctx.font = `700 ${mobile ? 9 : 10}px Pretendard, sans-serif`; ctx.fillText(`POC ${fmt(P.poc, 2)}`, x1 + 6, yp - 8);
        ctx.fillStyle = C.grey; ctx.textAlign = "left"; ctx.font = `600 ${mobile ? 9 : 10}px Pretendard, sans-serif`;
        ctx.fillText(`매물대 ${o.profile === "v20" ? "20일" : "60일"}`, x1 + 6, py0 + 8);
      }
      // 옵션 OI 벽 (가격축 왼쪽 라인)
      if (o.showOI && d.options) {
        const S = d.options[o.options] || d.options.all; const rows = S.rows || [];
        const mx = Math.max(...rows.map((r) => Math.max(r.c, r.p)), 1);
        const area = (PR_prof - 8) * (o.showProfile ? 0.4 : 0.9);
        ctx.fillStyle = C.grey; ctx.textAlign = "right"; ctx.font = `600 ${mobile ? 9 : 10}px Pretendard, sans-serif`; ctx.fillText("옵션 OI", px1 - 4, py0 + 8);
        for (const r of rows) {
          if (r.k < lo || r.k > hi) continue; const y = Y(r.k);
          const wc = (r.c / mx) * area, wp = (r.p / mx) * area;
          ctx.fillStyle = hexA(C.up, 0.7); ctx.fillRect(px1 - 2 - wc, y - 1.5, wc, 3);
          ctx.fillStyle = hexA(C.down, 0.7); ctx.fillRect(px1 - 2 - wp, y + 1.5, wp, 3);
        }
        for (const w of (S.walls.call || []).slice(0, 2)) { if (w.k >= lo && w.k <= hi) { const y = Math.round(Y(w.k)) + 0.5; ctx.strokeStyle = hexA(C.up, 0.6); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(px1, y); ctx.stroke(); ctx.setLineDash([]); tag(ctx, x0, y, `콜벽 ${fmt(w.k, 0)} · ${fmtK(w.oi)}`, hexA(C.up, 0.12), C.up, "right", mobile); } }
        for (const w of (S.walls.put || []).slice(0, 2)) { if (w.k >= lo && w.k <= hi) { const y = Math.round(Y(w.k)) + 0.5; ctx.strokeStyle = hexA(C.down, 0.6); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(px1, y); ctx.stroke(); ctx.setLineDash([]); tag(ctx, x0, y, `풋벽 ${fmt(w.k, 0)} · ${fmtK(w.oi)}`, hexA(C.down, 0.12), C.down, "right", mobile); } }
        if (S.maxpain && S.maxpain >= lo && S.maxpain <= hi) { const y = Math.round(Y(S.maxpain)) + 0.5; ctx.strokeStyle = C.grey3; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(px1, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.grey; ctx.textAlign = "left"; ctx.font = `600 ${mobile ? 9 : 10}px Pretendard, sans-serif`; ctx.fillText(`맥스페인 ${fmt(S.maxpain, 0)} (${S.exp})`, x0 + 4, y - 8); }
      }

      // 거래량
      const vmx = Math.max(...candles.map((c) => c.v)) || 1;
      candles.forEach((c, i) => { const h = (c.v / vmx) * VOLH; ctx.fillStyle = hexA(c.c >= c.o ? C.up : C.down, 0.35); ctx.fillRect(X(i) - bw / 2, vy1 - h, bw, h); });
      ctx.fillStyle = C.grey; ctx.textAlign = "left"; ctx.font = `600 ${mobile ? 9 : 10}px Pretendard, sans-serif`; ctx.fillText("거래량", x0 + 4, vy0 + 8);

      // 실적 마커
      if (d.earn_marks) for (const m of d.earn_marks) { const idx = candles.findIndex((c) => dstr(c.t).replace(/\./g, "-") >= m.d); if (idx < 0) continue; const x = X(idx); ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(x, vy0 - 2); ctx.lineTo(x - 4, vy0 - 9); ctx.lineTo(x + 4, vy0 - 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = C.grey; ctx.textAlign = "center"; ctx.font = `700 9px Pretendard, sans-serif`; ctx.fillText("E", x, vy0 - 14); }

      // 캔들
      candles.forEach((c, i) => {
        const x = X(i), up = c.c >= c.o, col = up ? C.up : C.down;
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 0.5, Y(c.h)); ctx.lineTo(x + 0.5, Y(c.l)); ctx.stroke();
        const yo = Y(c.o), yc = Y(c.c), top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yo - yc));
        if (up) { ctx.fillStyle = C.bg; ctx.fillRect(x - bw / 2, top, bw, hgt); ctx.strokeRect(x - bw / 2 + 0.5, top + 0.5, bw - 1, hgt - 1); } else { ctx.fillStyle = col; ctx.fillRect(x - bw / 2, top, bw, hgt); }
      });
      // 이동평균
      for (const [k, col] of [["200", C.ma200], ["50", C.ma50], ["20", C.ma20]]) {
        if (!o.showMA[k]) continue; ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); let s = false;
        maSeries[k].forEach((v, i) => { if (v == null) return; const x = X(i), y = Y(v); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }); ctx.stroke();
      }
      // 현재가 라인
      const last = candles[candles.length - 1]; const yl = Math.round(Y(last.c)) + 0.5;
      ctx.strokeStyle = last.c >= last.o ? C.up : C.down; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, yl); ctx.lineTo(px1, yl); ctx.stroke(); ctx.setLineDash([]);
      tag(ctx, px1, yl, fmt(last.c, 2), last.c >= last.o ? C.up : C.down, "#fff", "left", mobile);

      // 범례
      ctx.font = `600 ${mobile ? 9 : 10}px Pretendard, sans-serif`; ctx.textAlign = "left"; let lx = x0 + 6;
      for (const [k, col] of [["20", C.ma20], ["50", C.ma50], ["200", C.ma200]]) { if (!o.showMA[k]) continue; ctx.fillStyle = col; ctx.fillRect(lx, py0 + 4, 10, 2); ctx.fillStyle = C.grey; ctx.fillText(`MA${k}`, lx + 13, py0 + 5); lx += 44; }

      // 크로스헤어 + 툴팁
      if (this.hover && this.hover.x >= x0 && this.hover.x <= x1 && this.hover.y >= py0 && this.hover.y <= vy1) {
        const i = Math.max(0, Math.min(n - 1, Math.floor((this.hover.x - x0) / slot))), c = candles[i], x = Math.round(X(i)) + 0.5, y = Math.round(this.hover.y) + 0.5;
        ctx.strokeStyle = C.grey3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, vy1); ctx.moveTo(x0, y); ctx.lineTo(px1, y); ctx.stroke(); ctx.setLineDash([]);
        if (y <= py1) tag(ctx, px1, y, fmt(lo + (py1 - y) / priceH * (hi - lo), 2), C.ink, C.bg, "left", mobile);
        tag(ctx, x, vy1 + 11, dstr(c.t), C.ink, C.bg, "center", mobile);
        const chg = i > 0 ? (c.c / candles[i - 1].c - 1) * 100 : 0;
        const lines = [`시 ${fmt(c.o)}  고 ${fmt(c.h)}`, `저 ${fmt(c.l)}  종 ${fmt(c.c)}`, `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%  거래량 ${fmtK(c.v)}`];
        for (const k of ["20", "50", "200"]) if (o.showMA[k] && maSeries[k][i]) lines.push(`MA${k} ${fmt(maSeries[k][i])}`);
        ctx.font = `${mobile ? 10 : 11}px Pretendard, sans-serif`; const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, th = lines.length * 15 + 10;
        let bx = x + 12; if (bx + tw > x1) bx = x - 12 - tw; const by = py0 + 24;
        ctx.fillStyle = hexA(C.bg, 0.96); ctx.strokeStyle = C.grid; roundRect(ctx, bx, by, tw, th, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.ink; ctx.textAlign = "left"; lines.forEach((l, j) => { ctx.fillStyle = j === 2 ? (chg >= 0 ? C.up : C.down) : C.ink; ctx.fillText(l, bx + 8, by + 12 + j * 15); });
      }
    }
  }

  function niceTicks(lo, hi, n) { const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag; const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6)); return out; }
  function hexA(hex, a) { hex = hex.trim(); if (hex.startsWith("rgb")) return hex.replace(/rgba?\(([^)]+)\)/, (m, g) => `rgba(${g.split(",").slice(0, 3).join(",")},${a})`); const h = hex.replace("#", ""); const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h; const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16); return `rgba(${r},${g},${b},${a})`; }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function tag(ctx, x, y, text, bg, fg, align, mobile) { ctx.font = `700 ${mobile ? 9 : 10}px Pretendard, sans-serif`; const w = ctx.measureText(text).width + 10, h = 16; let bx = align === "left" ? x + 2 : align === "right" ? x + 2 : x - w / 2; const by = align === "center" ? y - h / 2 : y - h / 2; ctx.fillStyle = bg; roundRect(ctx, bx, by, w, h, 4); ctx.fill(); ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, bx + 5, y); }

  window.XrayChart = XrayChart;
})();
