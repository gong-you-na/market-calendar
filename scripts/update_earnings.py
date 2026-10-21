"""학습기업 실적 히스토리(8분기) + 발표 전후 ±5거래일 주가 + 다음 발표 일정
출처: Nasdaq 공개 데이터(발표일·EPS 실제/컨센서스), Yahoo Finance(일봉)
실행: python3 scripts/update_earnings.py
"""
import datetime as dt, sys
from common import load, save, get_json, yahoo_daily, now_kst

cfg = load("config.json", {})
prev = load("earnings.json", {})
NQ = 8
WIN = cfg.get("reaction_window_days", 5)
H = {"Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
# 한국 종목(mkt:"kr")은 Nasdaq 데이터가 없으므로 실적 수집 대상에서 제외(카드에는 안내만 표시)
US_COS = [c for c in cfg["companies"] if c.get("mkt", "us") == "us"]
SYMS = {c["ticker"] for c in US_COS}


def nq_date(s):  # '8/26/2026' -> date
    m, d, y = s.split("/")
    return dt.date(int(y), int(m), int(d))


def money(s):
    """'$1.99' / '($0.02)' / '' -> float|None"""
    if s is None:
        return None
    s = str(s).strip()
    if not s or s in ("N/A", "-"):
        return None
    neg = s.startswith("(")
    s = s.replace("$", "").replace("(", "").replace(")", "").replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


_cal_cache = load("cache/nasdaq_calendar.json", {})  # 과거 날짜는 바뀌지 않으므로 영구 캐시
_today = dt.date.today()
# 캐시는 당시 SYMS의 행만 보관하므로, 학습기업이 바뀌면(추가) 캐시를 비워 다시 받는다
_bulk = _cal_cache.get("_syms") != sorted(SYMS)
if _bulk:
    _cal_cache = {"_syms": sorted(SYMS)}
    print("[info] 학습기업 목록 변경 — Nasdaq 캘린더 캐시 초기화 후 최근 2년치 일괄 수집")


def nq_calendar(date):
    k = date.isoformat()
    if date.weekday() >= 5:
        return []
    if k not in _cal_cache or date >= _today:
        j = get_json(f"https://api.nasdaq.com/api/calendar/earnings?date={k}", headers=H)
        rows = []
        try:
            rows = j["data"]["rows"] or []
        except Exception:
            rows = []
        # 우리 종목만 보관(용량 절약)
        keep = [r for r in rows if r.get("symbol", "").upper() in SYMS]
        if j is not None and date < _today:
            _cal_cache[k] = keep
        return keep
    return _cal_cache[k]


def _fetch_day(k):
    j = get_json(f"https://api.nasdaq.com/api/calendar/earnings?date={k}", headers=H)
    try:
        rows = j["data"]["rows"] or []
    except Exception:
        rows = []
    return k, (None if j is None else [r for r in rows if r.get("symbol", "").upper() in SYMS])


def bulk_scan(days=740, workers=6):
    """캐시 초기화 직후 과거 거래일 전체를 병렬로 받아 캐시 채우기(이후 실행은 캐시만 사용)."""
    from concurrent.futures import ThreadPoolExecutor
    ks = [(_today - dt.timedelta(days=i)).isoformat() for i in range(1, days + 1)
          if (_today - dt.timedelta(days=i)).weekday() < 5]
    n_fail = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for k, keep in ex.map(_fetch_day, ks):
            if keep is None:
                n_fail += 1
            else:
                _cal_cache[k] = keep
    save("cache/nasdaq_calendar.json", _cal_cache)
    print(f"[info] 캘린더 일괄 수집 {len(ks)}일 중 실패 {n_fail}일")


if _bulk:
    bulk_scan()


def cal_row(date, sym):
    for r in nq_calendar(date):
        if r.get("symbol", "").upper() == sym:
            return r
    return None


def surprise_rows(sym):
    j = get_json(f"https://api.nasdaq.com/api/company/{sym}/earnings-surprise", headers=H)
    try:
        return j["data"]["earningsSurpriseTable"]["rows"] or []
    except Exception:
        return []


def rt_of(row, default):
    t = (row or {}).get("time", "") or ""
    if "pre" in t:
        return "pre"
    if "after" in t:
        return "post"
    return default


def reaction(sym, date, rt):
    """발표 전후 ±WIN 거래일 종가, 반응일 등락률."""
    rows = yahoo_daily(sym, start=date - dt.timedelta(days=WIN * 2 + 10), end=date + dt.timedelta(days=WIN * 2 + 10))
    if not rows:
        return None
    ds = [r["d"] for r in rows]
    iso = date.isoformat()
    # 발표일 인덱스(발표일이 휴장이면 다음 거래일)
    idx = next((i for i, d in enumerate(ds) if d >= iso), None)
    if idx is None:
        return None
    # 반응일: 장전 발표 → 당일, 장후 발표 → 다음 거래일
    ri = idx if rt == "pre" else idx + 1
    if ri >= len(rows) or ri - 1 < 0:
        return None
    base = rows[ri - 1]["c"]
    react = rows[ri]["c"]
    lo, hi = max(0, ri - WIN), min(len(rows), ri + WIN + 1)
    win = [{"d": r["d"], "c": r["c"], "n": round(r["c"] / base * 100, 2)} for r in rows[lo:hi]]
    out = {"base_d": rows[ri - 1]["d"], "react_d": rows[ri]["d"],
           "pct": round((react / base - 1) * 100, 2),
           "window": win, "react_idx": ri - lo}
    if ri + WIN < len(rows):
        out["pct5"] = round((rows[ri + WIN]["c"] / base - 1) * 100, 2)
    return out


out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "companies": {}}
today = dt.date.today()

# 다음 발표일 탐색: 오늘~+75일 캘린더를 한 번 훑어 우리 종목만 추출
syms = SYMS
upcoming = {}
_future = [today + dt.timedelta(days=i) for i in range(0, 76) if (today + dt.timedelta(days=i)).weekday() < 5]
from concurrent.futures import ThreadPoolExecutor as _TPE
with _TPE(max_workers=6) as _ex:  # 미래 날짜는 캐시하지 않으므로 병렬로 미리 받아 둔다
    _future_rows = dict(_ex.map(lambda d: (d, nq_calendar(d)), _future))
for d in _future:
    for r in _future_rows[d]:
        s = r.get("symbol", "").upper()
        if s in syms and s not in upcoming:
            upcoming[s] = {"date": d.isoformat(), "rt": rt_of(r, None),
                           "est_eps": money(r.get("epsForecast")),
                           "n_est": r.get("noOfEsts"),
                           "fq": r.get("fiscalQuarterEnding"),
                           "last_year_date": r.get("lastYearRptDt"),
                           "last_year_eps": money(r.get("lastYearEPS")),
                           "source": "Nasdaq"}
print("[info] upcoming:", {k: v["date"] for k, v in upcoming.items()})

for c in cfg["companies"]:
    sym = c["ticker"]
    if c.get("mkt", "us") != "us":
        out["companies"][sym] = {"name": c["name"], "en": c["en"], "tier": c["tier"], "theme": c["theme"], "mkt": c["mkt"],
                                 "next": None, "history": [], "stats": {"n": 0}, "hist_index": {}}
        print(f"[info] {sym}: {c['mkt']} 종목 — Nasdaq 실적 수집 제외")
        continue
    hist = []
    rows = surprise_rows(sym)
    seen = set()
    for r in rows:
        try:
            d = nq_date(r["dateReported"])
        except Exception:
            continue
        seen.add(d)
        cr = cal_row(d, sym)
        hist.append({"date": d.isoformat(), "fq": r.get("fiscalQtrEnd"),
                     "eps": money(r.get("eps")), "est": money(r.get("consensusForecast")),
                     "surprise_pct": money(r.get("percentageSurprise")),
                     "rt": rt_of(cr, c.get("rt", "post")), "src": "Nasdaq"})
        # 1년 전 같은 분기 → 5~8번째 분기
        ly = (cr or {}).get("lastYearRptDt")
        if ly:
            try:
                lyd = nq_date(ly)
            except Exception:
                lyd = None
            if lyd and lyd not in seen:
                lr = cal_row(lyd, sym)
                if lr:
                    seen.add(lyd)
                    e, f = money(lr.get("eps")), money(lr.get("epsForecast"))
                    sp = None
                    if e is not None and f not in (None, 0):
                        sp = round((e - f) / abs(f) * 100, 2)
                    hist.append({"date": lyd.isoformat(), "fq": lr.get("fiscalQuarterEnding"),
                                 "eps": e, "est": f, "surprise_pct": sp,
                                 "rt": rt_of(lr, c.get("rt", "post")), "src": "Nasdaq"})
    # 이전 실행에서 확보한 과거 분기 재사용
    for d0, ph in prev.get("companies", {}).get(sym, {}).get("hist_index", {}).items():
        if dt.date.fromisoformat(d0) not in seen:
            seen.add(dt.date.fromisoformat(d0)); hist.append(ph)
    # 부족하면 1년 전 같은 분기(발표일 ±7일)를 캘린더에서 탐색
    def find_prior(d):
        for off in [364, 363, 365, 362, 366, 361, 367, 360, 368, 359, 369, 358, 370, 357, 371]:
            cand = d - dt.timedelta(days=off)
            if cand.weekday() >= 5 or cand in seen:
                continue
            lr = cal_row(cand, sym)
            if lr:
                return cand, lr
        return None, None
    # earnings-surprise 응답이 비면(신규 종목·API 변경) 캘린더를 분기(약 91일) 간격으로 거슬러 탐색
    def find_near(target, span=12):
        for off in sorted(range(-span, span + 1), key=lambda o: (abs(o), o)):
            cand = target + dt.timedelta(days=off)
            if cand.weekday() >= 5 or cand in seen or cand >= today:
                continue
            lr = cal_row(cand, sym)
            if lr:
                return cand, lr
        return None, None
    if len(hist) < NQ:
        known = sorted({dt.date.fromisoformat(h["date"]) for h in hist})
        nxt0 = upcoming.get(sym)
        anchor = known[0] if known else (dt.date.fromisoformat(nxt0["date"]) if nxt0 else None)
        if anchor is None:  # 과거·미래 발표일을 모두 모르면 최근 100일(캐시)에서 가장 가까운 발표일을 먼저 찾는다
            cand, lr = find_near(today - dt.timedelta(days=50), span=50)
            if lr:
                seen.add(cand); anchor = cand
                e, f = money(lr.get("eps")), money(lr.get("epsForecast"))
                sp = round((e - f) / abs(f) * 100, 2) if (e is not None and f not in (None, 0)) else None
                hist.append({"date": cand.isoformat(), "fq": lr.get("fiscalQuarterEnding"), "eps": e, "est": f,
                             "surprise_pct": sp, "rt": rt_of(lr, c.get("rt", "post")), "src": "Nasdaq"})
            else:
                anchor = today
        miss = 0
        while len(hist) < NQ and miss < 2:
            cand, lr = find_near(anchor - dt.timedelta(days=91))
            if not lr:
                miss += 1; anchor -= dt.timedelta(days=91); continue
            miss = 0; anchor = cand; seen.add(cand)
            e, f = money(lr.get("eps")), money(lr.get("epsForecast"))
            sp = round((e - f) / abs(f) * 100, 2) if (e is not None and f not in (None, 0)) else None
            hist.append({"date": cand.isoformat(), "fq": lr.get("fiscalQuarterEnding"), "eps": e, "est": f,
                         "surprise_pct": sp, "rt": rt_of(lr, c.get("rt", "post")), "src": "Nasdaq"})
    anchors = sorted({dt.date.fromisoformat(h["date"]) for h in hist}, reverse=True)
    while len(hist) < NQ and anchors:
        a = anchors.pop(0)
        if any(abs((dt.date.fromisoformat(h["date"]) - (a - dt.timedelta(days=364))).days) <= 10 for h in hist):
            continue
        cand, lr = find_prior(a)
        if lr:
            seen.add(cand)
            e, f = money(lr.get("eps")), money(lr.get("epsForecast"))
            sp = round((e - f) / abs(f) * 100, 2) if (e is not None and f not in (None, 0)) else None
            hist.append({"date": cand.isoformat(), "fq": lr.get("fiscalQuarterEnding"), "eps": e, "est": f,
                         "surprise_pct": sp, "rt": rt_of(lr, c.get("rt", "post")), "src": "Nasdaq"})
            anchors.append(cand); anchors.sort(reverse=True)
    hist.sort(key=lambda x: x["date"], reverse=True)
    hist = hist[:NQ]
    # 이전 실행 결과 재사용(주가 반응은 바뀌지 않음)
    prev_hist = {h["date"]: h for h in prev.get("companies", {}).get(sym, {}).get("history", [])}
    for h in hist:
        if h["eps"] is not None and h["est"] is not None:
            h["beat"] = h["eps"] >= h["est"]
        ph = prev_hist.get(h["date"])
        if ph and ph.get("reaction") and ph.get("reaction", {}).get("pct5") is not None:
            h["reaction"] = ph["reaction"]
        else:
            h["reaction"] = reaction(sym, dt.date.fromisoformat(h["date"]), h["rt"])
    # 요약 통계(객관 수치만)
    beats = [h for h in hist if "beat" in h]
    ups = [h for h in hist if h.get("reaction")]
    stats = {
        "n": len(hist),
        "beats": sum(1 for h in beats if h["beat"]),
        "n_beats": len(beats),
        "ups": sum(1 for h in ups if h["reaction"]["pct"] > 0),
        "n_ups": len(ups),
        "beat_and_up": sum(1 for h in hist if h.get("beat") and h.get("reaction") and h["reaction"]["pct"] > 0),
        "beat_and_down": sum(1 for h in hist if h.get("beat") and h.get("reaction") and h["reaction"]["pct"] <= 0),
        "avg_abs_move": round(sum(abs(h["reaction"]["pct"]) for h in ups) / len(ups), 1) if ups else None,
        "max_up": round(max((h["reaction"]["pct"] for h in ups), default=0), 1),
        "max_down": round(min((h["reaction"]["pct"] for h in ups), default=0), 1),
    }
    nxt = upcoming.get(sym)
    # config.json의 next_date(회사 IR 공지로 확인한 날짜)가 Nasdaq 캘린더와 다르면 IR 공지를 우선한다
    nd = c.get("next_date")
    if nd and (not nxt or nxt["date"] != nd):
        if dt.date.fromisoformat(nd) < today:
            nxt = None  # 이미 발표됨 — Nasdaq 캘린더가 갱신될 때까지 다음 발표일 미확정으로 둔다
        else:
            nxt = {"date": nd, "rt": c.get("rt", "post"), "est_eps": None, "n_est": None, "fq": None,
                   "last_year_date": None, "last_year_eps": None, "source": "IR"}
        print(f"[info] {sym}: next_date 우선 적용 {nd} (Nasdaq {upcoming.get(sym, {}).get('date')})")
    if nxt and nxt.get("rt") is None:
        nxt["rt"] = c.get("rt", "post")
    out["companies"][sym] = {"name": c["name"], "en": c["en"], "tier": c["tier"], "theme": c["theme"], "mkt": "us",
                             "next": nxt, "history": hist, "stats": stats,
                             "hist_index": {h["date"]: h for h in hist}}
    print(f"[info] {sym}: {len(hist)}q, next={nxt and nxt['date']}, stats={stats}")

save("earnings.json", out)
save("cache/nasdaq_calendar.json", _cal_cache)
