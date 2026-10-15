/* WizView — data/*.json을 읽어 렌더. 데이터는 예약 작업이 갱신하며 이 파일은 손대지 않아도 됩니다. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const V = Date.now();
  const get = (f) => (window.__DATA && window.__DATA[f]) ? Promise.resolve(window.__DATA[f])
    : fetch(`data/${f}?v=${V}`).then((r) => r.ok ? r.json() : null).catch(() => null);
  const [CFG, EV, ER, MK, TERMS] = await Promise.all([
    get("config.json"), get("events.json"), get("earnings.json"), get("market.json"), get("terms.json")]);
  const DAYS = (EV && EV.days) || {};
  const WEEK_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const TIER = (CFG && CFG.tiers) || {};
  const COMP = {};
  ((CFG && CFG.companies) || []).forEach((c) => (COMP[c.ticker] = c));

  /* ── 날짜 유틸 (한국시간) ── */
  const kstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(kstNow);
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const dowOf = (s) => parse(s).getDay();
  const mdLabel = (s) => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

  /* ── 상태 ── */
  let view = "grid", filter = "all";
  let month = TODAY.slice(0, 7);
  let selected = DAYS[TODAY] ? TODAY : null;
  if (!selected) { // 오늘 일정이 없으면 다음 일정일
    const ks = Object.keys(DAYS).sort();
    selected = ks.find((k) => k > TODAY) || ks[ks.length - 1] || TODAY;
  }

  /* ── 공통 포맷 ── */
  const fmtN = (v, dec = 2) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const sign = (v, dec = 2, suf = "") => (v > 0 ? "+" : "") + fmtN(v, dec) + suf;
  const ud = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ── 용어 풀이 ── */
  let tid = 0;
  const termify = (txt) => String(txt ?? "").replace(/\{\{([^}]+)\}\}/g, (m, k) => {
    const def = TERMS && TERMS[k];
    if (!def) return k;
    const id = "t" + (++tid);
    return `<span class="term" data-t="${id}">${esc(k)}</span><span class="term-def" id="${id}">${esc(def)}</span>`;
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".term");
    if (t) { const d = document.getElementById(t.dataset.t); if (d) d.classList.toggle("open"); }
  });

  /* ── SVG 스파크라인 ── */
  function spark(points, { w = 300, h = 110, color = "var(--gold)", labels = true, base = null, pad = 0.18, strokeW = 2.4, fill = true } = {}) {
    if (!points || points.length < 2) return "";
    const PT = labels ? 16 : 6, PB = labels ? 24 : 6, PL = 6, PR = 6;
    const vals = points.map((p) => p.v);
    let mn = Math.min(...vals, base ?? Infinity), mx = Math.max(...vals, base ?? -Infinity);
    if (mn === mx) { mn -= 1; mx += 1; }
    const p = (mx - mn) * pad || 1; mn -= p; mx += p;
    const x = (i) => PL + (w - PL - PR) * (i / (points.length - 1));
    const y = (v) => PT + (h - PT - PB) * (1 - (v - mn) / (mx - mn));
    const pts = points.map((q, i) => `${x(i).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    let s = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">`;
    if (base !== null && base !== undefined) s += `<line x1="${PL}" x2="${w - PR}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}" stroke="var(--grey3)" stroke-width="1" stroke-dasharray="3 3"/>`;
    if (fill) s += `<polygon points="${PL},${(h - PB).toFixed(1)} ${pts} ${(w - PR).toFixed(1)},${(h - PB).toFixed(1)}" fill="${color}" opacity="0.08"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    s += `<circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.5" fill="${color}"/>`;
    if (labels) {
      points.forEach((q, i) => { if (q.l) s += `<text x="${x(i).toFixed(1)}" y="${h - 7}" text-anchor="middle" class="spark-lb">${esc(q.l)}</text>`; });
      s += `<text x="${x(points.length - 1).toFixed(1)}" y="${(y(last.v) - 8).toFixed(1)}" text-anchor="end" class="spark-vl" fill="${color}">${esc(last.v)}</text>`;
    }
    return s + "</svg>";
  }

  /* 실적 ±5거래일 차트: 기준(발표 전 종가)=100, 반응일 강조 */
  function reactChart(r) {
    if (!r || !r.window || r.window.length < 3) return "";
    const w = 160, h = 46, PL = 4, PR = 4, PT = 6, PB = 4;
    const vals = r.window.map((p) => p.n);
    let mn = Math.min(...vals, 100), mx = Math.max(...vals, 100);
    const pad = (mx - mn) * 0.15 || 1; mn -= pad; mx += pad;
    const x = (i) => PL + (w - PL - PR) * (i / (r.window.length - 1));
    const y = (v) => PT + (h - PT - PB) * (1 - (v - mn) / (mx - mn));
    const col = r.pct > 0 ? "var(--up)" : "var(--down)";
    const ri = r.react_idx;
    const pre = r.window.slice(0, ri + 1).map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(" ");
    const post = r.window.slice(ri).map((p, i) => `${x(ri + i).toFixed(1)},${y(p.n).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${PL}" x2="${w - PR}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke="var(--line2)" stroke-dasharray="2 3"/>
      <line x1="${x(ri).toFixed(1)}" x2="${x(ri).toFixed(1)}" y1="${PT}" y2="${h - PB}" stroke="var(--gold-line)"/>
      <polyline points="${pre}" fill="none" stroke="var(--grey3)" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <polyline points="${post}" fill="none" stroke="${col}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <circle cx="${x(ri).toFixed(1)}" cy="${y(r.window[ri].n).toFixed(1)}" r="3" fill="${col}"/>
    </svg>`;
  }

  /* ── 갱신 표시 ── */
  (function () {
    const el = $("#updated");
    const u = (EV && EV.updated) || "—";
    const m = MK && MK.updated;
    let stale = false;
    try { const t = new Date(u.replace(" KST", "+09:00").replace(" ", "T")); stale = (kstNow - t) > 1000 * 60 * 60 * 30; } catch (e) { }
    el.classList.toggle("stale", stale);
    el.innerHTML = `<span class="dot"></span><span>일정 ${esc(u)}${m ? ` · 시세 ${esc(m.replace(" KST", ""))}` : ""}</span>`;
  })();

  /* ── 시장 체온계 ── */
  function renderTemp() {
    const box = $("#temp");
    if (!MK || !MK.items) { box.innerHTML = `<div class="tile">시세 데이터를 불러오지 못했습니다.</div>`; return; }
    const dec = (k) => ({ tnx: 2, dxy: 1, krw: 0, gold: 0, vix: 1, spx: 0, ndx: 0, kospi: 0 }[k] ?? 2);
    const order = ["vix", "tnx", "dxy", "krw", "gold", "spx", "ndx", "kospi"];
    const items = order.map((k) => MK.items.find((i) => i.key === k)).filter(Boolean);
    box.innerHTML = items.map((it) => {
      const d = dec(it.key), c = ud(it.chg), col = c === "up" ? "var(--up)" : c === "down" ? "var(--down)" : "var(--grey3)";
      const unitPre = it.unit === "$" ? "$" : "", unitPost = it.unit && it.unit !== "$" ? it.unit : "";
      let baseTxt = "";
      if (it.baseline !== null && it.baseline !== undefined) {
        const diff = it.value - it.baseline;
        const rel = Math.abs(diff) < (it.key === "tnx" ? 0.005 : 0.5) ? "기준선 수준" : (diff > 0 ? `기준선 <b>위</b>` : `기준선 <b>아래</b>`);
        const dtxt = it.key === "tnx" ? `${sign(diff, 2)}%p` : it.key === "krw" ? `${sign(diff, 0)}원` : it.key === "gold" ? `${sign(diff, 0)}` : sign(diff, 1);
        baseTxt = `<div class="base">${esc(it.baseline_label)} · ${rel} (${dtxt})</div>`;
      }
      if (it.key === "vix") {
        const bandIdx = Math.max(0, (CFG.vix_bands || []).findIndex((b) => it.value < b.max));
        const pos = Math.min(100, Math.max(0, it.value / 50 * 100));
        return `<div class="tile vix">
          <div class="lb">${esc(it.label)} <span class="band b${bandIdx}">${esc(it.band || "")}</span></div>
          <div class="v">${fmtN(it.value, 1)}</div>
          <div class="ch ${c}">${sign(it.chg, 1)} (${sign(it.pct, 2)}%)</div>
          <div class="gauge"><i style="left:${pos.toFixed(1)}%"></i></div>
          <div class="gauge-lb"><span>0</span><span>15 안정</span><span>20 보통</span><span>30 경계</span><span>50</span></div>
          <div class="meta">1년 평균 ${fmtN(it.avg1y, 1)} · 1년 범위 ${fmtN(it.lo1y, 1)}~${fmtN(it.hi1y, 1)} · 30일 ${fmtN(it.lo30, 1)}~${fmtN(it.hi30, 1)}</div>
        </div>`;
      }
      return `<div class="tile">
        <div class="lb">${esc(it.label)}</div>
        <div class="v">${unitPre}${fmtN(it.value, d)}<small>${esc(unitPost)}</small></div>
        <div class="ch ${c}">${sign(it.chg, d)} (${sign(it.pct, 2)}%)</div>
        ${spark(it.spark.map((p) => ({ v: p.v })), { w: 160, h: 34, color: col, labels: false, base: it.baseline ?? null, strokeW: 1.8 })}
        ${baseTxt}
      </div>`;
    }).join("");
    const asof = items.map((i) => i.asof).sort().pop();
    $("#tempAsof").textContent = `종가·현재가 기준 ${asof || ""} · 전일 대비 · 출처 Yahoo Finance`;
  }

  /* ── 이벤트 필터 ── */
  const evsOf = (dIso) => {
    const l = DAYS[dIso] || [];
    if (filter === "all") return l;
    if (filter === "macro") return l.filter((e) => ["econ", "fomc", "hol", "mkt"].includes(e.t));
    if (filter[0] === "t") return l.filter((e) => String(e.tier || "") === filter.slice(1));
    return l;
  };
  const released = (dIso, e) => !!(e.result) || (e.t === "earn" && dIso < TODAY && erHist(e.ticker, dIso));
  const erHist = (tk, dIso) => {
    const c = ER && ER.companies && ER.companies[tk];
    if (!c) return null;
    return c.history.find((h) => Math.abs((parse(h.date) - parse(dIso)) / 864e5) <= 1) || null;
  };
  const mkClass = (e) => e.t === "earn" ? `t${e.tier || 3}` : e.t;
  const tierLabel = (t) => (TIER[t] && TIER[t].label) || `${t}군`;

  /* ── 다음 7일 ── */
  function renderWeek() {
    let h = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(TODAY, i), dow = dowOf(d), evs = DAYS[d] || [];
      h += `<button class="wd ${i === 0 ? "today" : ""}" onclick="window.__pick('${d}')">
        <div class="d ${dow === 0 ? "sun" : ""}">${parse(d).getDate()}<small>${WEEK_KO[dow]}</small>${i === 0 ? `<span class="tag">오늘</span>` : ""}</div>
        ${evs.length ? `<ul>${evs.slice(0, 3).map((e) => `<li><i class="mk ${mkClass(e)}"></i><span>${esc(e.n)}${e.est ? '<span class="est">★</span>' : ""}</span></li>`).join("")}${evs.length > 3 ? `<li class="more">+${evs.length - 3}건</li>` : ""}</ul><span class="cnt">${evs.length}건</span>` : `<div class="none">일정 없음</div>`}
      </button>`;
    }
    $("#week").innerHTML = h;
  }

  /* ── 월 탭 ── */
  function months() {
    const set = new Set(Object.keys(DAYS).map((k) => k.slice(0, 7)));
    set.add(TODAY.slice(0, 7));
    return [...set].sort();
  }
  function renderMonths() {
    $("#months").innerHTML = months().map((m) => `<button class="${m === month ? "on" : ""}" data-m="${m}">${Number(m.slice(5))}월</button>`).join("");
  }

  /* ── 캘린더 ── */
  function renderCal() {
    const [Y, M] = month.split("-").map(Number);
    const first = new Date(Y, M - 1, 1), nDays = new Date(Y, M, 0).getDate(), fdow = first.getDay();
    const area = $("#cal");
    if (view === "grid") {
      let h = `<div class="dow">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((s) => `<span>${s}</span>`).join("")}</div><div class="grid">`;
      for (let i = 0; i < fdow; i++) h += `<div class="cell empty"></div>`;
      for (let d = 1; d <= nDays; d++) {
        const k = `${month}-${String(d).padStart(2, "0")}`, evs = evsOf(k), dow = (fdow + d - 1) % 7;
        const cls = ["cell"]; if (evs.length) cls.push("has"); if (k === selected) cls.push("sel"); if (k < TODAY) cls.push("past");
        h += `<button class="${cls.join(" ")}" onclick="window.__pick('${k}')" aria-label="${k} 일정 ${evs.length}건">
          <span class="n ${dow === 0 ? "sun" : ""}">${d}${k === TODAY ? `<span class="today-tag">오늘</span>` : ""}</span>
          ${evs.map((e) => { const rel = released(k, e); return `<span class="ev ${rel ? "done" : ""}">${rel ? `<span class="ck">✓</span>` : `<i class="mk ${mkClass(e)}"></i>`}<span>${esc(e.n)}${e.est ? '<span class="est">★</span>' : ""}</span></span>`; }).join("")}
          <span class="dots">${evs.map((e) => `<i class="mk ${released(k, e) ? "done" : mkClass(e)}"></i>`).join("")}</span>
        </button>`;
      }
      area.innerHTML = h + `</div>`;
    } else {
      let h = `<div class="list">`, lastWk = -1, any = false;
      for (let d = 1; d <= nDays; d++) {
        const k = `${month}-${String(d).padStart(2, "0")}`, evs = evsOf(k); if (!evs.length) continue;
        any = true;
        const wk = Math.floor((fdow + d - 1) / 7) + 1;
        if (wk !== lastWk) { h += `<div class="weekhead">${wk}주차</div>`; lastWk = wk; }
        const dow = (fdow + d - 1) % 7, open = k === selected;
        h += `<div class="day-item ${open ? "sel" : ""}"><button class="day-btn" onclick="window.__pick('${k}')">
          <span class="d ${dow === 0 ? "sun" : ""}"><span class="nn">${d}</span><br><span class="ww">${WEEK_KO[dow]}${k === TODAY ? " · 오늘" : ""}</span></span>
          <span class="evs">${evs.map((e) => { const rel = released(k, e); return `<span class="ev">${rel ? `<span class="ck">✓</span>` : `<i class="mk ${mkClass(e)}"></i>`}<span>${esc(e.n)}${e.est ? '<span class="est">★</span>' : ""} <span class="tm">· ${rel ? "발표 완료" : esc(e.time || "")}</span></span></span>`; }).join("")}</span>
        </button>${open ? `<div class="day-detail">${detailHTML(k)}</div>` : ""}</div>`;
      }
      area.innerHTML = any ? h + `</div>` : `<p class="p-empty">이 달에는 해당 필터의 일정이 없습니다.</p>`;
    }
    renderPanel();
  }

  /* ── 결과 카드 ── */
  function resultHTML(r) {
    const arrow = r.dir === "up" ? "▲" : r.dir === "down" ? "▼" : "–";
    const table = (r.rows && r.rows.length)
      ? `<div class="rtable"><div class="rrow rhead"><span>항목</span><span>발표</span><span>예상</span><span>비고</span></div>${r.rows.map((row) => `<div class="rrow"><span>${esc(row[0])}</span><span class="rv">${esc(row[1])}</span><span>${esc(row[2])}</span><span class="rn">${esc(row[3] || "")}</span></div>`).join("")}</div>`
      : `<div class="stat3"><div class="stat cur"><span class="sl">발표</span><span class="sv">${esc(r.actual)}</span></div><div class="stat"><span class="sl">예상</span><span class="sv">${esc(r.est)}</span></div><div class="stat"><span class="sl">이전</span><span class="sv">${esc(r.prev)}</span></div></div>`;
    return `<div class="res"><div class="res-flag"><span class="dot"></span>발표 완료</div>
      <div class="res-head">${arrow} ${termify(esc(r.head))}</div>${table}
      ${r.trend ? `<div class="spark-wrap">${spark(r.trend, { color: r.dir === "up" ? "var(--up)" : r.dir === "down" ? "var(--down)" : "var(--gold)" })}</div>` : ""}
      ${r.note ? `<h4>발표 내용</h4><p>${termify(esc(r.note))}</p>` : ""}</div>`;
  }

  /* ── 실적 이벤트의 팩트 블록 ── */
  function earnFacts(e, dIso) {
    const c = ER && ER.companies && ER.companies[e.ticker]; if (!c) return "";
    const mc = MK && MK.companies && MK.companies.find((x) => x.ticker === e.ticker);
    const past = erHist(e.ticker, dIso);
    let h = "";
    if (past) {
      const r = past.reaction;
      h += `<div class="res"><div class="res-flag"><span class="dot"></span>발표 완료 · ${esc(past.date)}</div>
        <div class="res-head">EPS $${fmtN(past.eps, 2)} vs 컨센서스 $${fmtN(past.est, 2)} → ${past.beat ? "상회" : "하회"}${r ? ` · 반응일 ${sign(r.pct, 1)}%` : ""}</div>
        <div class="stat3"><div class="stat cur"><span class="sl">EPS 발표</span><span class="sv">$${fmtN(past.eps, 2)}</span></div><div class="stat"><span class="sl">컨센서스</span><span class="sv">$${fmtN(past.est, 2)}</span></div><div class="stat"><span class="sl">서프라이즈</span><span class="sv">${sign(past.surprise_pct, 1)}%</span></div></div>
        ${r ? `<div class="spark-wrap">${reactChart(r)}<div class="fine" style="margin-top:2px">발표 전 종가(${esc(r.base_d)})=100 · 반응일 ${esc(r.react_d)} ${sign(r.pct, 2)}%${r.pct5 !== undefined ? ` · 5거래일 후 ${sign(r.pct5, 2)}%` : ""}</div></div>` : ""}
      </div>`;
    } else {
      const n = c.next || {};
      const same = n.date && Math.abs((parse(n.date) - parse(dIso)) / 864e5) <= 1;
      h += `<div class="facts">
        <div class="fact"><div class="fl">컨센서스 EPS</div><div class="fv">${same && n.est_eps !== null && n.est_eps !== undefined ? `$${fmtN(n.est_eps, 2)}` : "—"}<small>${same && n.n_est ? `추정 ${esc(n.n_est)}곳` : ""}</small></div></div>
        <div class="fact"><div class="fl">전년 동기 EPS</div><div class="fv">${same && n.last_year_eps !== null && n.last_year_eps !== undefined ? `$${fmtN(n.last_year_eps, 2)}` : "—"}<small>${same && n.last_year_date ? esc(n.last_year_date) : ""}</small></div></div>
        <div class="fact"><div class="fl">현재가 · 50일선 이격</div><div class="fv ${mc ? ud(mc.gap50) : ""}">${mc ? `$${fmtN(mc.price, 2)}` : "—"}<small>${mc ? `${sign(mc.gap50, 1)}%` : ""}</small></div></div>
      </div>`;
    }
    const s = c.stats || {};
    h += `<h4>최근 ${s.n || 0}분기 실적 반응 <span style="font-weight:600;color:var(--grey2)">(출처 Nasdaq·Yahoo Finance)</span></h4>
      <div class="co-stats">
        <div class="cs"><div class="l">EPS 상회</div><div class="v">${s.beats ?? "—"}<small>/${s.n_beats ?? "—"}</small></div></div>
        <div class="cs"><div class="l">반응일 상승</div><div class="v">${s.ups ?? "—"}<small>/${s.n_ups ?? "—"}</small></div></div>
        <div class="cs"><div class="l">평균 변동폭</div><div class="v">±${fmtN(s.avg_abs_move, 1)}<small>%</small></div></div>
        <div class="cs"><div class="l">최대 상승·하락</div><div class="v" style="font-size:.82rem">${sign(s.max_up, 1)}% · ${sign(s.max_down, 1)}%</div></div>
      </div>
      <div class="qgrid">${c.history.slice(0, 8).map(qCard).join("")}</div>`;
    return h;
  }
  function qCard(hq) {
    const r = hq.reaction;
    return `<div class="q">
      <div class="qh"><b>${esc(hq.fq || "")}</b><span>${esc(hq.date.slice(2).replace(/-/g, "."))}</span></div>
      <div class="qe"><span class="eps">${fmtN(hq.eps, 2)}<small> / 예상 ${fmtN(hq.est, 2)}</small></span>${hq.beat === undefined ? "" : hq.beat ? `<span class="bt">상회</span>` : `<span class="ms">하회</span>`}</div>
      ${r ? `<div class="qr ${ud(r.pct)}">${sign(r.pct, 1)}%<small>5일 ${r.pct5 !== undefined ? sign(r.pct5, 1) + "%" : "—"}</small></div>${reactChart(r)}` : `<div class="qr">—</div>`}
    </div>`;
  }

  /* ── 상세(진단서) ── */
  function detailHTML(dIso) {
    const evs = evsOf(dIso);
    if (!evs.length) return `<p class="p-empty">이날은 표시할 일정이 없습니다.</p>`;
    return evs.map((e) => {
      const rel = released(dIso, e);
      const typeLb = { econ: "경제지표", earn: "실적", fomc: "FOMC", hol: "휴장", mkt: "시장 이벤트" }[e.t] || e.t;
      return `<div class="diag">
        <div class="name">${esc(e.n)}
          <span class="badge ${e.t}">${typeLb}</span>
          ${e.tier ? `<span class="badge t${e.tier}">${esc(tierLabel(e.tier))}</span>` : ""}
          ${rel ? `<span class="badge done">✓ 발표됨</span>` : `<span class="badge soon">발표 예정</span>`}
          ${e.est ? `<span class="badge est">★ 예상일</span>` : ""}
        </div>
        <div class="time">${e.time ? `발표: ${esc(e.time)} (한국시간)` : ""} <span class="imp">${"◆".repeat(e.imp || 1)}<span class="off">${"◆".repeat(3 - (e.imp || 1))}</span> ${["", "정기", "주요", "정밀"][e.imp || 1]}</span></div>
        ${e.t === "earn" ? earnFacts(e, dIso) : ""}
        ${e.result ? resultHTML(e.result) : ""}
        ${e.why ? `<h4>무엇이 발표되나</h4><p>${termify(esc(e.why))}</p>` : ""}
        ${e.watch ? `<h4>발표 항목</h4><p>${termify(esc(e.watch))}</p>` : ""}
        ${e.stocks && e.stocks.length ? `<h4>연결되는 종목·테마 <span style="font-weight:600;color:var(--grey2)">(금색 = 클리닉에서 다룬 항목)</span></h4><div class="stocks">${e.stocks.map((s) => `<span class="stock ${s[1] ? "core" : ""}">${esc(s[0])}</span>`).join("")}</div>` : ""}
        ${e.src && e.src.length ? `<div class="src">출처 ${e.src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
  }
  function renderPanel() {
    const dow = dowOf(selected);
    $("#chartNo").textContent = `CHART NO. ${selected.slice(2, 4)}${selected.slice(5, 7)}-${selected.slice(8)}`;
    $("#panelBody").innerHTML = `<div class="p-date">${mdLabel(selected)}<small>${WEEK_KO[dow]}요일${selected === TODAY ? " · 오늘" : ""}</small></div>` + detailHTML(selected);
  }

  /* ── 학습기업 카드 ── */
  function renderCos() {
    const box = $("#cos");
    if (!ER || !ER.companies) { box.innerHTML = ""; return; }
    const list = Object.entries(ER.companies).sort((a, b) => (a[1].tier - b[1].tier) || a[0].localeCompare(b[0]));
    box.innerHTML = list.map(([tk, c]) => {
      const mc = MK && MK.companies && MK.companies.find((x) => x.ticker === tk);
      const s = c.stats || {}, n = c.next;
      let nextTxt = "";
      if (n && n.date) nextTxt = `<span>다음 발표 <b>${esc(n.date)}</b> 현지 ${n.rt === "pre" ? "장전" : "장후"}${n.rt === "post" ? " (한국시간 다음 날 새벽)" : " (한국시간 당일 밤)"}</span><span>컨센서스 EPS <b>${n.est_eps !== null && n.est_eps !== undefined ? "$" + fmtN(n.est_eps, 2) : "—"}</b></span><span>전년 동기 <b>${n.last_year_eps !== null && n.last_year_eps !== undefined ? "$" + fmtN(n.last_year_eps, 2) : "—"}</b></span>`;
      else {
        const last = c.history[0];
        nextTxt = `<span>최근 발표 <b>${esc(last ? last.date : "—")}</b></span><span>다음 발표일 <b>미확정</b> (통상 ${last ? (parse(last.date).getMonth() + 4) % 12 || 12 : "—"}월 중순)</span>`;
      }
      const summary = `${s.n}분기 중 EPS 컨센서스 상회 ${s.beats}회 · 반응일 상승 ${s.ups}회 · 상회했는데 하락 ${s.beat_and_down}회 · 반응일 평균 변동폭 ±${fmtN(s.avg_abs_move, 1)}%`;
      return `<div class="co" id="co-${tk}">
        <div class="co-h">
          <div class="nm">${esc(c.name)} <small>${esc(c.en)} · ${esc(tk)}</small><span class="badge t${c.tier}">${esc(tierLabel(c.tier))}</span></div>
          ${mc ? `<div class="px"><div class="pv">$${fmtN(mc.price, 2)}</div><div class="pc ${ud(mc.pct1d)}">${sign(mc.pct1d, 2)}% <span style="color:var(--grey2);font-weight:600">· 50일선 ${sign(mc.gap50, 1)}%</span></div></div>` : ""}
        </div>
        <div class="co-next">${nextTxt}</div>
        <div class="co-sum">${esc(summary)}</div>
        <div class="qgrid">${c.history.slice(0, 8).map(qCard).join("")}</div>
        <div class="co-foot"><span>차트: 발표 전 종가=100, 회색=발표 전 5일, 색=반응일 이후 5일 · 장전 발표는 당일, 장후 발표는 다음 거래일이 반응일</span><a href="https://www.nasdaq.com/market-activity/stocks/${tk.toLowerCase()}/earnings" target="_blank" rel="noopener">Nasdaq</a></div>
      </div>`;
    }).join("");
  }

  /* ── 변경 이력 ── */
  function renderChangelog() {
    const cl = (EV && EV.changelog) || [];
    $("#changelog").innerHTML = cl.slice(-8).reverse().map((c) => `<li><time>${esc(c.at)}</time><span>${esc(c.msg)}</span></li>`).join("") || `<li>변경 이력이 없습니다.</li>`;
  }

  /* ── 인터랙션 ── */
  window.__pick = (k) => {
    selected = k; month = k.slice(0, 7); renderMonths(); renderCal();
    if (window.innerWidth < 1100) $("#panel").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#months").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (!b) return; month = b.dataset.m; renderMonths(); renderCal(); });
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; filter = b.dataset.f; document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b)); renderCal(); });
  $("#seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (!b) return; view = b.dataset.v; document.querySelectorAll("#seg button").forEach((c) => c.classList.toggle("on", c === b)); renderCal(); });

  /* ── 테마 ── */
  (function () {
    const root = document.documentElement, btn = $("#theme");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const current = () => root.getAttribute("data-theme") || (mq.matches ? "dark" : "light");
    const apply = (t) => { root.setAttribute("data-theme", t); try { localStorage.setItem("wv-theme", t); } catch (e) { } };
    btn.addEventListener("click", () => apply(current() === "dark" ? "light" : "dark"));
  })();

  renderTemp(); renderWeek(); renderMonths(); renderCal(); renderCos(); renderChangelog();
})();
