/* WizView 히트맵 — finviz식 섹터 트리맵. 사용: renderHeatmap(container, data.us|data.kr, {period:'d1'|'w1'|'m1', tiers}) */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 등락률 → 색 (국내 관행: 상승 빨강, 하락 파랑). 단계: 0 / 1 / 2 / 3+%
  function color(p, dark) {
    if (p === null || p === undefined) return dark ? "#2A2D34" : "#E9E6DF";
    const a = Math.min(1, Math.abs(p) / 3);
    const t = 0.18 + a * 0.82;
    const base = dark ? [38, 40, 46] : [236, 233, 226];
    const up = dark ? [230, 70, 85] : [240, 68, 82], dn = dark ? [60, 130, 240] : [49, 130, 246];
    const c = p >= 0 ? up : dn;
    const mix = c.map((v, i) => Math.round(base[i] + (v - base[i]) * t));
    return `rgb(${mix.join(",")})`;
  }
  // squarify (Bruls et al.)
  function squarify(items, x, y, w, h, out) {
    items = items.slice(); if (!items.length) return;
    const total = items.reduce((s, i) => s + i.v, 0), scale = (w * h) / total;
    let row = [], rest = items, rx = x, ry = y, rw = w, rh = h;
    const worst = (row, side) => { const s = row.reduce((a, b) => a + b.v * scale, 0); let mx = 0, mn = Infinity; for (const r of row) { const a = r.v * scale; mx = Math.max(mx, a); mn = Math.min(mn, a); } return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
    const layout = (row, horiz) => { const s = row.reduce((a, b) => a + b.v * scale, 0); if (horiz) { const rowH = s / rw; let cx = rx; for (const r of row) { const cw = (r.v * scale) / rowH; out.push({ ...r, x: cx, y: ry, w: cw, h: rowH }); cx += cw; } ry += rowH; rh -= rowH; } else { const rowW = s / rh; let cy = ry; for (const r of row) { const ch = (r.v * scale) / rowW; out.push({ ...r, x: rx, y: cy, w: rowW, h: ch }); cy += ch; } rx += rowW; rw -= rowW; } };
    while (rest.length) {
      const horiz = rw >= rh, side = horiz ? rw : rh, item = rest[0];
      if (!row.length || worst(row.concat(item), side) <= worst(row, side)) { row.push(item); rest = rest.slice(1); }
      else { layout(row, horiz); row = []; }
    }
    if (row.length) layout(row, rw >= rh);
  }

  function renderHeatmap(el, data, opts = {}) {
    const period = opts.period || "d1", tiers = opts.tiers || {}, dark = document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const W = el.clientWidth || 900, H = opts.height || Math.max(420, Math.round(W * 0.56));
    el.style.height = H + "px"; el.innerHTML = "";
    const stocks = data.stocks.filter((s) => s[period] !== null && s[period] !== undefined);
    // 섹터 집계
    const sec = {}; for (const s of stocks) { const g = sec[s.sector] || (sec[s.sector] = { name: s.sector, v: 0, items: [] }); g.v += s.cap; g.items.push({ ...s, v: s.cap }); }
    const groups = Object.values(sec).sort((a, b) => b.v - a.v);
    const GAP = 3, HEAD = 18;
    const laid = []; squarify(groups, 0, 0, W, H, laid);
    const frag = document.createDocumentFragment();
    for (const g of laid) {
      const gx = g.x + GAP / 2, gy = g.y + GAP / 2, gw = Math.max(0, g.w - GAP), gh = Math.max(0, g.h - GAP);
      const box = document.createElement("div"); box.className = "hm-sector"; box.style.cssText = `left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px`;
      const capW = stocks.filter((s) => s.sector === g.name).reduce((a, s) => a + s.cap, 0);
      const wavg = stocks.filter((s) => s.sector === g.name).reduce((a, s) => a + s.cap * s[period], 0) / (capW || 1);
      box.innerHTML = `<div class="hm-head" title="${esc(g.name)} 시총가중 ${wavg >= 0 ? "+" : ""}${wavg.toFixed(2)}%"><span>${esc(g.name)}</span><b class="${wavg >= 0 ? "up" : "down"}">${wavg >= 0 ? "+" : ""}${wavg.toFixed(2)}%</b></div>`;
      const inner = []; const items = g.items.sort((a, b) => b.v - a.v);
      if (gh > HEAD + 6 && gw > 6) squarify(items, 0, 0, gw, gh - HEAD, inner);
      for (const s of inner) {
        const t = document.createElement("div"); t.className = "hm-tile" + (s.tier ? ` tier t${s.tier}` : "") + (s.watch ? " watch" : "");
        const sw = Math.max(0, s.w - 1), sh = Math.max(0, s.h - 1);
        t.style.cssText = `left:${s.x}px;top:${HEAD + s.y}px;width:${sw}px;height:${sh}px;background:${color(s[period], dark)}`;
        const p = s[period], ps = (p >= 0 ? "+" : "") + p.toFixed(2) + "%";
        const label = s.t.replace(".KS", ""), nm = s.n;
        const showName = s.t.endsWith(".KS");
        if (sw > 44 && sh > 28) t.innerHTML = `<span class="hm-t">${esc(showName ? nm : label)}</span>${sh > 40 ? `<span class="hm-p">${ps}</span>` : ""}`;
        else if (sw > 24 && sh > 14) t.innerHTML = `<span class="hm-t sm">${esc(showName ? nm.slice(0, 4) : label)}</span>`;
        t.dataset.tip = JSON.stringify({ t: s.t, n: s.n, sector: s.sector, ind: s.ind, p: s.p, d1: s.d1, w1: s.w1, m1: s.m1, cap: s.cap, tier: s.tier || null, watch: !!s.watch });
        box.appendChild(t);
      }
      frag.appendChild(box);
    }
    el.appendChild(frag);
    // 툴팁
    let tip = el.parentElement.querySelector(".hm-tip"); if (!tip) { tip = document.createElement("div"); tip.className = "hm-tip"; el.parentElement.appendChild(tip); }
    el.onmousemove = (e) => {
      const t = e.target.closest(".hm-tile"); if (!t) { tip.style.display = "none"; return; }
      const d = JSON.parse(t.dataset.tip); const f = (v) => v === null || v === undefined ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
      const cap = d.cap >= 1e12 ? (d.cap / 1e12).toFixed(2) + "조" : (d.cap / 1e9).toFixed(0) + "B";
      const isKR = d.t.endsWith(".KS"); const capTxt = isKR ? (d.cap / 1e12).toFixed(1) + "조원" : "$" + (d.cap >= 1e12 ? (d.cap / 1e12).toFixed(2) + "T" : (d.cap / 1e9).toFixed(0) + "B");
      const extra = opts.extra ? opts.extra(d) : "";
      tip.innerHTML = `<div class="tt-h"><b>${esc(d.n)}</b><span>${esc(d.t.replace(".KS", ""))}${d.tier ? ` · <em class="t${d.tier}">${esc((tiers[d.tier] || {}).label || d.tier + "군")}</em>` : d.watch ? " · 관심" : ""}</span></div>
        <div class="tt-r"><span>현재가</span><b>${isKR ? Number(d.p).toLocaleString("ko-KR") + "원" : "$" + Number(d.p).toFixed(2)}</b></div>
        <div class="tt-r"><span>1일</span><b class="${d.d1 >= 0 ? "up" : "down"}">${f(d.d1)}</b></div>
        <div class="tt-r"><span>1주</span><b class="${(d.w1 || 0) >= 0 ? "up" : "down"}">${f(d.w1)}</b></div>
        <div class="tt-r"><span>1개월</span><b class="${(d.m1 || 0) >= 0 ? "up" : "down"}">${f(d.m1)}</b></div>
        <div class="tt-r"><span>시총</span><b>${capTxt}</b></div>
        <div class="tt-s">${esc(d.sector)}${d.ind ? " · " + esc(d.ind) : ""}</div>${extra}`;
      tip.style.display = "block";
      const r = el.getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
      if (x + 240 > r.width) x = e.clientX - r.left - 250; if (y + 170 > r.height) y = e.clientY - r.top - 180;
      tip.style.left = x + "px"; tip.style.top = y + "px";
    };
    el.onmouseleave = () => { tip.style.display = "none"; };
    return { groups: groups.length, stocks: stocks.length };
  }
  window.renderHeatmap = renderHeatmap;
})();
