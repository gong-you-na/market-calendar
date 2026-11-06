/* 코스피 급락 진료 기록부 (#sec-crash) — data/crash.json을 읽어 그린다. app.js와 독립.
   화면에는 출처를 표시하지 않는다(런북 2-1). crash.json의 src는 기록용. */
(async function () {
  const box = document.getElementById("crash");
  if (!box) return;
  let C = null;
  try { const r = await fetch("data/crash.json?v=" + Date.now()); if (r.ok) C = await r.json(); } catch (e) { }
  if (!C || !C.series || !C.episodes) { box.innerHTML = `<div class="cr-card">급락 기록 데이터를 불러오지 못했습니다.</div>`; return; }

  const S = C.series, D = S.map((r) => r[0]), EP = C.episodes;
  const CB = C.marks.cb || [], SC = C.marks.sc || [], SCU = C.marks.sc_unk || [];
  const NS = "http://www.w3.org/2000/svg";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const idx = (d) => D.indexOf(d);
  const md = (d) => d ? `${+d.slice(4, 6)}/${+d.slice(6, 8)}` : "—";
  const fmtN = (v, dg = 0) => v == null ? "—" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dg, maximumFractionDigits: dg });
  const fmtFlow = (v) => { if (v == null) return "—"; const s = v > 0 ? "+" : v < 0 ? "−" : ""; const a = Math.abs(v); return s + (a >= 10000 ? (a / 10000).toFixed(1) + "조" : a.toLocaleString("ko-KR") + "억"); };
  const cls = (v) => v > 0 ? "pos" : v < 0 ? "neg" : "mut";
  const fmtPct = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%";
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  EP.forEach((e, i) => { e.no = "26-" + String(i + 1).padStart(2, "0"); });

  let SEL = EP.length - 1, MINI = "f";
  const status = (e, short) => { const c = e.calc; if (e.live) return "진행 중"; if (c.rec) return short ? `${c.rec_td}거래일 회복` : `직전 수준 회복 · ${md(c.rec)} (${c.rec_td}거래일)`; return short ? "미회복" : "직전 수준 미회복"; };

  const f = C.facts || {};
  box.innerHTML = `
    <div class="cr-facts"><span><b>${f.cb ?? CB.length}회</b>서킷브레이커 (올해)</span><span><b>${f.sc_sell ?? "—"}회</b>매도 사이드카 (${esc(f.sc_sell_asof || "")} 기준)</span><span><b>${EP.length}개</b>기록한 급락 구간</span></div>
    <div class="cr-card">
      <div class="cr-legend">
        <span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 L11 6 L6 11 L1 6Z" fill="currentColor"/></svg>서킷브레이커</span>
        <span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 2 L11 2 L6 10Z" fill="var(--down)"/></svg>매도 사이드카</span>
        <span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M1.6 2.4 L10.4 2.4 L6 9.6Z" fill="none" stroke="var(--down)" stroke-width="1.3"/></svg>코스피200 장중 −5% (발동 확인 전)</span>
        <span><i class="sw drop"></i>하락 구간</span><span><i class="sw rec"></i>회복 구간</span>
      </div>
      <div class="cr-box" id="crMainBox"><svg id="crMain" role="img" aria-label="2026년 코스피 일별 종가와 급락 구간"></svg><div class="cr-tip" id="crTip"></div></div>
      <div class="cr-chips" id="crChips" role="group" aria-label="급락 구간 선택"></div>
    </div>
    <div class="cr-card cr-rec" id="crRec" aria-live="polite"></div>
    <div class="cr-card">
      <div class="cr-h4"><b>${EP.length}개 구간 나란히 보기</b><small>행을 누르면 위 기록이 바뀝니다 · 수급은 저점 다음 날부터 회복일까지(최대 15거래일) 누적</small></div>
      <div class="cr-tw"><table class="cr-t cr-cmp" id="crCmp"></table></div>
      <ul class="cr-method">
        <li>투자자별 순매수는 일별 잠정 집계라 거래소 확정치와 차이가 날 수 있어, 사건 설명의 수치는 당일 발표 숫자를 그대로 적었습니다.</li>
        <li>신용거래융자·반대매매·투자자예탁금은 1~2거래일 늦게 공표되어 최근 칸이 비어 있을 수 있습니다. 오늘 코스피는 장중 잠정치입니다.</li>
        <li>'직전 수준 회복'은 구간 첫 발동 전날 종가를 다시 넘긴 첫 종가일. 회복하지 못한 구간은 저점 뒤 40거래일 안의 최고 종가를 보여줍니다.</li>
        <li>지난 구간의 회복 과정은 앞으로의 결과를 보장하지 않습니다. 매수·매도 권유가 아닌 학습용 기록입니다.</li>
      </ul>
    </div>`;

  /* ── 메인 차트 ── */
  function drawMain() {
    const wrap = $("#crMainBox"), svg = $("#crMain"); svg.innerHTML = "";
    const W = wrap.clientWidth, narrow = W < 560, H = narrow ? 260 : 320;
    const m = { l: narrow ? 38 : 46, r: 10, t: 46, b: 24 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
    const n = D.length, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = (i) => m.l + pw * i / (n - 1);
    const cs = S.map((r) => r[1]); const lo = Math.floor(Math.min(...cs) / 500) * 500 - 200, hi = Math.ceil(Math.max(...cs) / 500) * 500 + 200;
    const y = (v) => m.t + ph * (1 - (v - lo) / (hi - lo));
    const ax = el("g", { class: "ax" }, svg);
    for (let v = Math.ceil(lo / 1000) * 1000; v <= hi; v += 1000) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), "stroke-dasharray": "2 4" }, ax);
      const t = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, ax); t.textContent = v.toLocaleString();
    }
    let lastM = "";
    D.forEach((d, i) => { const mm = d.slice(4, 6); if (d.slice(0, 4) === "2026" && mm !== lastM) { lastM = mm;
      if (!narrow || (+mm) % 2 === 1) { const t = el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, ax); t.textContent = (+mm) + "월"; } } });
    EP.forEach((e, k) => {
      const c = e.calc, g = el("g", { class: "cr-band", role: "button", tabindex: 0, "aria-label": `${e.tag} ${e.name} 구간 보기` }, svg);
      const xs = x(Math.max(c.si - 0.5, 0)), xt = x(c.ti + 0.5), xe = x(Math.min(c.ei + 0.5, n - 1));
      el("rect", { class: "bsel", x: xs, y: m.t, width: Math.max(xe - xs, 4), height: ph, fill: k === SEL ? css("--cr-sel") : "transparent" }, g);
      el("rect", { x: xs, y: m.t, width: Math.max(xt - xs, 2), height: ph, fill: css("--cr-drop") }, g);
      if (xe > xt) el("rect", { x: xt, y: m.t, width: xe - xt, height: ph, fill: css("--cr-rec") }, g);
      if (k === SEL) el("rect", { x: xs, y: m.t, width: Math.max(xe - xs, 4), height: ph, fill: "none", stroke: css("--ink"), "stroke-width": 1.2, rx: 2 }, g);
      const cx = (xs + xe) / 2, py = m.t - 30;
      el("circle", { cx, cy: py, r: 9.5, fill: k === SEL ? css("--ink") : css("--card2"), stroke: k === SEL ? css("--ink") : css("--line2") }, g);
      const t = el("text", { x: cx, y: py + 3.6, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: k === SEL ? css("--bg") : css("--ink2") }, g); t.textContent = k + 1;
      const go = () => select(k);
      g.addEventListener("click", go); g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
    });
    let p = ""; S.forEach((r, i) => { p += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(r[1]).toFixed(1); });
    el("path", { d: p, fill: "none", stroke: css("--ink"), "stroke-width": 1.6, "stroke-linejoin": "round" }, svg);
    el("circle", { cx: x(n - 1), cy: y(S[n - 1][1]), r: 3.2, fill: css("--ink") }, svg);
    const lane = m.t - 12;
    SCU.forEach((d) => { const i = idx(d); if (i < 0) return; const cx = x(i); el("path", { d: `M${cx - 3.6} ${lane - 3.4} L${cx + 3.6} ${lane - 3.4} L${cx} ${lane + 3.4}Z`, fill: css("--card"), stroke: css("--down"), "stroke-width": 1.1 }, svg); });
    SC.forEach((d) => { const i = idx(d); if (i < 0 || CB.includes(d)) return; const cx = x(i); el("path", { d: `M${cx - 4} ${lane - 3.6} L${cx + 4} ${lane - 3.6} L${cx} ${lane + 3.8}Z`, fill: css("--down") }, svg); });
    CB.forEach((d) => { const i = idx(d); if (i < 0) return; const cx = x(i); el("path", { d: `M${cx} ${lane - 5.5} L${cx + 5} ${lane} L${cx} ${lane + 5.5} L${cx - 5} ${lane}Z`, fill: css("--ink"), stroke: css("--card"), "stroke-width": 1 }, svg); });
    const hov = el("g", { style: "pointer-events:none" }, svg);
    const vl = el("line", { y1: m.t, y2: H - m.b, stroke: css("--grey2"), "stroke-dasharray": "3 3", opacity: 0 }, hov);
    const dot = el("circle", { r: 4, fill: css("--card"), stroke: css("--ink"), "stroke-width": 1.6, opacity: 0 }, hov);
    const tip = $("#crTip");
    const hide = () => { vl.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tip.classList.remove("on"); };
    svg.onpointermove = (ev) => {
      const rr = svg.getBoundingClientRect(), px = ev.clientX - rr.left;
      if (px < m.l || px > W - m.r) { hide(); return; }
      const i = Math.round((px - m.l) / pw * (n - 1)), row = S[i];
      vl.setAttribute("x1", x(i)); vl.setAttribute("x2", x(i)); vl.setAttribute("opacity", 1);
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(row[1])); dot.setAttribute("opacity", 1);
      const ch = i ? (row[1] / S[i - 1][1] - 1) * 100 : 0;
      const ev2 = CB.includes(row[0]) ? " · 서킷브레이커" : SC.includes(row[0]) ? " · 매도 사이드카" : "";
      tip.innerHTML = `<b>${row[0].slice(0, 4)}.${md(row[0])}</b>${ev2}<br>종가 ${fmtN(row[1], 2)} ${fmtPct(ch)}<br>외국인 현물 ${fmtFlow(row[3])}`;
      tip.style.left = Math.min(Math.max(x(i), 70), W - 70) + "px"; tip.style.top = (Math.min(y(row[1]), H - 60) - 12) + "px"; tip.classList.add("on");
    };
    svg.onpointerleave = hide;
  }
  function drawChips() {
    $("#crChips").innerHTML = EP.map((e, k) => `<button type="button" class="cr-chip" data-k="${k}" aria-pressed="${k === SEL}"><span class="n">${k + 1}</span>${esc(e.tag)} · ${esc(e.name)}<span class="st">${status(e, true)}</span></button>`).join("");
  }
  $("#crChips").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-k]"); if (b) select(+b.dataset.k); });

  /* ── 진료 기록 ── */
  function drawRec() {
    const e = EP[SEL], c = e.calc, st = e.live ? "live" : c.rec ? "ok" : "no";
    const tl = (a) => a.map((it) => `<li><span class="d">${esc(it.d)}</span><span>${esc(it.t)}</span></li>`).join("");
    $("#crRec").innerHTML = `
      <div class="cr-head">
        <span class="cr-no">CHART NO. ${e.no}</span><span class="cr-st ${st}">${status(e)}</span>
        <span class="cr-period">${md(e.start)} ~ ${e.live ? "기록 중" : md(D[c.ei])}</span>
        <h3>${esc(e.tag)} · ${esc(e.name)}</h3>
        <p class="cr-sum">${esc(e.summary)}</p>
      </div>
      <div class="cr-grid">
        <div class="cr-story">
          <div class="cr-blk"><h4><i style="background:var(--down)"></i>무엇 때문에 빠졌나</h4><ul class="cr-tl">${tl(e.cause)}</ul></div>
          <div class="cr-blk"><h4><i style="background:var(--up)"></i>회복 무렵 무엇이 나왔나</h4><ul class="cr-tl">${tl(e.turn)}</ul></div>
          ${e.vk ? `<div class="cr-vk"><b>VKOSPI</b>${esc(e.vk.t)}</div>` : ""}
        </div>
        <div class="cr-mini">
          <div class="seg sm" role="group" aria-label="수급 선택">${[["f", "외국인 현물"], ["fut", "외국인 선물"], ["inst", "기관"], ["ind", "개인"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${MINI === k ? "on" : ""}" aria-pressed="${MINI === k}">${l}</button>`).join("")}</div>
          <div class="cr-box" id="crMiniBox"><svg id="crMini" role="img" aria-label="구간 확대 차트"></svg></div>
          <p class="cr-note">위: 코스피 종가 · 아래: 일별 순매수(억원, 순매수 빨강/순매도 파랑) · 파란 점선 = 저점, 빨간 선 = 직전 수준 회복일</p>
        </div>
      </div>
      <div class="cr-tw"><table class="cr-t">${vitals(e)}</table></div>`;
    $("#crRec").querySelectorAll(".seg button").forEach((b) => b.onclick = () => { MINI = b.dataset.k; $("#crRec").querySelectorAll(".seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); drawMini(); });
    drawMini();
  }
  function vitals(e) {
    const c = e.calc, live = e.live;
    const postLbl = live ? "기록 중" : c.post_start ? `${md(c.post_start)}~${md(c.post_end)} (${c.post_days}거래일)` : "—";
    const k1 = `${fmtN(c.trough_close, 2)} <span class="neg">(${fmtPct(c.dd)})</span><span class="hint">저점 ${md(c.trough)} · 장중 최저 ${fmtN(c.low, 2)}</span>`;
    const k2 = live ? '<span class="mut">—</span>' : c.rec ? `${md(c.rec)} 회복<span class="hint">${c.rec_td}거래일</span>`
      : `최고 ${fmtN(c.best_close, 2)} <span class="pos">(+${(c.best_pct ?? 0).toFixed(2)}%)</span><span class="hint">${md(c.best)} · 직전 수준 미회복</span>`;
    const fl = (a, b) => `<td class="${cls(a)}">${fmtFlow(a)}</td><td class="${live ? "mut" : cls(b)}">${live ? "—" : fmtFlow(b)}</td>`;
    const cr = (v) => v == null ? "—" : v.toFixed(1) + "조";
    const dCr = (a, b) => { if (a == null || b == null) return ""; const d = b - a; return ` <span class="${d < 0 ? "neg" : d > 0 ? "pos" : "mut"}">(${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(1)})</span>`; };
    const liq = c.liq_peak_d ? `${fmtN(c.liq_peak)}억 <span class="mut">(${c.liq_peak_pct}%)</span><span class="hint">${md(c.liq_peak_d)} · 저점 후 3거래일까지</span>` : '<span class="mut">공표 전</span>';
    const dep = (v) => v == null ? "—" : v.toFixed(1) + "조";
    return `<thead><tr><th>바이탈</th><th>급락 직전 · ${md(c.pre)}</th><th>하락 구간 · ${md(e.start)}~${md(c.trough)}</th><th>저점 이후 · ${postLbl}</th></tr></thead><tbody>
    <tr><td><span class="lab">코스피 종가</span></td><td>${fmtN(c.pre_close, 2)}</td><td>${k1}</td><td>${k2}</td></tr>
    <tr><td><span class="lab">외국인 현물</span><span class="hint">누적 순매수</span></td><td class="mut">—</td>${fl(c.f_drop, c.f_post)}</tr>
    <tr><td><span class="lab">외국인 코스피200 선물</span><span class="hint">누적 순매수</span></td><td class="mut">—</td>${fl(c.fut_drop, c.fut_post)}</tr>
    <tr><td><span class="lab">기관</span><span class="hint">누적 순매수</span></td><td class="mut">—</td>${fl(c.inst_drop, c.inst_post)}</tr>
    <tr><td><span class="lab">개인</span><span class="hint">누적 순매수</span></td><td class="mut">—</td>${fl(c.ind_drop, c.ind_post)}</tr>
    <tr><td><span class="lab">외국인 3거래일 연속 순매수</span><span class="hint">저점 이후 처음 시작한 날</span></td><td class="mut">—</td><td class="mut">—</td><td>${live ? '<span class="mut">—</span>' : c.f_streak3 ? md(c.f_streak3) + "부터" : '<span class="mut">없음</span>'}</td></tr>
    <tr><td><span class="lab">신용거래융자 잔고</span><span class="hint">빚내서 산 주식 규모</span></td><td>${cr(c.credit_pre)}<span class="hint">${md(c.credit_pre_d)}</span></td><td>${cr(c.credit_tr)}${dCr(c.credit_pre, c.credit_tr)}<span class="hint">${md(c.credit_tr_d)}</span></td><td>${live ? '<span class="mut">기록 중</span>' : cr(c.credit_rec) + dCr(c.credit_tr, c.credit_rec) + `<span class="hint">${md(c.credit_rec_d)}</span>`}</td></tr>
    <tr><td><span class="lab">반대매매 최고</span><span class="hint">미수금 대비 실제 반대매매</span></td><td class="mut">—</td><td>${liq}</td><td class="mut">—</td></tr>
    <tr><td><span class="lab">투자자예탁금</span><span class="hint">증시 대기 자금</span></td><td>${dep(c.dep_pre)}</td><td>${dep(c.dep_tr)}</td><td>${live ? '<span class="mut">기록 중</span>' : dep(c.dep_rec)}</td></tr>
    <tr><td><span class="lab">원/달러</span></td><td>${fmtN(c.fx_pre, 1)}</td><td>구간 최고 ${fmtN(c.fx_max, 1)}</td><td>${live ? '<span class="mut">—</span>' : fmtN(c.fx_rec, 1)}</td></tr></tbody>`;
  }
  function nice(lo, hi, k) { const sp = hi - lo, st = Math.pow(10, Math.floor(Math.log10(sp / k))); const f = [1, 2, 2.5, 5, 10].find((f) => sp / (f * st) <= k) || 10; const s = f * st, out = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(Math.round(v)); return out; }
  function drawMini() {
    const e = EP[SEL], c = e.calc, wrap = $("#crMiniBox"), svg = $("#crMini"); if (!svg) return; svg.innerHTML = "";
    const W = wrap.clientWidth, H = W < 520 ? 250 : 280, m = { l: 44, r: 8, t: 14, b: 22 }, gap = 12;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
    const a = Math.max(c.si - 6, 0), b = Math.min(c.ei + 6, D.length - 1), rows = S.slice(a, b + 1), n = rows.length;
    const pw = W - m.l - m.r, h1 = (H - m.t - m.b - gap) * 0.6, h2 = (H - m.t - m.b - gap) - h1, step = pw / n, x = (i) => m.l + step * (i + .5);
    const cs = rows.map((r) => r[1]); let lo = Math.min(...cs), hi = Math.max(...cs); const pad = (hi - lo) * .12; lo -= pad; hi += pad;
    const y = (v) => m.t + h1 * (1 - (v - lo) / (hi - lo));
    const col = { f: 3, fut: 4, inst: 5, ind: 6 }[MINI];
    const mx = Math.max(1000, ...rows.map((r) => Math.abs(r[col] ?? 0)));
    const z = m.t + h1 + gap + h2 / 2, yb = (v) => z - (v / mx) * (h2 / 2);
    const si = c.si - a, ti = c.ti - a, ei = c.ei - a;
    el("rect", { x: m.l + step * si, y: m.t, width: step * (ti - si + 1), height: H - m.t - m.b, fill: css("--cr-drop") }, svg);
    if (ei > ti) el("rect", { x: m.l + step * (ti + 1), y: m.t, width: step * (ei - ti), height: H - m.t - m.b, fill: css("--cr-rec") }, svg);
    const g = el("g", { class: "ax" }, svg);
    nice(lo, hi, 4).forEach((v) => { el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), "stroke-dasharray": "2 4" }, g); const t = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, g); t.textContent = v.toLocaleString(); });
    el("line", { x1: m.l, x2: W - m.r, y1: z, y2: z }, g);
    [mx, -mx].forEach((v) => { const t = el("text", { x: m.l - 6, y: yb(v) + (v > 0 ? 9 : -1), "text-anchor": "end" }, g); t.textContent = (v > 0 ? "+" : "−") + (Math.abs(v) / 10000).toFixed(1) + "조"; });
    rows.forEach((r, i) => { const v = r[col]; if (v == null) return; const y1 = yb(v); el("rect", { x: x(i) - step * .34, y: Math.min(y1, z), width: Math.max(step * .68, 1.2), height: Math.max(Math.abs(y1 - z), .6), fill: v >= 0 ? css("--up") : css("--down"), opacity: .85 }, svg); });
    let p = ""; rows.forEach((r, i) => { p += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(r[1]).toFixed(1); });
    el("path", { d: p, fill: "none", stroke: css("--ink"), "stroke-width": 1.8, "stroke-linejoin": "round" }, svg);
    el("line", { x1: m.l, x2: W - m.r, y1: y(c.pre_close), y2: y(c.pre_close), stroke: css("--grey"), "stroke-dasharray": "5 3" }, svg);
    const lt = el("text", { x: W - m.r - 2, y: y(c.pre_close) - 4, "text-anchor": "end", "font-size": 10.5, fill: css("--grey"), "font-weight": 700 }, svg); lt.textContent = `직전 ${fmtN(c.pre_close)}`;
    el("line", { x1: x(ti), x2: x(ti), y1: m.t, y2: H - m.b, stroke: css("--down"), "stroke-dasharray": "3 3" }, svg);
    el("circle", { cx: x(ti), cy: y(c.trough_close), r: 3.6, fill: css("--down") }, svg);
    if (c.rec && !e.live) { const ri = idx(c.rec) - a; if (ri < n) { el("line", { x1: x(ri), x2: x(ri), y1: m.t, y2: H - m.b, stroke: css("--up"), "stroke-width": 1.2 }, svg); el("circle", { cx: x(ri), cy: y(S[idx(c.rec)][1]), r: 3.6, fill: css("--up") }, svg); } }
    rows.forEach((r, i) => { if (CB.includes(r[0])) { const cx = x(i), cy = m.t + 4; el("path", { d: `M${cx} ${cy - 4.5} L${cx + 4.5} ${cy} L${cx} ${cy + 4.5} L${cx - 4.5} ${cy}Z`, fill: css("--ink") }, svg); } });
    const every = Math.ceil(n / 7);
    rows.forEach((r, i) => { if ((i % every === 0 && Math.abs(i - ti) * step > 34) || i === ti) { const t = el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, g); t.textContent = md(r[0]); } });
  }

  /* ── 비교표 ── */
  function drawCmp() {
    $("#crCmp").innerHTML = `<thead><tr><th>구간</th><th>낙폭(종가)</th><th>직전 수준 회복</th><th>저점 후 외국인</th><th>저점 후 기관</th><th>신용잔고 변화</th><th>반대매매 최고</th></tr></thead><tbody>` +
      EP.map((e, k) => { const c = e.calc;
        const rec = e.live ? '<span class="mut">진행 중</span>' : c.rec ? `${c.rec_td}거래일 <span class="mut">(${md(c.rec)})</span>` : '<span class="neg">미회복</span>';
        const dc = c.credit_pre != null && c.credit_tr != null ? c.credit_tr - c.credit_pre : null;
        return `<tr data-k="${k}" class="${k === SEL ? "on" : ""}" tabindex="0"><td>${k + 1}. ${esc(e.tag)}</td><td class="neg">${fmtPct(c.dd)}</td><td>${rec}</td>
          <td class="${e.live ? "mut" : cls(c.f_post)}">${e.live ? "—" : fmtFlow(c.f_post)}</td><td class="${e.live ? "mut" : cls(c.inst_post)}">${e.live ? "—" : fmtFlow(c.inst_post)}</td>
          <td class="${dc == null ? "mut" : dc < 0 ? "neg" : dc > 0 ? "pos" : "mut"}">${dc == null ? "—" : (dc > 0 ? "+" : dc < 0 ? "−" : "") + Math.abs(dc).toFixed(1) + "조"}</td>
          <td>${c.liq_peak ? fmtN(c.liq_peak) + '억 <span class="mut">(' + c.liq_peak_pct + "%)</span>" : '<span class="mut">공표 전</span>'}</td></tr>`; }).join("") + "</tbody>";
  }
  $("#crCmp").addEventListener("click", (ev) => { const r = ev.target.closest("tr[data-k]"); if (r) { select(+r.dataset.k); $("#crRec").scrollIntoView({ behavior: "smooth", block: "start" }); } });
  $("#crCmp").addEventListener("keydown", (ev) => { const r = ev.target.closest("tr[data-k]"); if (r && ev.key === "Enter") { ev.preventDefault(); select(+r.dataset.k); } });

  function select(k) {
    SEL = k; drawMain(); drawChips(); drawRec(); drawCmp();
    const chip = $("#crChips").children[k]; if (chip) chip.scrollIntoView({ block: "nearest", inline: "center" });
  }
  const asof = document.getElementById("crashAsof");
  if (asof) asof.textContent = `${md(D[0])}~${md(D[D.length - 1])} · ${C.updated || ""} 갱신`;
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawMain(); drawMini(); }, 150); });
  new MutationObserver(() => { drawMain(); drawMini(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { drawMain(); drawMini(); });
  SEL = EP.length - 1; drawChips(); drawRec(); drawCmp(); drawMain();
})();
