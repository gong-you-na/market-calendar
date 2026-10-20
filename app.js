/* WizView — data/*.json을 읽어 렌더. 데이터는 예약 작업이 갱신하며 이 파일은 손대지 않아도 됩니다. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const V = Date.now();
  const get = (f) => (window.__DATA && window.__DATA[f]) ? Promise.resolve(window.__DATA[f])
    : fetch(`data/${f}?v=${V}`).then((r) => r.ok ? r.json() : null).catch(() => null);
  // 매시간 갱신 파일(이슈·인물·청산맵)은 `live` 브랜치(raw.githubusercontent)를 먼저 읽고, 실패하면 배포본 data/ 사용
  const LIVE = "https://raw.githubusercontent.com/gong-you-na/market-calendar/live/data/";
  const getLive = async (f) => {
    try { const r = await fetch(LIVE + f + "?v=" + Math.floor(V / 300000), { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (j && j.updated) return j; } } catch (e) { }
    return get(f);
  };
  const [CFG, EV, ER, MK, TERMS, HM, TOOTH, NEWS, VOICES, LIQ] = await Promise.all([
    get("config.json"), get("events.json"), get("earnings.json"), get("market.json"), get("terms.json"), get("heatmap.json"),
    get("tooth.json"), getLive("news.json"), getLive("voices.json"), getLive("liq.json")]);
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
    const n = NEWS && NEWS.updated;
    el.innerHTML = `<span class="dot"></span><span>일정 ${esc(u)}${m ? ` · 시세 ${esc(m.replace(" KST", ""))}` : ""}${n ? ` · 이슈 ${esc(n.replace(" KST", ""))}` : ""}</span>`;
  })();

  /* ── 투쓰의 한마디 ── */
  function renderTooth() {
    const box = $("#tooth"); const items = (TOOTH && TOOTH.items) || [];
    if (!items.length) { box.innerHTML = `<div class="tooth-card empty"><span class="wt">W.T</span><div class="tooth-body"><div class="tooth-txt">오늘의 한마디가 아직 없습니다.</div><div class="tooth-meta">운영자가 전달하면 이 자리에 올라옵니다.</div></div></div>`; $("#toothAsof").textContent = ""; return; }
    const cur = items[0];
    box.innerHTML = `<div class="tooth-card"><span class="wt">W.T</span><div class="tooth-body"><div class="tooth-txt">${esc(cur.text).replace(/\n/g, "<br>")}</div><div class="tooth-meta">${esc(cur.at || "")}${cur.title ? " · " + esc(cur.title) : ""}</div></div></div>`
      + (items.length > 1 ? `<details class="tooth-prev"><summary>지난 한마디 ${items.length - 1}건</summary>${items.slice(1, 8).map((t) => `<div class="tooth-old"><time>${esc(t.at || "")}</time><span>${esc(t.text)}</span></div>`).join("")}</details>` : "");
    $("#toothAsof").textContent = cur.at ? `${cur.at} 기준` : "";
  }

  /* ── 시장 체온계 (미국 / 한국 탭) ── */
  let tempTab = "us";
  function renderTemp() {
    const box = $("#temp");
    if (!MK || !MK.items) { box.innerHTML = `<div class="tile">시세 데이터를 불러오지 못했습니다.</div>`; return; }
    const cfgM = (CFG && CFG.market) || [];
    const decOf = (k) => (cfgM.find((m) => m.key === k) || {}).decimals ?? 2;
    const tabOf = (k) => (cfgM.find((m) => m.key === k) || {}).tab || "us";
    const order = cfgM.map((m) => m.key);
    const items = order.map((k) => MK.items.find((i) => i.key === k)).filter((i) => i && tabOf(i.key) === tempTab);
    box.style.setProperty("--n", items.length);
    box.innerHTML = items.map((it) => {
      const d = decOf(it.key), c = ud(it.chg), col = c === "up" ? "var(--up)" : c === "down" ? "var(--down)" : "var(--grey3)";
      const unitPre = it.unit === "$" ? "$" : "", unitPost = it.unit && it.unit !== "$" ? it.unit : "";
      let baseTxt = "";
      if (it.baseline !== null && it.baseline !== undefined) {
        const diff = it.value - it.baseline;
        const rel = Math.abs(diff) < (it.key === "tnx" ? 0.005 : 0.5) ? "기준선 수준" : (diff > 0 ? `기준선 <b>위</b>` : `기준선 <b>아래</b>`);
        const dtxt = it.key === "tnx" ? `${sign(diff, 2)}%p` : it.key === "krw" ? `${sign(diff, 0)}원` : it.key === "gold" ? `${sign(diff, 0)}` : sign(diff, 1);
        baseTxt = `<div class="base">${esc(it.baseline_label)} · ${rel} (${dtxt})</div>`;
      }
      if (it.key === "btc" && it.krw) baseTxt = `<div class="base">업비트 <b>${fmtN(it.krw, 0)}원</b> (${sign(it.krw_pct, 2)}%)${it.premium_pct !== undefined ? ` · 김치 프리미엄 ${sign(it.premium_pct, 2)}%` : ""}</div>`;
      if (it.key === "vix") {
        const bandIdx = Math.max(0, (CFG.vix_bands || []).findIndex((b) => it.value < b.max));
        const pos = Math.min(100, Math.max(0, it.value / 50 * 100));
        return `<div class="tile vix">
          <div class="lb">${esc(it.label)} <span class="band b${bandIdx}">${esc(it.band || "")}</span></div>
          <div class="v">${fmtN(it.value, 1)}</div>
          <div class="ch ${c}">${sign(it.chg, 1)} (${sign(it.pct, 2)}%)</div>
          <div class="gauge"><i style="left:${pos.toFixed(1)}%"></i></div>
          <div class="gauge-lb"><span>0</span><span>15 안정</span><span>20 보통</span><span>30 경계</span><span>50</span></div>
          <div class="meta">1년 평균 ${fmtN(it.avg1y, 1)} · 범위 ${fmtN(it.lo1y, 1)}~${fmtN(it.hi1y, 1)} · 30일 ${fmtN(it.lo30, 1)}~${fmtN(it.hi30, 1)}</div>
        </div>`;
      }
      return `<div class="tile">
        <div class="lb">${esc(it.label)}</div>
        <div class="v">${unitPre}${fmtN(it.value, d)}<small>${esc(unitPost)}</small></div>
        <div class="ch ${c}">${sign(it.chg, d)} (${sign(it.pct, 2)}%)</div>
        ${spark(it.spark.map((p) => ({ v: p.v })), { w: 220, h: 54, color: col, labels: false, base: it.baseline ?? null, strokeW: 2 })}
        ${baseTxt || `<div class="base">30일 ${unitPre}${fmtN(it.lo30, d)}~${fmtN(it.hi30, d)}${esc(unitPost)}</div>`}
      </div>`;
    }).join("");
    const asof = items.map((i) => i.asof).sort().pop();
    $("#tempAsof").textContent = `종가·현재가 기준 ${asof || ""} · 전일 대비 · 출처 Yahoo Finance${tempTab === "kr" ? "·업비트" : ""}${MK.live ? " · 실시간 갱신" : ""}`;
  }
  $("#tempTab").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (!b) return; tempTab = b.dataset.t; document.querySelectorAll("#tempTab button").forEach((c) => c.classList.toggle("on", c === b)); renderTemp(); });

  /* ── 오늘의 주요 이슈 ── */
  let newsRegion = "all", newsOpen = false;
  const ago = (isoUtc) => { const m = Math.round((Date.now() - new Date(isoUtc)) / 60000); if (m < 60) return `${Math.max(1, m)}분 전`; const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`; return `${Math.floor(h / 24)}일 전`; };
  function newsCard(it, big) {
    return `<a class="news ${big ? "big" : ""} ${it.region}" href="${esc(it.url)}" target="_blank" rel="noopener">
      <div class="news-src"><span class="src-tag ${it.region}">${esc(it.source)}</span><span class="news-ago">${ago(it.at)}</span></div>
      <div class="news-t">${esc(it.title)}</div></a>`;
  }
  function renderNews() {
    const box = $("#newsTop"), more = $("#newsMore");
    if (!NEWS || !NEWS.items) { box.innerHTML = `<div class="news big">이슈 데이터를 불러오지 못했습니다.</div>`; return; }
    const all = NEWS.items.filter((i) => newsRegion === "all" || i.region === newsRegion);
    const topIds = new Set(NEWS.top || []);
    let top = all.filter((i) => topIds.has(i.id)); if (top.length < 3) top = top.concat(all.filter((i) => !topIds.has(i.id)).slice(0, 3 - top.length));
    const rest = all.filter((i) => !top.includes(i)).sort((a, b) => b.at.localeCompare(a.at));
    box.innerHTML = top.map((i) => newsCard(i, true)).join("");
    more.innerHTML = rest.slice(0, 40).map((i) => newsCard(i, false)).join("");
    more.hidden = !newsOpen; $("#newsMoreBtn").textContent = newsOpen ? "접기" : `더보기 (${rest.length}건)`;
    $("#newsAsof").textContent = `${esc(NEWS.updated)} 갱신 · 매시간 자동 수집 · 출처 ${(NEWS.sources || []).join("·")}`;
  }
  $("#newsRegion").addEventListener("click", (e) => { const b = e.target.closest("button[data-r]"); if (!b) return; newsRegion = b.dataset.r; document.querySelectorAll("#newsRegion button").forEach((c) => c.classList.toggle("on", c === b)); renderNews(); });
  $("#newsMoreBtn").addEventListener("click", () => { newsOpen = !newsOpen; renderNews(); });

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

  renderTooth(); renderTemp(); renderNews(); renderWeek(); renderMonths(); renderCal(); renderCos(); renderChangelog();
  /* ══════════ 히트맵 ══════════ */
  let hmMarket = "us", hmPeriod = "d1";
  function renderHM() {
    if (!HM || !window.renderHeatmap) return;
    const data = HM[hmMarket]; if (!data) return;
    const el = $("#hm");
    renderHeatmap(el, data, { period: hmPeriod, tiers: TIER, etf: hmMarket === "etf", extra: (d) => {
      const base = d.t.split(".")[0], c = ER && ER.companies && ER.companies[base]; if (!c) return "";
      const s = c.stats || {}, n = c.next;
      return `<div class="tt-x">${n && n.date ? `다음 실적 ${esc(n.date)} · ` : ""}최근 ${s.n}분기 EPS 상회 ${s.beats}회 · 반응일 상승 ${s.ups}회</div>`;
    } });
    const idx = HM.index || {};
    const names = hmMarket === "kr" ? [["^KS11", "코스피"], ["^KQ11", "코스닥"]] : [["^GSPC", "S&P 500"], ["^IXIC", "나스닥"], ["^DJI", "다우"], ["^RUT", "러셀 2000"]];
    $("#hmIdx").innerHTML = names.map(([k, lb]) => { const v = idx[k]; if (!v) return ""; return `<span>${lb}<b>${fmtN(v.p, 0)}</b><b class="${ud(v.d1)}">${sign(v.d1, 2)}%</b></span>`; }).join("")
      + `<span>${hmMarket === "us" ? "S&P 500" : hmMarket === "kr" ? "코스피 상위" : "ETF"} ${data.stocks.length}종목 · ${data.sectors.length}${hmMarket === "etf" ? "그룹" : "섹터"}</span>`;
    $("#hmLegendNote").textContent = hmMarket === "etf" ? "타일 크기 = 운용자산(AUM, 제곱근 비례) · 그룹 구성 finviz ETF 맵 기준 + 한국·대만·일본·브라질·반도체 레버리지 · 출처 Yahoo Finance·StockAnalysis" : "타일 크기 = 시가총액 · 출처 Yahoo Finance · S&P 500 구성 Wikipedia/StockAnalysis";
    $("#hmAsof").textContent = `${esc(HM.updated)} 기준 · 1일 등락은 장외 시간엔 프리·애프터마켓 가격이 반영될 수 있음`;
  }
  $("#hmMarket").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (!b) return; hmMarket = b.dataset.m; document.querySelectorAll("#hmMarket button").forEach((c) => c.classList.toggle("on", c === b)); renderHM(); });
  $("#hmPeriod").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; hmPeriod = b.dataset.p; document.querySelectorAll("#hmPeriod button").forEach((c) => c.classList.toggle("on", c === b)); renderHM(); });
  let hmT; window.addEventListener("resize", () => { clearTimeout(hmT); hmT = setTimeout(renderHM, 150); });

  /* ══════════ 비트코인 청산맵 ══════════ */
  let liqMap = null, liqDays = 3;
  function renderLiq() {
    if (!LIQ || !LIQ.grid || !window.LiqMap) { $("#liqTop").innerHTML = `<div class="nm">청산맵 데이터를 불러오지 못했습니다.</div>`; return; }
    const U = window.liqFmt.usd;
    const chg = LIQ.prev24 ? (LIQ.price / LIQ.prev24 - 1) * 100 : 0;
    $("#liqTop").innerHTML = `<div class="nm">비트코인 <small>BTC 무기한 선물 · ${(LIQ.sources || []).join("·")} 합산</small>${LIQ.live ? `<span class="live">LIVE</span>` : ""}</div>
      <div class="px"><b>$${fmtN(LIQ.price, 0)}</b><span class="${ud(chg)}">${sign(chg, 2)}% <small>24h</small></span></div>`;
    if (!liqMap) liqMap = new LiqMap($("#liqCanvas"), $("#liqTip"), LIQ, { days: liqDays }); else { liqMap.update(LIQ); liqMap.set({ days: liqDays }); }
    const l24 = LIQ.liq24h || {}, tot = (l24.long_usd || 0) + (l24.short_usd || 0);
    const above = (LIQ.levels || []).filter((l) => l.p > LIQ.price).sort((a, b) => b.usd - a.usd).slice(0, 3).sort((a, b) => a.p - b.p);
    const below = (LIQ.levels || []).filter((l) => l.p < LIQ.price).sort((a, b) => b.usd - a.usd).slice(0, 3).sort((a, b) => b.p - a.p);
    $("#liqSide").innerHTML = `
      <div class="ls-card"><div class="ls-l">24시간 실제 청산 <small>${esc(l24.src || "")}</small></div>
        <div class="ls-bar"><i class="long" style="width:${tot ? (l24.long_usd / tot * 100).toFixed(1) : 50}%"></i></div>
        <div class="ls-row"><span class="long">롱 ${U(l24.long_usd || 0)}</span><span class="short">숏 ${U(l24.short_usd || 0)}</span></div><div class="ls-sub">${l24.n || 0}건 체결</div></div>
      <div class="ls-card"><div class="ls-l">추정 청산 밀집 구간 <small>현재가 기준</small></div>
        ${above.map((l) => `<div class="ls-row lv"><span>$${fmtN(l.p, 0)} <em>숏 청산</em></span><b class="short">${U(l.usd)}</b></div>`).join("")}
        <div class="ls-now">현재가 $${fmtN(LIQ.price, 0)}</div>
        ${below.map((l) => `<div class="ls-row lv"><span>$${fmtN(l.p, 0)} <em>롱 청산</em></span><b class="long">${U(l.usd)}</b></div>`).join("")}</div>
      <div class="ls-card"><div class="ls-l">미결제약정(OI) <small>거래소별</small></div>
        ${(LIQ.exchanges || []).map((e) => `<div class="ls-row"><span>${esc(e.name)}</span><b>${U(e.oi_usd)} <small>펀딩 ${sign(e.funding, 4)}%</small></b></div>`).join("")}
        <div class="ls-row tot"><span>합계</span><b>${U(LIQ.oi_total_usd || 0)}</b></div>
        <div class="ls-sub">평균 펀딩비(8h) ${LIQ.funding_avg !== null && LIQ.funding_avg !== undefined ? sign(LIQ.funding_avg, 4) + "%" : "—"} · 롱/숏 계정 비율 ${LIQ.lsr ? fmtN(LIQ.lsr, 2) : "—"} (OKX)</div></div>
      <div class="ls-card recent"><div class="ls-l">최근 청산 체결</div>
        ${(LIQ.recent || []).slice(0, 8).map((r) => `<div class="ls-row"><span><em class="${r.side}">${r.side === "long" ? "롱" : "숏"}</em> $${fmtN(r.px, 0)}</span><b>${U(r.usd)} <small>${new Date(r.t * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" })}</small></b></div>`).join("")}</div>`;
    $("#liqAsof").textContent = `${esc(LIQ.updated)} 갱신 · 매시간 · 바이낸스·바이비트는 미국 서버 접근 제한으로 제외`;
    $("#liqMethod").textContent = LIQ.method || "";
  }
  $("#liqRange").addEventListener("click", (e) => { const b = e.target.closest("button[data-r]"); if (!b) return; liqDays = +b.dataset.r; document.querySelectorAll("#liqRange button").forEach((c) => c.classList.toggle("on", c === b)); if (liqMap) liqMap.set({ days: liqDays }); });

  /* ══════════ 주요 인물의 한마디 ══════════ */
  let vPerson = null, vKind = "all";
  const initials = (p) => esc((p.en || p.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase());
  function renderVoices() {
    const pe = $("#people"), vo = $("#voices");
    if (!VOICES || !VOICES.people) { pe.innerHTML = ""; vo.innerHTML = `<div class="v-empty">인물 데이터를 불러오지 못했습니다.</div>`; return; }
    const items = VOICES.items || [];
    const cnt = (id) => items.filter((v) => v.person === id && (vKind === "all" || v.kind === vKind)).length;
    pe.innerHTML = `<button class="person ${vPerson === null ? "on" : ""}" data-p=""><span class="avatar all">ALL</span><span class="pn">전체</span><span class="pr">최신순</span></button>` + VOICES.people.map((p) => `<button class="person ${vPerson === p.id ? "on" : ""}" data-p="${esc(p.id)}">
        <span class="avatar">${p.img ? `<img src="${esc(p.img)}?v=${V}" alt="${esc(p.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'${initials(p)}'}))">` : `<b>${initials(p)}</b>`}</span>
        <span class="pn">${esc(p.name)}</span><span class="pr">${esc(p.role)}</span>${cnt(p.id) ? `<span class="pc">${cnt(p.id)}</span>` : ""}</button>`).join("");
    const byId = {}; VOICES.people.forEach((p) => (byId[p.id] = p));
    const list = items.filter((v) => (!vPerson || v.person === vPerson) && (vKind === "all" || v.kind === vKind)).slice(0, vPerson ? 60 : 36);
    const sel = vPerson && byId[vPerson];
    vo.innerHTML = (sel ? `<div class="v-head"><span class="avatar lg">${sel.img ? `<img src="${esc(sel.img)}?v=${V}" alt="">` : `<b>${initials(sel)}</b>`}</span><div><div class="v-name">${esc(sel.name)} <small>${esc(sel.en)} · ${esc(sel.role)}</small></div><div class="v-links">${sel.x ? `<a href="https://x.com/${esc(sel.x)}" target="_blank" rel="noopener">X @${esc(sel.x)}</a>` : ""}${sel.truth ? `<a href="https://truthsocial.com/@${esc(sel.truth)}" target="_blank" rel="noopener">Truth Social</a>` : ""}${sel.img_credit && sel.img_credit.url ? `<a href="${esc(sel.img_credit.url)}" target="_blank" rel="noopener" class="credit">사진 ${esc(sel.img_credit.license || "Wikimedia")}</a>` : ""}</div></div></div>` : "")
      + (list.length ? `<div class="bubbles">${list.map((v) => { const p = byId[v.person] || {}; return `<div class="bubble k-${v.kind}">
          <span class="avatar sm">${p.img ? `<img src="${esc(p.img)}?v=${V}" alt="">` : `<b>${initials(p)}</b>`}</span>
          <div class="bb"><div class="bb-h"><b>${esc(p.name || v.person)}</b><span class="kind ${v.kind}">${v.kind === "post" ? "원문 게시물" : v.kind === "manual" ? "직접 입력" : "보도"}</span><span class="src">${esc(v.src || "")}</span><time>${ago(v.at)}</time></div>
          <div class="bb-t">${esc(v.text)}</div>${v.url ? `<a class="bb-l" href="${esc(v.url)}" target="_blank" rel="noopener">${v.kind === "post" ? "원문 보기" : v.kind === "manual" ? "출처" : "기사 보기"} ↗</a>` : ""}</div></div>`; }).join("")}</div>` : `<div class="v-empty">표시할 발언이 없습니다.</div>`);
    $("#voicesAsof").textContent = `${esc(VOICES.updated)} 갱신 · 매시간 · ${VOICES.people.length}명`;
  }
  $("#people").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; vPerson = b.dataset.p || null; renderVoices(); });
  $("#voicesKind").addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; vKind = b.dataset.k; document.querySelectorAll("#voicesKind button").forEach((c) => c.classList.toggle("on", c === b)); renderVoices(); });
  // 테마 바뀌면 캔버스·히트맵 다시 그림
  new MutationObserver(() => { if (liqMap) liqMap.draw(); renderHM(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ══════════ 실시간 (Netlify Function 프록시, 있으면) ══════════ */
  async function liveRefresh() {
    try {
      const ping = await fetch("/.netlify/functions/yf?ping=1", { cache: "no-store" }); if (!ping.ok) return;
    } catch (e) { return; }
    // 2) 체온계 현재가
    if (MK && MK.items) {
      try {
        const syms = MK.items.map((i) => i.symbol).join(",");
        const r = await fetch(`/.netlify/functions/yf?kind=spark&symbols=${encodeURIComponent(syms)}`, { cache: "no-store" });
        if (r.ok) { const j = await r.json(); let touched = false; for (const it of MK.items) { const v = j[it.symbol]; if (!v || v.fulldayPrice == null) continue; const dec = ({ tnx: 2, dxy: 1, krw: 0, gold: 0, vix: 1, wti: 2 })[it.key] ?? 0; it.value = +v.fulldayPrice.toFixed(dec); it.prev = +(v.chartPreviousClose ?? it.prev).toFixed(dec); it.chg = +(it.value - it.prev).toFixed(dec); it.pct = +((it.value / it.prev - 1) * 100).toFixed(2); touched = true; if (it.key === "btc" && LIQ && LIQ.grid) { LIQ.price = Math.round(it.value); LIQ.live = true; } } if (touched) { MK.live = true; renderTemp(); if (LIQ && LIQ.live) renderLiq(); } }
      } catch (e) { }
    }
    // 3) 히트맵 1일 등락률 (미장·국장 현재 탭만, 20개씩)
    if (HM) {
      try {
        const data = HM[hmMarket]; const syms = data.stocks.map((s) => s.t); let touched = false;
        for (let i = 0; i < syms.length; i += 20) {
          const r = await fetch(`/.netlify/functions/yf?kind=spark&symbols=${encodeURIComponent(syms.slice(i, i + 20).join(","))}`, { cache: "no-store" }); if (!r.ok) continue;
          const j = await r.json(); for (const s of data.stocks) { const v = j[s.t]; if (v && v.fulldayChangePercent != null) { s.d1 = +v.fulldayChangePercent.toFixed(2); s.p = v.fulldayPrice ?? s.p; touched = true; } }
        }
        if (touched) { renderHM(); $("#hmAsof").textContent = "실시간(지연 시세) 갱신 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); }
      } catch (e) { }
    }
  }

  renderHM(); renderLiq(); renderVoices();
  liveRefresh(); setInterval(liveRefresh, 5 * 60 * 1000);
  // 매시간 파일(이슈·인물·청산맵)은 30분마다 다시 읽음
  setInterval(async () => { const [n, v, l] = await Promise.all([getLive("news.json"), getLive("voices.json"), getLive("liq.json")]); if (n && NEWS && n.updated !== NEWS.updated) { Object.assign(NEWS, n); renderNews(); } if (v && VOICES && v.updated !== VOICES.updated) { Object.assign(VOICES, v); renderVoices(); } if (l && LIQ && l.updated !== LIQ.updated) { Object.assign(LIQ, l); renderLiq(); } }, 30 * 60 * 1000);

})();
