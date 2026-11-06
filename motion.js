/* WizView 스크롤 모션 — 섹션 등장, 유리 헤더, 체온계 무대 패럴랙스, 섹션 내비 현재 위치.
   app.js와 독립. 동작 줄이기 설정이면 등장 효과 없이 바로 보여 준다. */
(function () {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const secs = Array.from(document.querySelectorAll("main .sec"));
  const top = document.querySelector(".top");
  const stage = document.getElementById("sec-temp");

  if (stage) stage.classList.add("stage");

  if (!reduce && "IntersectionObserver" in window) {
    root.classList.add("mo");
    const vh = innerHeight;
    secs.forEach((s) => {
      s.classList.add("rv");
      // 처음 화면에 이미 보이는 섹션은 바로(짧은 지연만 두고) 등장
      if (s.getBoundingClientRect().top < vh * 0.92) requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add("in")));
    });
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.06 });
    secs.forEach((s) => { if (!s.classList.contains("in")) io.observe(s); });
    // 안전장치: 백그라운드 탭·미리보기 캡처·인쇄에서는 모두 바로 표시
    const showAll = () => secs.forEach((s) => s.classList.add("in"));
    if (document.visibilityState === "hidden") showAll();
    addEventListener("beforeprint", showAll);
  }

  // 섹션 내비: 현재 보고 있는 섹션 표시
  const links = Array.from(document.querySelectorAll(".secnav a[href^='#']"));
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  if ("IntersectionObserver" in window) {
    const nav = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.classList.remove("on")); const a = byId.get(e.target.id); if (a) a.classList.add("on"); } });
    }, { rootMargin: "-45% 0px -50% 0px" });
    secs.forEach((s) => { if (s.id && byId.has(s.id)) nav.observe(s); });
  }

  // 스크롤: 헤더 유리 + 무대 진행도(--p, -1 ~ 1)
  let ticking = false;
  function onScroll() {
    ticking = false;
    if (top) top.classList.toggle("scrolled", scrollY > 8);
    if (stage && !reduce) {
      const r = stage.getBoundingClientRect();
      const p = (innerHeight / 2 - (r.top + r.height / 2)) / (innerHeight / 2 + r.height / 2);
      stage.style.setProperty("--p", Math.max(-1, Math.min(1, p)).toFixed(3));
    }
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  onScroll();
})();
