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
SYMS = {c["ticker"] for c in cfg["companies"]}


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


def nq_calendar(date):
    k = date.isoformat()
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
syms = {c["ticker"] for c in cfg["companies"]}
upcoming = {}
for i in range(0, 76):
    d = today + dt.timedelta(days=i)
    if d.weekday() >= 5:
        continue
    for r in nq_calendar(d):
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
    if nxt and nxt.get("rt") is None:
        nxt["rt"] = c.get("rt", "post")
    out["companies"][sym] = {"name": c["name"], "en": c["en"], "tier": c["tier"], "theme": c["theme"],
                             "next": nxt, "history": hist, "stats": stats,
                             "hist_index": {h["date"]: h for h in hist}}
    print(f"[info] {sym}: {len(hist)}q, next={nxt and nxt['date']}, stats={stats}")

save("earnings.json", out)
save("cache/nasdaq_calendar.json", _cal_cache)
