"""시장 체온계 + VIX: Yahoo Finance 일봉 → data/market.json
실행: python3 scripts/update_market.py
"""
import datetime as dt
from common import load, save, yahoo_daily, now_kst

cfg = load("config.json", {})
out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "items": []}

for m in cfg["market"]:
    rows = yahoo_daily(m["symbol"], range_="3mo")
    if len(rows) < 2:
        print(f"[warn] no data for {m['symbol']}")
        continue
    last, prev = rows[-1], rows[-2]
    dec = m.get("decimals", 2)
    chg = last["c"] - prev["c"]
    pct = chg / prev["c"] * 100 if prev["c"] else 0
    item = {
        "key": m["key"], "label": m["label"], "unit": m["unit"],
        "symbol": m["symbol"],
        "value": round(last["c"], dec), "prev": round(prev["c"], dec),
        "chg": round(chg, dec), "pct": round(pct, 2),
        "asof": last["d"],
        "baseline": m.get("baseline"), "baseline_label": m.get("baseline_label", ""),
        "spark": [{"d": r["d"], "v": round(r["c"], dec)} for r in rows[-30:]],
        "hi30": round(max(r["h"] for r in rows[-30:]), dec),
        "lo30": round(min(r["l"] for r in rows[-30:]), dec),
    }
    if m["key"] == "vix":
        for b in cfg["vix_bands"]:
            if last["c"] < b["max"]:
                item["band"] = b["label"]
                item["band_desc"] = b["desc"]
                break
        # 1년 평균/범위(객관 기준치)
        yr = yahoo_daily(m["symbol"], range_="1y")
        if yr:
            vals = [r["c"] for r in yr]
            item["avg1y"] = round(sum(vals) / len(vals), 1)
            item["hi1y"] = round(max(vals), 1)
            item["lo1y"] = round(min(vals), 1)
    out["items"].append(item)

# 학습기업 현재가 + 50일선 이격도
out["companies"] = []
for c in cfg["companies"]:
    rows = yahoo_daily(c["ticker"], range_="6mo")
    if len(rows) < 55:
        continue
    closes = [r["c"] for r in rows]
    ma50 = sum(closes[-50:]) / 50
    last, prev = rows[-1], rows[-2]
    out["companies"].append({
        "ticker": c["ticker"], "name": c["name"], "tier": c["tier"],
        "price": last["c"], "asof": last["d"],
        "pct1d": round((last["c"] / prev["c"] - 1) * 100, 2),
        "ma50": round(ma50, 2),
        "gap50": round((last["c"] / ma50 - 1) * 100, 1),
        "spark": [{"d": r["d"], "v": r["c"]} for r in rows[-30:]],
    })

save("market.json", out)
