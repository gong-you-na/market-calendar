"""엑스레이(매물·옵션 지도) — 1군 종목
- 일봉 1년(캔들·거래량·MA20/50/200), 5분봉 60일 → 가격대별 매물대(Volume Profile)
- CBOE 공개 옵션 데이터 → 행사가별 콜/풋 미결제(OI) 벽, 다음 만기, 맥스페인
→ data/xray.json
실행: python3 scripts/update_xray.py
"""
import datetime as dt, math, sys, json, urllib.request
from common import load, save, get_json, yahoo_daily, now_kst, UA

cfg = load("config.json", {})
TARGETS = [c for c in cfg["companies"] if c["tier"] == 1]
BINS = 60


def yahoo_bars(symbol, range_, interval):
    j = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_}&interval={interval}&includePrePost=false")
    try:
        r = j["chart"]["result"][0]
        ts = r["timestamp"]; q = r["indicators"]["quote"][0]
        out = []
        for i, t in enumerate(ts):
            if q["close"][i] is None or q["volume"][i] is None:
                continue
            out.append({"t": t, "o": q["open"][i], "h": q["high"][i], "l": q["low"][i], "c": q["close"][i], "v": q["volume"][i]})
        return out, r.get("meta", {})
    except Exception as e:
        print("[warn] bars", symbol, e, file=sys.stderr)
        return [], {}


def volume_profile(bars, lo, hi, bins=BINS):
    """각 봉의 거래량을 고가~저가 구간에 균등 분배."""
    prof = [0.0] * bins
    step = (hi - lo) / bins
    for b in bars:
        bl, bh = max(b["l"], lo), min(b["h"], hi)
        if bh <= bl:
            k = min(bins - 1, max(0, int((b["c"] - lo) / step)))
            prof[k] += b["v"]; continue
        k0 = max(0, int((bl - lo) / step)); k1 = min(bins - 1, int((bh - lo) / step))
        n = k1 - k0 + 1
        for k in range(k0, k1 + 1):
            prof[k] += b["v"] / n
    return [round(p) for p in prof]


def value_area(prof, lo, step, pct=0.70):
    """POC(최대 매물대)와 70% 가치영역."""
    total = sum(prof) or 1
    poc = max(range(len(prof)), key=lambda i: prof[i])
    acc = prof[poc]; a = b = poc
    while acc < total * pct and (a > 0 or b < len(prof) - 1):
        up = prof[b + 1] if b < len(prof) - 1 else -1
        dn = prof[a - 1] if a > 0 else -1
        if up >= dn:
            b += 1; acc += up
        else:
            a -= 1; acc += dn
    return {"poc": round(lo + (poc + 0.5) * step, 2), "va_lo": round(lo + a * step, 2), "va_hi": round(lo + (b + 1) * step, 2)}


def cboe_options(symbol):
    j = get_json(f"https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json")
    if not j:
        return None
    opts = j.get("data", {}).get("options", [])
    spot = j.get("data", {}).get("current_price")
    today = dt.date.today()
    by_exp = {}
    for o in opts:
        sym = o.get("option", "")
        # TSLA261016C00050000 → yymmdd, C/P, strike*1000
        tail = sym[len(symbol):]
        try:
            exp = dt.date(2000 + int(tail[0:2]), int(tail[2:4]), int(tail[4:6]))
            cp = tail[6]; strike = int(tail[7:]) / 1000
        except Exception:
            continue
        if exp < today:
            continue
        oi = o.get("open_interest") or 0; vol = o.get("volume") or 0
        d = by_exp.setdefault(exp, {})
        s = d.setdefault(strike, {"c": 0, "p": 0, "cv": 0, "pv": 0})
        if cp == "C":
            s["c"] += oi; s["cv"] += vol
        else:
            s["p"] += oi; s["pv"] += vol
    exps = sorted(by_exp)
    if not exps:
        return None

    def agg(exp_list):
        m = {}
        for e in exp_list:
            for k, v in by_exp[e].items():
                a = m.setdefault(k, {"c": 0, "p": 0})
                a["c"] += v["c"]; a["p"] += v["p"]
        return m

    def maxpain(m):
        ks = sorted(m)
        best, bv = None, None
        for K in ks:
            pain = sum(max(0, K - k) * v["c"] + max(0, k - K) * v["p"] for k, v in m.items())
            if bv is None or pain < bv:
                best, bv = K, pain
        return best

    def pack(m, spot, width=0.35):
        lo, hi = spot * (1 - width), spot * (1 + width)
        rows = [{"k": k, "c": v["c"], "p": v["p"]} for k, v in m.items() if lo <= k <= hi and (v["c"] + v["p"]) > 0]
        rows.sort(key=lambda r: r["k"])
        return rows

    # 다음 만기(주간) / 다음 월간(세 번째 금요일) / 전체 합
    nxt = exps[0]
    monthly = next((e for e in exps if e.weekday() == 4 and 15 <= e.day <= 21 and e >= today), exps[-1])
    all_m = agg(exps[:8])  # 가까운 8개 만기 합산
    n_m, mo_m = agg([nxt]), agg([monthly])
    def walls(m, spot, width=0.25):
        calls = sorted(((k, v["c"]) for k, v in m.items() if spot <= k <= spot * (1 + width)), key=lambda x: -x[1])[:3]
        puts = sorted(((k, v["p"]) for k, v in m.items() if spot * (1 - width) <= k <= spot), key=lambda x: -x[1])[:3]
        return {"call": [{"k": k, "oi": o} for k, o in calls], "put": [{"k": k, "oi": o} for k, o in puts]}
    return {
        "spot": spot, "asof": j.get("timestamp"),
        "expirations": [e.isoformat() for e in exps[:8]],
        "next": {"exp": nxt.isoformat(), "rows": pack(n_m, spot), "maxpain": maxpain(n_m), "walls": walls(n_m, spot)},
        "monthly": {"exp": monthly.isoformat(), "rows": pack(mo_m, spot), "maxpain": maxpain(mo_m), "walls": walls(mo_m, spot)},
        "all": {"exp": f"~{exps[min(7, len(exps) - 1)].isoformat()}", "rows": pack(all_m, spot), "maxpain": maxpain(all_m), "walls": walls(all_m, spot)},
        "pcr": round(sum(v["p"] for v in all_m.values()) / max(1, sum(v["c"] for v in all_m.values())), 2),
    }


out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "symbols": {}}
earn = load("earnings.json", {}).get("companies", {})
for c in TARGETS:
    sym = c["ticker"]
    daily, meta = yahoo_bars(sym, "1y", "1d")
    intra, _ = yahoo_bars(sym, "60d", "5m")
    if len(daily) < 60 or len(intra) < 100:
        print("[warn] insufficient data", sym); continue
    closes = [b["c"] for b in daily]
    def ma(n): return [round(sum(closes[i - n + 1:i + 1]) / n, 2) if i >= n - 1 else None for i in range(len(closes))]
    lo = min(b["l"] for b in intra); hi = max(b["h"] for b in intra)
    pad = (hi - lo) * 0.02; lo -= pad; hi += pad
    step = (hi - lo) / BINS
    prof = volume_profile(intra, lo, hi)
    va = value_area(prof, lo, step)
    # 20일 매물대(최근)
    cutoff = intra[-1]["t"] - 20 * 86400 * 1.45
    prof20 = volume_profile([b for b in intra if b["t"] >= cutoff], lo, hi)
    opt = cboe_options(sym)
    # 실적일 마커
    marks = [{"d": h["date"], "pct": h["reaction"]["pct"] if h.get("reaction") else None} for h in earn.get(sym, {}).get("history", [])]
    nxt = earn.get(sym, {}).get("next")
    last = daily[-1]
    out["symbols"][sym] = {
        "name": c["name"], "en": c["en"], "tier": c["tier"],
        "price": round(last["c"], 2), "prev": round(daily[-2]["c"], 2), "asof": dt.datetime.fromtimestamp(last["t"], dt.timezone(dt.timedelta(hours=-4))).date().isoformat(),
        "candles": [{"t": b["t"], "o": round(b["o"], 2), "h": round(b["h"], 2), "l": round(b["l"], 2), "c": round(b["c"], 2), "v": b["v"]} for b in daily],
        "ma": {"20": ma(20), "50": ma(50), "200": ma(200)},
        "profile": {"lo": round(lo, 2), "hi": round(hi, 2), "bins": BINS, "v60": prof, "v20": prof20, **va, "days": 60},
        "options": opt,
        "earn_marks": marks, "earn_next": nxt,
    }
    print(f"[info] {sym}: {len(daily)} daily, {len(intra)} 5m bars, POC {va['poc']}, options {'ok' if opt else 'none'}"
          + (f", next exp {opt['next']['exp']} maxpain {opt['next']['maxpain']}" if opt else ""))
save("xray.json", out)
