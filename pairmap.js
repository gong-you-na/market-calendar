/* WizView 실적 위크 짝 지도 — 기간 한정 모듈 (2026-10-27 추가)
 * 기간(PM_START~PM_END, 한국시간) 안에서만 페이지 최상단에 섹션을 만들고, 기간 밖에서는 아무것도 하지 않습니다.
 * 완전 제거: 이 파일 · pairmap.css · data/pairmap.json 삭제 + index.html 의 pairmap 두 줄 삭제.
 * 데이터: data/pairmap.json(노드·짝·연결 근거·한국 기업 결과, 수동) + earnings.json(미국 EPS·첫날 반응, 자동) + market.json(한국 종가 반응, 자동)
 * 미리보기: ?pair=1 (기간 밖 강제 표시) · ?pairnow=2026-10-30T07:00 (그 시각 기준 상태로 보기)
 */
(function () {
  const PM_START = "2026-10-27T00:00:00+09:00";
  const PM_END = "2026-11-05T23:59:59+09:00";

  const qs = new URLSearchParams(location.search);
  const force = qs.get("pair") === "1";
  const nowParam = qs.get("pairnow");
  const fixedNow = nowParam ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(nowParam) ? nowParam : nowParam + "+09:00") : NaN;
  const now = () => (isNaN(fixedNow) ? Date.now() : fixedNow);
  const inWindow = now() >= Date.parse(PM_START) && now() <= Date.parse(PM_END);
  if (!inWindow && !force) return;

  /* app.js 와 같은 파일을 한 번만 받도록 Promise 공유 (app.js 의 get()이 window.__DATA 를 먼저 확인) */
  const V = Date.now();
  window.__DATA = window.__DATA || {};
  const share = (f) => window.__DATA[f] || (window.__DATA[f] = fetch(`data/${f}?v=${V}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const pCFG = share("config.json"), pER = share("earnings.json"), pMK = share("market.json");
  const pPM = fetch(`data/pairmap.json?v=${V}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SVGNS = "http://www.w3.org/2000/svg";
  const WK = ["일", "월", "화", "수", "목", "금", "토"];
  const kst = (ms) => new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const pad = (n) => String(n).padStart(2, "0");
  const fmtWhen = (iso, long) => {
    const t = Date.parse(iso); if (isNaN(t)) return "—";
    const d = kst(t);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return long ? `${d.getMonth() + 1}/${d.getDate()}(${WK[d.getDay()]}) ${hm}` : `${WK[d.getDay()]} ${hm}`;
  };
  const rel = (iso) => {
    const t = Date.parse(iso); if (isNaN(t)) return "";
    let m = Math.round((t - now()) / 60000);
    const past = m < 0; m = Math.abs(m);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    const s = d ? `${d}일${h ? " " + h + "시간" : ""}` : h ? `${h}시간${mm ? " " + mm + "분" : ""}` : `${mm}분`;
    return past ? `${s} 전 발표` : `${s} 후`;
  };
  const num = (v, dec = 2) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const sgn = (v, dec = 2) => (v > 0 ? "+" : "") + num(v, dec) + "%";
  const ud = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

  Promise.all([pPM, pCFG, pER, pMK]).then(([PM, CFG, ER, MK]) => {
    if (!PM || !PM.companies || !PM.groups) return;
    const CO = PM.companies;
    const TIERS = (CFG && CFG.tiers) || {};
    const MKC = {}; ((MK && MK.companies) || []).forEach((c) => (MKC[c.ticker] = c));
    const ERC = (ER && ER.companies) || {};

    /* ── 사실 데이터: 미국 EPS·반응(자동) / 한국 종가 반응(자동) / 수동 결과 ── */
    const autoUS = (c) => {
      if (c.mkt !== "us" || !ERC[c.code]) return null;
      const h = (ERC[c.code].history || [])[0];
      return h && h.date >= (PM.result_since || "2026-10-15") ? h : null;
    };
    const krReact = (c) => {
      if (c.mkt !== "kr") return null;
      const m = MKC[c.code]; if (!m || !m.spark) return null;
      const d = c.react_date || (c.when || "").slice(0, 10);
      const i = m.spark.findIndex((p) => p.d === d);
      if (i < 1) return null;
      return { pct: (m.spark[i].v / m.spark[i - 1].v - 1) * 100, d, close: m.spark[i].v };
    };
    const hasResult = (c) => !!(autoUS(c) || (c.result && c.result.rows && c.result.rows.length));

    const hubInputs = (hid) => {
      const ins = [];
      PM.groups.forEach((g) => g.edges.forEach((e) => {
        const a = nodeOf(g, e.from), b = nodeOf(g, e.to);
        if (b && b.co === hid && a) ins.push(a.co);
      }));
      return [...new Set(ins)];
    };
    const state = (cid) => {
      const c = CO[cid]; if (!c) return "pending";
      if (c.kind === "hub") {
        const ins = hubInputs(cid), k = ins.filter((x) => { const s = state(x); return s === "out" || s === "done"; }).length;
        return k === 0 ? "pending" : k === ins.length ? "done" : "out";
      }
      if (hasResult(c)) return "done";
      const t = Date.parse(c.when);
      return !isNaN(t) && now() >= t ? "out" : "pending";
    };
    const reported = (s) => s === "out" || s === "done";
    const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);
    const edgeState = (g, e) => {
      const a = reported(state(nodeOf(g, e.from).co)), b = reported(state(nodeOf(g, e.to).co));
      return a && b ? "both" : a || b ? "live" : "idle";
    };
    const STATE_KO = { pending: "예정", out: "발표 완료", done: "결과 입력" };
    const TYPE_KO = { 1: "① 고객 → 공급자", 2: "② 경쟁", 3: "③ 같은 변수" };
    const TYPE_DEF = {
      1: "한쪽의 투자·발주·매입이 다른 쪽의 매출·수주로 이어지는 관계입니다. 공시·공식 발표·조사기관 자료로 연결했고, 증권사·업계 추정에 기댄 근거는 '근거 일부 확인'으로 표시합니다.",
      2: "같은 제품을 같은 시장에 파는 관계입니다. 조사기관 점유율이나 각 사의 수주·매출 공시로 확인했습니다.",
      3: "직접 거래는 없지만 같은 외부 숫자가 두 회사의 실적 항목에 함께 들어가는 관계입니다."
    };

    /* ── 섹션 골격 ── */
    const sec = document.createElement("section");
    sec.className = "sec pm"; sec.id = "sec-pair";
    sec.innerHTML = `
      <div class="sec-h">
        <h2>실적 위크 <span class="h2-sub">돈이 흐르는 짝 지도</span></h2>
        <span class="pm-limited">기간 한정 · ${esc(PM.period_end_label || "")}</span>
        <span class="sec-sub">${esc(PM.period_label || "")}</span>
        <span class="sec-cad">${esc(PM.cadence || "")}</span>
      </div>
      <div class="pm-status" id="pmStatus"></div>
      <div class="pm-layout">
        <div class="pm-board" id="pmBoard"></div>
        <aside class="panel pm-panel" id="pmPanel">
          <div class="panel-h"><div><div class="panel-eyebrow">실적 위크 추적표</div><div class="panel-no" id="pmNo">CHART NO. —</div></div><span class="wt">W.T</span></div>
          <div class="panel-body" id="pmBody"></div>
        </aside>
      </div>
      <div class="legend pm-legend">
        <span><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" class="pm-lg pm-t1"/></svg>① 고객 → 공급자</span>
        <span><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" class="pm-lg pm-t2"/></svg>② 경쟁</span>
        <span><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" class="pm-lg pm-t3"/></svg>③ 같은 변수</span>
        <span class="gap"></span>
        <span><i class="pm-sw pending"></i>예정</span><span><i class="pm-sw out"></i>발표 완료</span><span><i class="pm-sw done"></i>결과 입력</span><span><i class="pm-sw ref"></i>리스트 밖·참고</span>
        <span>흐르는 선 = 한쪽 이상 발표 완료</span>
      </div>
      <p class="fine">${esc(PM.disclaimer || "")}</p>`;
    const main = document.querySelector("main") || document.body;
    main.insertBefore(sec, main.firstChild);
    const nav = document.querySelector(".secnav");
    if (nav) { const a = document.createElement("a"); a.href = "#sec-pair"; a.className = "pm-navlink"; a.textContent = "실적 위크"; nav.insertBefore(a, nav.firstChild); }

    const board = sec.querySelector("#pmBoard");
    let sel = null; // {kind:"co"|"edge", id, g}

    /* ── SVG 그리기 ── */
    const el = (tag, attrs, parent) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
    const anchor = (n, toward) => {
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      return { cx, cy, l: n.x, r: n.x + n.w, t: n.y, b: n.y + n.h, hub: CO[n.co] && CO[n.co].kind === "hub" };
    };
    const pathFor = (A, B) => {
      const a = anchor(A), b = anchor(B);
      let p0, p3, horiz = true;
      if (b.l >= a.r - 1) { p0 = [a.r, a.cy]; p3 = [b.l, b.cy]; }
      else if (b.r <= a.l + 1) { p0 = [a.l, a.cy]; p3 = [b.r, b.cy]; }
      else { horiz = false; if (b.t >= a.b - 1) { p0 = [a.cx, a.b]; p3 = [b.cx, b.t]; } else { p0 = [a.cx, a.t]; p3 = [b.cx, b.b]; } }
      if (horiz) { // 허브(세로 막대)는 상대 노드 높이에 맞춰 수평으로 연결
        if (a.hub) p0[1] = Math.min(Math.max(b.cy, a.t + 14), a.b - 14);
        if (b.hub) p3[1] = Math.min(Math.max(a.cy, b.t + 14), b.b - 14);
        const dx = (p3[0] - p0[0]) * 0.5;
        return { d: `M${p0[0]},${p0[1]} C${p0[0] + dx},${p0[1]} ${p3[0] - dx},${p3[1]} ${p3[0]},${p3[1]}`, p0, p3, c1: [p0[0] + dx, p0[1]], c2: [p3[0] - dx, p3[1]] };
      }
      const dy = (p3[1] - p0[1]) * 0.5;
      return { d: `M${p0[0]},${p0[1]} C${p0[0]},${p0[1] + dy} ${p3[0]},${p3[1] - dy} ${p3[0]},${p3[1]}`, p0, p3, c1: [p0[0], p0[1] + dy], c2: [p3[0], p3[1] - dy] };
    };
    const bez = (P, t) => { const u = 1 - t; const f = (i) => u * u * u * P.p0[i] + 3 * u * u * t * P.c1[i] + 3 * u * t * t * P.c2[i] + t * t * t * P.p3[i]; return [f(0), f(1)]; };

    function drawGroup(g) {
      const card = document.createElement("div");
      card.className = "pm-group"; card.dataset.g = g.id;
      card.innerHTML = `<div class="pm-gh"><b>${esc(g.title)}</b><span>${esc(g.desc || "")}</span></div>`;
      if (g.nodes_only) {
        const d = document.createElement("div"); d.className = "pm-solo";
        d.innerHTML = g.nodes_only.map((cid) => { const c = CO[cid] || {}; return `<button class="pm-chip solo" data-co="${esc(cid)}"><span>${esc(c.name || cid)}</span><small data-when="${esc(cid)}"></small></button>`; }).join("");
        card.appendChild(d); board.appendChild(card); return;
      }
      if (g.nodes.length) {
        const svg = el("svg", { viewBox: `0 0 ${g.w} ${g.h}`, class: "pm-svg", role: "img", "aria-label": g.title });
        const defs = el("defs", {}, svg);
        ["idle", "on"].forEach((k) => {
          const m = el("marker", { id: `pmah-${g.id}-${k}`, viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse", class: `pm-ah ${k}` }, defs);
          el("path", { d: "M0,0 L10,5 L0,10 z" }, m);
        });
        const gE = el("g", { class: "pm-edges" }, svg), gL = el("g", { class: "pm-labels" }, svg), gN = el("g", { class: "pm-nodes" }, svg);
        g.edges.forEach((e) => {
          const A = nodeOf(g, e.from), B = nodeOf(g, e.to); if (!A || !B) return;
          const P = pathFor(A, B);
          const w = el("g", { class: `pm-edge pm-t${e.type}`, "data-e": e.id, "data-g": g.id, tabindex: "0", role: "button", "aria-label": `${e.label || ""} 연결 근거 보기` }, gE);
          el("path", { d: P.d, class: "pm-hit" }, w);
          const base = el("path", { d: P.d, class: "pm-wire" }, w);
          base.setAttribute("marker-end", `url(#pmah-${g.id}-idle)`);
          if (e.type !== 1) base.setAttribute("marker-start", `url(#pmah-${g.id}-idle)`);
          el("path", { d: P.d, class: "pm-flow" }, w);
          if (e.type !== 1) el("path", { d: P.d, class: "pm-flow rev" }, w);
          if (e.label) {
            const [lx, ly] = bez(P, e.lt ?? 0.5);
            const lg = el("g", { class: "pm-lbl", "data-e": e.id, transform: `translate(${lx + (e.lx || 0)},${ly + (e.ly || 0)})` }, gL);
            const r = el("rect", { rx: "6", ry: "6" }, lg);
            const t = el("text", { "text-anchor": "middle", "dominant-baseline": "central" }, lg); t.textContent = e.label;
            lg._rect = r; lg._text = t;
          }
        });
        g.nodes.forEach((n) => {
          const c = CO[n.co] || {};
          const gn = el("g", { class: `pm-node${c.kind === "hub" ? " hub" : ""}${c.list === false ? " ref" : ""}`, "data-co": n.co, "data-n": n.id, tabindex: "0", role: "button", "aria-label": `${c.name || n.co} 상세 보기`, transform: `translate(${n.x},${n.y})` }, gN);
          if (c.kind === "hub") {
            el("rect", { width: n.w, height: n.h, rx: "12", class: "pm-box" }, gn);
            el("rect", { width: n.w, height: 0, rx: "12", class: "pm-hubfill", y: n.h }, gn);
            const t = el("text", { class: "pm-hubt", transform: `translate(${n.w / 2 + 1},${n.h / 2}) rotate(-90)`, "text-anchor": "middle", "dominant-baseline": "central" }, gn);
            t.textContent = c.name;
            const k = el("text", { class: "pm-hubk", x: n.w / 2, y: n.h + 16, "text-anchor": "middle" }, gn); k.textContent = "";
            gn._k = k; gn._fill = gn.querySelector(".pm-hubfill"); gn._h = n.h;
          } else {
            el("rect", { width: n.w, height: n.h, rx: "10", class: "pm-box" }, gn);
            if (c.tier && c.list !== false) el("rect", { x: "0", y: "8", width: "4", height: n.h - 16, rx: "2", class: `pm-tier t${c.tier}` }, gn);
            const t1 = el("text", { x: "14", y: "22", class: "pm-nm" }, gn);
            t1.textContent = n.label || c.name || n.co;
            const sub = n.sub !== undefined ? n.sub : (c.short_code !== undefined ? c.short_code : c.code || "");
            if (sub) { const tc = el("tspan", { class: "pm-cd", dx: "6" }, t1); tc.textContent = sub; }
            const t2 = el("text", { x: "14", y: n.h - 12, class: "pm-wh" }, gn);
            gn._t2 = t2; gn._n = n;
            const ck = el("g", { class: "pm-ck", transform: `translate(${n.w - 14},14)` }, gn);
            el("circle", { r: "8" }, ck); el("path", { d: "M-3.5,0 L-1,2.6 L3.6,-2.6" }, ck);
          }
        });
        card.appendChild(svg);
        card._svg = svg;
      }
      /* 모바일: 짝 목록 */
      const list = document.createElement("div"); list.className = "pm-list";
      const hubN = g.nodes.find((n) => (CO[n.co] || {}).kind === "hub");
      let rest = g.edges;
      if (hubN) { // 모바일: 발주처 → 투자 줄기 → 공급사를 한 블록으로
        const ins = g.edges.filter((e) => e.to === hubN.id), outs = g.edges.filter((e) => e.from === hubN.id);
        rest = g.edges.filter((e) => e.to !== hubN.id && e.from !== hubN.id);
        const chip = (n, lbl) => { const c = CO[n.co] || {}; return `<button class="pm-chip" data-co="${esc(n.co)}"><span>${esc(n.label || c.name)}</span>${lbl ? `<small>${esc(lbl)}</small>` : ""}</button>`; };
        list.insertAdjacentHTML("beforeend", `<div class="pm-mhub">
          <div class="pm-mgrid">${ins.map((e) => chip(nodeOf(g, e.from), "")).join("")}</div>
          <button class="pm-mbar" data-co="${esc(hubN.co)}"><i></i><span>${esc((CO[hubN.co] || {}).name)}</span><b data-hubk="${esc(hubN.co)}"></b></button>
          <div class="pm-mgrid">${outs.map((e) => chip(nodeOf(g, e.to), e.label)).join("")}</div></div>`);
      }
      if (rest.length) {
        list.insertAdjacentHTML("beforeend", rest.map((e) => {
          const A = CO[nodeOf(g, e.from).co] || {}, B = CO[nodeOf(g, e.to).co] || {};
          return `<button class="pm-row pm-t${e.type}" data-e="${esc(e.id)}" data-g="${esc(g.id)}">
            <span class="pm-chip" data-co="${esc(nodeOf(g, e.from).co)}">${esc(nodeOf(g, e.from).label || A.name)}</span>
            <span class="pm-line"><i></i><em>${esc(e.label || "")}</em></span>
            <span class="pm-chip" data-co="${esc(nodeOf(g, e.to).co)}">${esc(nodeOf(g, e.to).label || B.name)}</span></button>`;
        }).join(""));
      }
      card.appendChild(list);
      board.appendChild(card);
    }
    PM.groups.forEach(drawGroup);

    /* 라벨 배경 크기 (렌더 후 측정) */
    const sizeLabels = () => board.querySelectorAll(".pm-lbl").forEach((lg) => {
      try { const b = lg._text.getBBox(); if (!b.width) return; lg._rect.setAttribute("x", b.x - 6); lg._rect.setAttribute("y", b.y - 3); lg._rect.setAttribute("width", b.width + 12); lg._rect.setAttribute("height", b.height + 6); } catch (e) { }
    });

    /* ── 상태 반영 (1분마다) ── */
    let prev = {};
    function paint() {
      const all = Object.keys(CO).filter((k) => CO[k].kind !== "hub");
      board.querySelectorAll(".pm-node").forEach((gn) => {
        const cid = gn.dataset.co, c = CO[cid] || {}, s = state(cid);
        gn.classList.remove("pending", "out", "done"); gn.classList.add(s);
        if (prev[cid] && prev[cid] !== s) { gn.classList.remove("just"); void gn.getBBox(); gn.classList.add("just"); }
        if (c.kind === "hub") {
          const ins = hubInputs(cid), k = ins.filter((x) => reported(state(x))).length;
          gn._k.textContent = `${k}/${ins.length} 발표`;
          const h = gn._h * (ins.length ? k / ins.length : 0);
          gn._fill.setAttribute("height", h); gn._fill.setAttribute("y", gn._h - h);
        } else if (gn._t2) {
          gn._t2.textContent = !c.when ? (c.form || "일정 확인 중") : s === "pending" ? `${fmtWhen(c.when)} · ${rel(c.when)}` : s === "done" ? `${fmtWhen(c.when)} · 결과 입력` : `${fmtWhen(c.when)} · 발표 완료`;
        }
      });
      board.querySelectorAll(".pm-chip[data-co]").forEach((ch) => { const s = state(ch.dataset.co); ch.classList.remove("pending", "out", "done"); ch.classList.add(s); if ((CO[ch.dataset.co] || {}).list === false) ch.classList.add("ref"); });
      board.querySelectorAll("[data-hubk]").forEach((b) => { const ins = hubInputs(b.dataset.hubk), k = ins.filter((x) => reported(state(x))).length; b.textContent = `${k}/${ins.length} 발표`; b.parentElement.classList.toggle("on", k > 0); });
      board.querySelectorAll("small[data-when]").forEach((sm) => { const c = CO[sm.dataset.when] || {}, s = state(sm.dataset.when); sm.textContent = `${fmtWhen(c.when)} · ${s === "pending" ? rel(c.when) : STATE_KO[s]}`; });
      PM.groups.forEach((g) => g.edges.forEach((e) => {
        const s = edgeState(g, e);
        board.querySelectorAll(`[data-g="${g.id}"][data-e="${e.id}"], .pm-group[data-g="${g.id}"] .pm-lbl[data-e="${e.id}"]`).forEach((x) => { x.classList.remove("idle", "live", "both"); x.classList.add(s); });
        const w = board.querySelector(`.pm-edge[data-g="${g.id}"][data-e="${e.id}"] .pm-wire`);
        if (w) { const k = s === "idle" ? "idle" : "on"; w.setAttribute("marker-end", `url(#pmah-${g.id}-${k})`); if (e.type !== 1) w.setAttribute("marker-start", `url(#pmah-${g.id}-${k})`); }
      }));
      all.forEach((k) => (prev[k] = state(k)));
      // 상태 바
      const listCos = all.filter((k) => CO[k].list !== false && CO[k].in_period !== false);
      const cnt = { pending: 0, out: 0, done: 0 }; listCos.forEach((k) => cnt[state(k)]++);
      const next = listCos.filter((k) => state(k) === "pending").sort((a, b) => Date.parse(CO[a].when) - Date.parse(CO[b].when));
      const nx = next[0] ? CO[next[0]] : null;
      const same = nx ? next.filter((k) => CO[k].when === nx.when).map((k) => CO[k].name) : [];
      const t = kst(now());
      sec.querySelector("#pmStatus").innerHTML = `
        <span class="pm-live"><i></i>추적 중 · ${pad(t.getHours())}:${pad(t.getMinutes())} KST 기준</span>
        <span class="pm-cnt pending">예정 <b>${cnt.pending}</b></span><span class="pm-cnt out">발표 완료 <b>${cnt.out}</b></span><span class="pm-cnt done">결과 입력 <b>${cnt.done}</b></span>
        ${nx ? `<span class="pm-next">다음 발표 <b>${esc(same.join(" · "))}</b> ${esc(fmtWhen(nx.when, true))} · ${esc(rel(nx.when))}</span>` : `<span class="pm-next">기간 내 리스트 기업 발표가 모두 끝났습니다</span>`}`;
      if (!sel) renderOverview(cnt, next);
      else if (sel.kind === "co") renderCo(sel.id);
      else renderEdge(sel.g, sel.id);
    }

    /* ── 패널 ── */
    const body = sec.querySelector("#pmBody"), no = sec.querySelector("#pmNo");
    const tierBadge = (c) => c.list === false ? `<span class="badge">리스트 밖 · 참고</span>` : c.tier ? `<span class="badge t${c.tier}">${esc((TIERS[c.tier] && TIERS[c.tier].name) || c.tier + "군")}</span>` : "";
    const stBadge = (s, cid) => {
      if (cid && CO[cid] && CO[cid].kind === "hub") { const ins = hubInputs(cid), k = ins.filter((x) => reported(state(x))).length; return `<span class="pm-st ${k ? "out" : "pending"}">${k}/${ins.length} 발표</span>`; }
      return `<span class="pm-st ${s}">${STATE_KO[s]}</span>`;
    };
    const headline = (cid) => {
      const c = CO[cid] || {}; const h = autoUS(c);
      if (h) return `EPS $${num(h.eps)} (예상 $${num(h.est)})${h.reaction && h.reaction.pct !== undefined ? ` · 반응 ${sgn(h.reaction.pct)}` : ""}`;
      if (c.result && c.result.rows && c.result.rows[0]) { const r = c.result.rows[0]; return `${r[0]} ${r[1]}${r[2] ? " (" + r[2] + ")" : ""}`; }
      return "";
    };

    function renderOverview(cnt, next) {
      no.textContent = `CHART NO. ${PM.chart_no || ""}`;
      const up = (next || []).slice(0, 4).map((k) => { const c = CO[k]; return `<li><button data-co="${esc(k)}"><b>${esc(c.name)}</b><span>${esc(fmtWhen(c.when, true))} · ${esc(rel(c.when))}</span></button></li>`; }).join("");
      body.innerHTML = `
        <div class="pm-ov">
          <p class="pm-lead">${esc(PM.lead || "")}</p>
          ${up ? `<div class="pm-h4">다가오는 발표</div><ul class="pm-up">${up}</ul>` : ""}
          <div class="pm-h4">짝을 짓는 기준</div>
          <ul class="pm-types">${[1, 2, 3].map((t) => `<li><span class="pm-tb pm-t${t}">${TYPE_KO[t]}</span>${esc(TYPE_DEF[t])}</li>`).join("")}</ul>
          <p class="pm-tip">기업을 누르면 발표 일시·확인 항목·결과가, 선을 누르면 두 기업을 연결한 근거가 열립니다.</p>
        </div>`;
    }

    function resultHTML(cid) {
      const c = CO[cid]; const h = autoUS(c); let out = "";
      if (h) {
        const r = h.reaction || {};
        out += `<div class="pm-res">
          <div class="pm-kv"><span>EPS (발표)</span><b>$${num(h.eps)}</b></div>
          <div class="pm-kv"><span>EPS (예상)</span><b>$${num(h.est)}</b></div>
          <div class="pm-kv"><span>예상 대비</span><b class="${ud(h.surprise_pct)}">${sgn(h.surprise_pct, 1)}</b></div>
          <div class="pm-kv"><span>다음 거래일 종가 반응</span><b class="${r.pct === undefined ? "" : ud(r.pct)}">${r.pct === undefined ? "집계 전" : sgn(r.pct)}</b></div>
          ${r.pct5 !== undefined ? `<div class="pm-kv"><span>5거래일 누적</span><b class="${ud(r.pct5)}">${sgn(r.pct5)}</b></div>` : ""}
        </div>${r.react_d ? `<div class="pm-src">반응 기준일 ${esc(r.react_d)}</div>` : ""}`;
      }
      if (c.result && c.result.rows && c.result.rows.length) {
        out += `<table class="pm-tbl"><thead><tr><th>항목</th><th>발표</th><th>비교</th></tr></thead><tbody>${c.result.rows.map((r) => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td><td>${esc(r[2] || "")}</td></tr>`).join("")}</tbody></table>`;
        if (c.result.note) out += `<p class="pm-note">${esc(c.result.note)}</p>`;
      }
      const kr = krReact(c);
      if (kr) out += `<div class="pm-res"><div class="pm-kv"><span>${esc(kr.d.slice(5).replace("-", "/"))} 종가 반응</span><b class="${ud(kr.pct)}">${sgn(kr.pct)}</b></div></div>`;
      return out;
    }

    function pairsOf(cid) {
      const out = [];
      PM.groups.forEach((g) => g.edges.forEach((e) => {
        const a = nodeOf(g, e.from).co, b = nodeOf(g, e.to).co;
        if (a === cid || b === cid) out.push({ g, e, other: a === cid ? b : a, dir: a === cid ? "→" : "←" });
      }));
      return out;
    }

    function renderCo(cid) {
      const c = CO[cid]; if (!c) return;
      const s = state(cid);
      no.textContent = `CHART NO. ${c.code || cid}`;
      if (c.kind === "hub") {
        const ins = hubInputs(cid);
        body.innerHTML = `<div class="pm-dh"><h3>${esc(c.name)}</h3>${stBadge(s, cid)}</div>
          <p class="pm-lead">${esc(c.desc || "")}</p>
          <div class="pm-h4">연결된 발주처의 투자 계획</div>
          ${pairsOf(cid).map(({ g, e, other }) => pairItem(g, e, other)).join("")}`;
        return;
      }
      const us = c.mkt === "us" && ERC[c.code] ? ERC[c.code].next : null;
      const res = resultHTML(cid);
      body.innerHTML = `
        <div class="pm-dh"><h3>${esc(c.name)} <small>${esc(c.short_code || c.code || "")}</small></h3>${stBadge(s)}</div>
        <div class="pm-tags">${tierBadge(c)}${c.theme ? `<span class="badge">${esc(c.theme)}</span>` : ""}</div>
        <div class="pm-when">${c.when ? `<b>${esc(fmtWhen(c.when, true))}</b> KST` : `<b>일정 확인 중</b>`}<span>${esc(c.form || "")}${c.when ? " · " + esc(rel(c.when)) : ""}</span></div>
        ${c.when_note ? `<p class="pm-note">${esc(c.when_note)}</p>` : ""}
        ${(us && us.est_eps !== undefined && s === "pending") ? `<div class="pm-kv1"><span>EPS 컨센서스</span><b>$${num(us.est_eps)}</b><em>집계 ${esc(us.n_est || "")}명 · 전년 동기 $${num(us.last_year_eps)}</em></div>` : ""}
        ${c.consensus ? `<div class="pm-kv1"><span>컨센서스</span><b>${esc(c.consensus.text)}</b></div>` : ""}
        ${c.checks && c.checks.length ? `<div class="pm-h4">확인 항목</div><ul class="pm-checks">${c.checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <div class="pm-h4">결과</div>
        ${res || `<p class="pm-empty">${s === "pending" ? "발표 전입니다." : c.mkt === "us" ? "발표 완료 · EPS와 반응은 다음 정기 갱신(05:16·15:46 KST) 때 자동 입력됩니다." : "발표 완료 · 결과 수치를 입력하는 중입니다."}</p>`}
        <div class="pm-h4">연결된 짝 <small>${pairsOf(cid).length}</small></div>
        ${pairsOf(cid).map(({ g, e, other }) => pairItem(g, e, other)).join("") || `<p class="pm-empty">${esc(c.no_pair || "짝 없음")}</p>`}`;
    }

    function pairItem(g, e, other) {
      const o = CO[other] || {};
      return `<button class="pm-pi" data-e="${esc(e.id)}" data-g="${esc(g.id)}">
        <span class="pm-tb pm-t${e.type}">${TYPE_KO[e.type]}</span>
        <b>${esc(o.name || other)}</b>${stBadge(state(other), other)}
        <span class="pm-pb">${esc(e.basis)}</span></button>`;
    }

    function renderEdge(gid, eid) {
      const g = PM.groups.find((x) => x.id === gid); if (!g) return;
      const e = g.edges.find((x) => x.id === eid); if (!e) return;
      const a = nodeOf(g, e.from).co, b = nodeOf(g, e.to).co, A = CO[a] || {}, B = CO[b] || {};
      no.textContent = `CHART NO. ${(A.code || a)}-${(B.code || b)}`;
      const side = (cid) => { const c = CO[cid] || {}; const s = state(cid); const hl = headline(cid); return `<button class="pm-side" data-co="${esc(cid)}"><b>${esc(c.name)}</b>${stBadge(s, cid)}<span>${c.kind === "hub" ? esc(c.short || "") : c.when ? esc(fmtWhen(c.when, true)) + " KST" : esc(c.form || "일정 확인 중")}</span>${hl ? `<em>${esc(hl)}</em>` : ""}</button>`; };
      body.innerHTML = `
        <div class="pm-dh"><h3>${esc(A.name)} ${e.type === 1 ? "→" : "↔"} ${esc(B.name)}</h3></div>
        <div class="pm-tags"><span class="pm-tb pm-t${e.type}">${TYPE_KO[e.type]}</span>${e.label ? `<span class="badge">${esc(e.label)}</span>` : ""}<span class="pm-lv ${e.level === "확인" ? "ok" : "part"}">${e.level === "확인" ? "근거 확인" : "근거 일부 확인"}</span></div>
        <div class="pm-h4">왜 짝인가 — 연결 근거</div>
        <ul class="pm-basis">${(e.bases && e.bases.length ? e.bases : [e.basis]).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
        ${e.note ? `<p class="pm-caveat"><b>${e.level === "확인" ? "참고" : "주의"}</b>${esc(e.note)}</p>` : ""}
        <p class="pm-def">${esc(TYPE_DEF[e.type])}</p>
        <div class="pm-h4">두 기업의 발표 상태</div>
        <div class="pm-sides">${side(a)}${side(b)}</div>`;
    }

    function highlight() {
      board.classList.toggle("has-sel", !!sel);
      board.querySelectorAll(".sel,.near").forEach((x) => x.classList.remove("sel", "near"));
      if (!sel) return;
      if (sel.kind === "co") {
        board.querySelectorAll(`.pm-node[data-co="${sel.id}"]`).forEach((x) => x.classList.add("sel"));
        PM.groups.forEach((g) => g.edges.forEach((e) => {
          const a = nodeOf(g, e.from).co, b = nodeOf(g, e.to).co;
          if (a === sel.id || b === sel.id) {
            board.querySelectorAll(`.pm-group[data-g="${g.id}"] [data-e="${e.id}"]`).forEach((x) => x.classList.add("near"));
            board.querySelectorAll(`.pm-group[data-g="${g.id}"] .pm-node[data-co="${a === sel.id ? b : a}"]`).forEach((x) => x.classList.add("near"));
          }
        }));
      } else {
        const g = PM.groups.find((x) => x.id === sel.g), e = g && g.edges.find((x) => x.id === sel.id);
        if (!e) return;
        board.querySelectorAll(`.pm-group[data-g="${g.id}"] [data-e="${e.id}"]`).forEach((x) => x.classList.add("sel"));
        [nodeOf(g, e.from).id, nodeOf(g, e.to).id].forEach((nid) => board.querySelectorAll(`.pm-group[data-g="${g.id}"] .pm-node[data-n="${nid}"]`).forEach((x) => x.classList.add("near")));
      }
    }

    const panel = sec.querySelector("#pmPanel");
    const toPanel = () => { if (window.innerWidth < 1100) panel.scrollIntoView({ behavior: "smooth", block: "start" }); };
    function selectCo(cid, scroll) { sel = { kind: "co", id: cid }; renderCo(cid); highlight(); if (scroll) toPanel(); }
    function selectEdge(gid, eid, scroll) { sel = { kind: "edge", id: eid, g: gid }; renderEdge(gid, eid); highlight(); if (scroll) toPanel(); }

    sec.addEventListener("click", (ev) => {
      const t = ev.target;
      const row = t.closest(".pm-row");
      const chip = t.closest(".pm-chip[data-co]");
      if (row && !chip) return selectEdge(row.dataset.g, row.dataset.e, true);
      if (chip) return selectCo(chip.dataset.co, true);
      const n = t.closest(".pm-node"); if (n) return selectCo(n.dataset.co, true);
      const ed = t.closest(".pm-edge,.pm-lbl"); if (ed) { const g = ed.closest(".pm-group").dataset.g; return selectEdge(g, ed.dataset.e, true); }
      const pi = t.closest(".pm-pi"); if (pi) return selectEdge(pi.dataset.g, pi.dataset.e);
      const sd = t.closest(".pm-side,.pm-up button"); if (sd) return selectCo(sd.dataset.co);
      if (t.closest(".pm-svg") && !t.closest(".pm-node,.pm-edge,.pm-lbl")) { sel = null; highlight(); paint(); }
    });
    sec.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const n = ev.target.closest && ev.target.closest(".pm-node,.pm-edge"); if (!n) return;
      ev.preventDefault(); n.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    paint(); sizeLabels();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeLabels);
    setInterval(() => { if (!document.hidden) paint(); }, 60 * 1000);
    if (location.hash === "#sec-pair") sec.scrollIntoView();
  });
})();
