/* WizTopics — data/index.json(날짜 목록)과 data/YYYY-MM-DD.json(하루치)을 읽어 렌더. 페이지 코드는 예약 작업이 건드리지 않는다. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }));
  const sgn = (v, unit) => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + num(v, 2) + (unit || ""));
  const cls = (v) => (v == null || isNaN(v) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");

  /* ── 테마 ── */
  (function () {
    const root = document.documentElement, btn = $("#theme");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const current = () => root.getAttribute("data-theme") || (mq.matches ? "dark" : "light");
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("wt-theme", next); } catch (e) {}
      rerenderCharts();
    });
  })();

  /* ── 탭 ── */
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("on", x === b));
    $$(".panel").forEach((p) => p.classList.toggle("on", p.dataset.panel === b.dataset.tab));
    try { localStorage.setItem("wt-tab", b.dataset.tab); } catch (e) {}
    window.scrollTo({ top: 0 });
  }));
  try { const t = localStorage.getItem("wt-tab"); if (t) { const b = $(`.tab[data-tab="${t}"]`); if (b) b.click(); } } catch (e) {}

  /* ── 툴팁 ── */
  const tip = $("#tip");
  function showTip(e, text) { tip.textContent = text; tip.hidden = false; tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; }
  function hideTip() { tip.hidden = true; }
  document.addEventListener("mousemove", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) showTip(e, t.getAttribute("data-tip")); else hideTip(); });
  document.addEventListener("touchstart", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) { const tt = e.touches[0]; showTip({ clientX: tt.clientX, clientY: tt.clientY }, t.getAttribute("data-tip")); setTimeout(hideTip, 1600); } }, { passive: true });

  /* ── 날짜 ── */
  let dates = [], cur = null, data = null;
  const fmtDate = (d) => { const [y, m, dd] = d.split("-"); const w = "일월화수목금토"[new Date(+y, +m - 1, +dd).getDay()]; return `${+m}/${+dd} (${w})`; };

  async function loadIndex() {
    try { const r = await fetch("data/index.json", { cache: "no-store" }); const j = await r.json(); dates = (j.dates || []).slice().sort(); } catch (e) { dates = []; }
    const want = (location.hash || "").replace("#", "");
    cur = dates.includes(want) ? want : dates[dates.length - 1];
    if (!cur) { $("#headline").textContent = "아직 생성된 브리프가 없습니다."; return; }
    renderDates(); await loadDay(cur);
  }
  function renderDates() {
    const el = $("#datePick"); el.innerHTML = "";
    dates.slice(-14).forEach((d) => {
      const b = document.createElement("button"); b.className = "chip" + (d === cur ? " on" : ""); b.textContent = fmtDate(d);
      b.addEventListener("click", () => go(d)); el.appendChild(b);
    });
    const on = $(".chip.on", el); if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
    const i = dates.indexOf(cur);
    $("#prevDay").disabled = i <= 0; $("#nextDay").disabled = i >= dates.length - 1;
  }
  $("#prevDay").addEventListener("click", () => { const i = dates.indexOf(cur); if (i > 0) go(dates[i - 1]); });
  $("#nextDay").addEventListener("click", () => { const i = dates.indexOf(cur); if (i < dates.length - 1) go(dates[i + 1]); });
  async function go(d) { cur = d; history.replaceState(null, "", "#" + d); renderDates(); await loadDay(d); }

  async function loadDay(d) {
    try { const r = await fetch(`data/${d}.json`, { cache: "no-store" }); data = await r.json(); } catch (e) { $("#headline").textContent = "데이터를 불러오지 못했습니다."; return; }
    render();
  }

  /* ── 렌더 ── */
  function render() {
    const D = data;
    $("#headline").textContent = D.headline || "";
    $("#meta").textContent = `${D.date} (${D.weekday || ""}) · 생성 ${D.generated_at || ""}${D.generated_by ? " · " + D.generated_by : ""}`;
    document.title = `WizTopics ${D.date} — ${D.headline || ""}`;

    // 한눈에
    $("#summary").innerHTML = (D.summary || []).map((s) => `<li>${esc(s)}</li>`).join("");

    // 체온계
    const th = D.thermometer || [];
    $("#thermoAsof").textContent = th.length ? "기준 " + (th[0].asof || "") : "";
    $("#thermo").innerHTML = th.map((t) => `<div class="t"><div class="l">${esc(t.label)}</div><div class="v">${t.unit === "$" ? "$" : ""}${num(t.value, t.key === "tnx" ? 2 : t.key === "vix" ? 1 : 0)}${t.unit && t.unit !== "$" ? `<small>${esc(t.unit)}</small>` : ""}</div><div class="c ${cls(t.pct)}">${sgn(t.pct, "%")}</div><div class="b">${esc(t.band || "")} · ${esc(t.asof || "")}</div></div>`).join("");

    // 미장·국장
    const M = D.markets || {};
    renderMarket("us", M.us); renderMarket("kr", M.kr);
    $("#flowUnit").textContent = (M.kr && M.kr.flows_unit) || "";
    const fl = (M.kr && M.kr.flows) || [];
    const mx = Math.max(1, ...fl.map((f) => Math.abs(f.amount || 0)));
    $("#krFlows").innerHTML = fl.map((f) => { const a = f.amount || 0, w = Math.abs(a) / mx * 100; return `<div class="f"><span class="n">${esc(f.who)}</span><span class="bar"><i style="width:${w}%;left:0;background:var(--${a < 0 ? "down" : "up"})"></i></span><span class="amt ${cls(a)}">${a < 0 ? "-" : "+"}${num(Math.abs(a) / 10000, 1)}조</span>${f.note ? `<span class="note">${esc(f.note)}</span>` : ""}</div>`; }).join("");

    // 선물
    const F = M.futures || {};
    $("#futAsof").textContent = F.asof ? "기준 " + F.asof : "";
    $("#fut").innerHTML = (F.items || []).map((f) => `<div class="fi"><div class="n">${esc(f.name)}</div><div class="v ${f.value ? "" : cls(f.pct)}">${f.value ? esc(f.value) : sgn(f.pct, "%")}${f.value ? `<small class="${cls(f.pct)}">${sgn(f.pct, "%")}</small>` : ""}</div>${f.note ? `<div class="nt">${esc(f.note)}</div>` : ""}</div>`).join("");
    $("#premarket").textContent = F.premarket ? "프리마켓 — " + F.premarket : "";

    // 매크로·체크
    $("#fed").textContent = (D.macro && D.macro.fed) || "—";
    $("#geo").textContent = (D.macro && D.macro.geo) || "—";
    $("#checks").innerHTML = (D.checks || []).map((c) => `<li>${esc(c)}</li>`).join("");

    // 유튜브
    const Y = D.youtube || {};
    $("#ytNote").textContent = Y.note || "";
    $("#ytKr").innerHTML = vids(Y.domestic || []); $("#ytUs").innerHTML = vids(Y.intl || []);
    $("#frameGap").textContent = Y.frame_gap || "";
    renderMatrix(D);

    // 추천 주제
    renderTopics(D);

    // 일정·출처
    $("#events").innerHTML = (D.events || []).map((e) => `<div class="e"><span class="k">${esc(e.kst)}</span><span class="w">${esc(e.what)}</span><span class="tag ${esc(e.tag || "")}">${esc(e.tag || "")}</span></div>`).join("");
    $("#pipeline").innerHTML = (D.pipeline || []).map((p) => `<div class="p"><b>${esc(p.when)}</b>${esc(p.what)}</div>`).join("");
    $("#sources").innerHTML = (D.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("");
    $("#unverified").innerHTML = (D.unverified || []).map((u) => `<li>${esc(u)}</li>`).join("");
  }

  function renderMarket(k, m) {
    if (!m) return;
    $(`#${k}Asof`).textContent = m.asof || "";
    $(`#${k}Idx`).innerHTML = (m.indices || []).map((i) => `<div class="i"><div class="n">${esc(i.name)}</div><div class="p">${esc(i.close)}</div><div class="pc ${cls(i.pct)}">${sgn(i.pct, "%")}${i.chg ? ` <span class="sub">(${esc(i.chg)})</span>` : ""}</div></div>`).join("");
    const mv = m.movers || []; const mx = Math.max(1, ...mv.map((x) => Math.abs(x.pct || 0)));
    $(`#${k}Movers`).innerHTML = mv.map((x) => `<div class="mv"><span class="n">${esc(x.name)}</span><span class="pct ${cls(x.pct)}">${sgn(x.pct, "%")}</span><span class="bar"><i style="width:${Math.abs(x.pct) / mx * 100}%;${x.pct < 0 ? "right:0" : "left:0"};background:var(--${x.pct < 0 ? "down" : "up"})"></i></span>${x.note ? `<span class="note">${esc(x.note)}</span>` : ""}</div>`).join("");
    $(`#${k}Notes`).innerHTML = (m.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  }

  function vids(list) {
    if (!list.length) return `<div class="empty">수집된 영상이 없습니다</div>`;
    return list.map((v) => {
      const title = v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a>` : esc(v.title);
      const views = v.views != null ? `<b>${num(v.views)}</b>조회` : `<span class="na">조회수 확인 불가</span>`;
      const likes = v.likes != null ? `<br>좋아요 ${num(v.likes)}` : "";
      return `<div class="vid"><span class="ch">${esc(v.channel)}</span><span class="ti">${title}</span><span class="ang">${esc(v.when || "")}${v.minutes ? ` · ${v.minutes}분` : ""}${v.angle ? ` · ${esc(v.angle)}` : ""}</span><span class="st">${views}${likes}</span></div>`;
    }).join("");
  }

  function renderMatrix(D) {
    const angles = D.angles || [], rows = D.coverage_matrix || [];
    const picked = new Set((D.topics || []).flatMap((t) => t.angles || []));
    const counts = angles.map((a) => rows.filter((r) => (r.covered || []).includes(a)).length);
    let h = `<thead><tr><th>채널</th>${angles.map((a, i) => `<th class="${picked.has(a) ? "gapcol" : ""}">${esc(a)}<br><span class="sub">${counts[i]}곳</span></th>`).join("")}</tr></thead><tbody>`;
    rows.forEach((r) => { h += `<tr><td>${esc(r.channel)}<span class="r ${esc(r.region)}">${esc(r.region)}</span></td>${angles.map((a) => `<td class="${picked.has(a) ? "gapcol" : ""}"><span class="dot ${(r.covered || []).includes(a) ? "on" : ""}" data-tip="${esc(r.channel)} · ${esc(a)} · ${(r.covered || []).includes(a) ? "다룸" : "안 다룸"}"></span></td>`).join("")}</tr>`; });
    h += `</tbody>`;
    $("#matrix").innerHTML = h;
  }

  /* ── 추천 주제 ── */
  let starred = new Set();
  try { starred = new Set(JSON.parse(localStorage.getItem("wt-star") || "[]")); } catch (e) {}
  const starKey = (id) => `${cur}:${id}`;

  function renderTopics(D) {
    const P = D.pick || {}; const pt = (D.topics || []).find((t) => t.id === P.id);
    $("#pickCard").innerHTML = pt ? `<div class="eyebrow">오늘 1개만 찍는다면</div><h2>${esc(pt.title_trust)}</h2><p>${esc(P.why || "")}</p>` : `<div class="eyebrow">오늘의 1순위</div><p>—</p>`;
    const urgCls = (u) => /오늘/.test(u) ? "" : /상시/.test(u) ? " ever" : " week";
    $("#topics").innerHTML = (D.topics || []).map((t) => `
      <article class="card topic ${t.id === P.id ? "is-pick" : ""}" data-id="${esc(t.id)}">
        <div class="th">
          <div class="rank">${esc(t.rank)}</div>
          <div class="chips"><span class="kchip">${esc(t.kind)}</span><span class="kchip urg${urgCls(t.urgency || "")}">${esc(t.urgency)}</span>${t.id === P.id ? `<span class="kchip" style="background:var(--gold-bg);color:var(--gold)">1순위</span>` : ""}</div>
          <button class="star ${starred.has(starKey(t.id)) ? "on" : ""}" data-star="${esc(t.id)}" aria-label="이 주제 선택" title="이 주제 선택(내 기기에만 저장)">${starSvg}</button>
        </div>
        <div class="titles">
          <div class="title-toggle"><button class="on" data-tt="trust">신뢰형</button><button data-tt="curious">호기심형</button></div>
          <div class="ttl" data-trust="${esc(t.title_trust)}" data-curious="${esc(t.title_curious)}">${esc(t.title_trust)}</div>
          <div class="thumb-row"><div class="thumb">${esc(t.thumb)}</div><span class="sub">썸네일 문구 · ${esc(t.emotion || "")}</span><button class="copy" data-copy="${esc(t.id)}">제목·뼈대 복사</button></div>
        </div>
        <div class="lines">
          <div class="ln"><b>사실</b><span>${esc(t.fact)}</span></div>
          <div class="ln"><b>해석</b><span>${esc(t.insight)}</span></div>
          <div class="ln"><b>체크</b><ul>${(t.checks || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
        </div>
        <div class="ev"><h3>왜 이 주제인가 — 근거 수치</h3><div class="sig">${(t.signals || []).map((s) => `<div class="s"><div class="l">${esc(s.label)}</div><div class="v">${esc(s.value)}</div><div class="src">${esc(s.source || "")}</div></div>`).join("")}</div></div>
        <div class="charts">${(t.charts || []).map((c, i) => `<div class="chart" data-chart="${esc(t.id)}:${i}"><div class="ct">${esc(c.title)}</div><div class="cv"></div>${c.source ? `<div class="cs">출처 ${esc(c.source)}</div>` : ""}</div>`).join("")}</div>
        <div class="cov"><h3>누가 다뤘나 <span class="sub">조회수·좋아요는 확인된 경우만 표시</span></h3><table><thead><tr><th>채널</th><th>시점</th><th>각도</th><th>조회수</th></tr></thead><tbody>${(t.coverage || []).map((c) => `<tr><td>${esc(c.channel)}<span class="r ${esc(c.region || "")}">${esc(c.region || "")}</span></td><td>${esc(c.when || "")}</td><td>${esc(c.angle || "")}</td><td>${c.views != null ? num(c.views) : `<span class="na">확인 불가</span>`}</td></tr>`).join("") || `<tr><td colspan="4" class="na">이 각도로 다룬 채널 없음</td></tr>`}</tbody></table></div>
        <div class="why"><div class="w"><b>구독 전환 포인트</b>${esc(t.hook)}</div><div class="w"><b>차별화</b>${esc(t.diff)}</div></div>
      </article>`).join("");

    $$(".topic").forEach((card) => {
      const t = (D.topics || []).find((x) => x.id === card.dataset.id);
      $$(".title-toggle button", card).forEach((b) => b.addEventListener("click", () => {
        $$(".title-toggle button", card).forEach((x) => x.classList.toggle("on", x === b));
        const el = $(".ttl", card); el.textContent = el.dataset[b.dataset.tt];
      }));
      $(".star", card).addEventListener("click", (e) => {
        const k = starKey(t.id); if (starred.has(k)) starred.delete(k); else starred.add(k);
        e.currentTarget.classList.toggle("on", starred.has(k));
        try { localStorage.setItem("wt-star", JSON.stringify([...starred])); } catch (err) {}
      });
      $(".copy", card).addEventListener("click", async (e) => {
        const txt = [`[${t.kind}] ${t.title_trust}`, `(호기심형) ${t.title_curious}`, `썸네일: ${t.thumb}`, ``, `사실: ${t.fact}`, `해석: ${t.insight}`, `체크: ${(t.checks || []).join(" / ")}`, ``, `차별화: ${t.diff}`, `구독 포인트: ${t.hook}`].join("\n");
        try { await navigator.clipboard.writeText(txt); e.currentTarget.textContent = "복사됨 ✓"; setTimeout(() => (e.currentTarget.textContent = "제목·뼈대 복사"), 1500); } catch (err) { alert(txt); }
      });
      (t.charts || []).forEach((c, i) => drawChart($(`[data-chart="${t.id}:${i}"] .cv`, card), c));
    });
  }
  const starSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg>`;

  function rerenderCharts() { if (data) $$(".chart").forEach((el) => { const [id, i] = el.dataset.chart.split(":"); const t = (data.topics || []).find((x) => x.id === id); if (t && t.charts[i]) drawChart($(".cv", el), t.charts[i]); }); }

  /* ── 차트 (SVG) ── */
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function drawChart(el, c) {
    if (!el) return;
    el.innerHTML = c.type === "line" ? lineChart(c) : barChart(c);
  }
  // 가로 막대: 값 부호로 색(상승 빨강/하락 파랑), 0 기준선, 직접 라벨
  function barChart(c) {
    const items = c.items || []; const n = items.length; if (!n) return "";
    const W = 360, rowH = 26, padL = 96, padR = 54, H = n * rowH + 12;
    const max = Math.max(...items.map((x) => Math.abs(x.value)), 0.01);
    const hasNeg = items.some((x) => x.value < 0), hasPos = items.some((x) => x.value > 0), mixed = hasNeg && hasPos;
    // 부호가 섞이면 가운데 0 기준 양방향, 한쪽 부호뿐이면 왼쪽에서 오른쪽으로(색이 부호를 알려준다)
    const span = W - padL - padR; const zero = mixed ? padL + span / 2 : padL;
    const scale = (mixed ? span / 2 : span) / max;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">`;
    s += `<line x1="${zero}" y1="4" x2="${zero}" y2="${H - 8}" stroke="${css("--grey3")}" stroke-width="1"/>`;
    items.forEach((x, i) => {
      const y = 6 + i * rowH, w = Math.abs(x.value) * scale, left = mixed && x.value < 0;
      const x0 = left ? zero - w : zero;
      const col = x.value < 0 ? css("--down") : x.value > 0 ? css("--up") : css("--grey3");
      s += `<text x="${padL - 8}" y="${y + 14}" text-anchor="end" font-size="11" font-weight="600" fill="${css("--grey")}">${esc(x.label)}</text>`;
      s += `<rect x="${x0}" y="${y + 4}" width="${Math.max(w, 2)}" height="14" rx="4" fill="${col}" data-tip="${esc(x.label)} ${sgn(x.value, c.unit || "")}${x.tag ? " · " + esc(x.tag) : ""}"><title>${esc(x.label)} ${sgn(x.value, c.unit || "")}</title></rect>`;
      // 값 라벨은 항상 빈 쪽(음수 막대는 0선 오른쪽)에 둬 카테고리 라벨과 겹치지 않게
      const lx = left ? zero + 5 : x0 + w + 5;
      s += `<text x="${lx}" y="${y + 15}" text-anchor="start" font-size="11" font-weight="800" fill="${css("--ink")}">${sgn(x.value, c.unit || "")}${x.tag ? `<tspan fill="${css("--grey3")}" font-weight="600"> ${esc(x.tag)}</tspan>` : ""}</text>`;
    });
    return s + `</svg>`;
  }
  // 선: 단일/다중 시리즈, 점 ≥ 8px, 직접 라벨(끝점), 범례(2개 이상)
  function lineChart(c) {
    const series = c.series || [{ name: "", points: c.points || [] }];
    const pts = series.flatMap((s) => s.points); if (!pts.length) return "";
    const W = 360, H = 170, padL = 40, padR = 46, padT = 16, padB = 28;
    const xs = [...new Set(pts.map((p) => p.x))]; const n = xs.length;
    const ys = pts.map((p) => p.y); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi === lo) { hi += 1; lo -= 1; } const r = (hi - lo) * 0.18; lo -= r; hi += r;
    const X = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (W - padL - padR) * i / (n - 1));
    const Y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const cols = [css("--blue"), css("--gold"), css("--green"), css("--up")];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">`;
    [0, .5, 1].forEach((f) => { const v = lo + (hi - lo) * f, y = Y(v); s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="${css("--chart-grid")}" stroke-width="1"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${css("--grey3")}">${num(v, c.unit === "$" ? 2 : 1)}</text>`; });
    xs.forEach((x, i) => s += `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="10" fill="${css("--grey2")}">${esc(x)}</text>`);
    series.forEach((sr, si) => {
      const col = cols[si % cols.length];
      const d = sr.points.map((p, i) => `${i ? "L" : "M"}${X(xs.indexOf(p.x))},${Y(p.y)}`).join(" ");
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      sr.points.forEach((p) => { const x = X(xs.indexOf(p.x)), y = Y(p.y); s += `<circle cx="${x}" cy="${y}" r="4" fill="${col}" stroke="${css("--card2")}" stroke-width="2" data-tip="${esc(sr.name ? sr.name + " · " : "")}${esc(p.label || p.x)} ${num(p.y, 2)}${esc(c.unit || "")}"><title>${esc(p.label || p.x)} ${num(p.y, 2)}${esc(c.unit || "")}</title></circle>`; });
      const last = sr.points[sr.points.length - 1];
      if (last) s += `<text x="${X(xs.indexOf(last.x)) + 8}" y="${Y(last.y) + 4}" font-size="11" font-weight="800" fill="${css("--ink")}">${num(last.y, c.unit === "$" ? 2 : 1)}${esc(c.unit === "$" ? "" : c.unit || "")}</text>`;
      if (series.length === 1 && sr.points.length > 1) { const f = sr.points[0]; s += `<text x="${X(xs.indexOf(f.x)) + 2}" y="${Y(f.y) - 10}" font-size="10" font-weight="700" fill="${css("--grey")}">${num(f.y, c.unit === "$" ? 2 : 1)}</text>`; }
    });
    s += `</svg>`;
    if (series.length > 1) s += `<div class="lg">${series.map((sr, i) => `<span><i style="background:${cols[i % cols.length]}"></i>${esc(sr.name)}</span>`).join("")}</div>`;
    return s;
  }

  loadIndex();
})();
