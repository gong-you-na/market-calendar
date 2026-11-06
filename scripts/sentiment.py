"""시장 체온계 보조 지표(미국 탭, VIX 옆): 하이일드 스프레드 + 위즈뷰 공포·탐욕 지수(자체 산출).
update_market.py가 불러 쓴다. 단독 실행 시 결과만 출력.

- 하이일드 스프레드: FRED BAMLH0A0HYM2 (ICE BofA US High Yield Index Option-Adjusted Spread, %, 일별)
- 공포·탐욕(위즈뷰 자체 산출, CNN 지수 아님): 아래 4개 공개 지표의 '최근 1년(252거래일) 중 오늘의 백분위'를 0~100으로 바꿔 평균.
    1) 모멘텀      S&P500 종가 ÷ 125일 이동평균 − 1        (높을수록 탐욕)
    2) 변동성      VIX ÷ VIX 50일 평균 − 1                  (높을수록 공포 → 뒤집음)
    3) 정크본드    하이일드 스프레드                          (넓을수록 공포 → 뒤집음)
    4) 안전자산    S&P500 20일 수익률 − IEF(미 국채 7~10년) 20일 수익률 (높을수록 탐욕)
"""
from common import yahoo_daily, fred_series

BANDS = [(25, "극단적 공포"), (45, "공포"), (55, "중립"), (75, "탐욕"), (101, "극단적 탐욕")]
LOOK = 252


def band_of(v):
    for mx, lb in BANDS:
        if v < mx:
            return lb
    return BANDS[-1][1]


def _ffill(dates, series):
    """series(dict d->v)를 dates 축에 앞값 채우기로 맞춘다."""
    out, last = [], None
    keys = sorted(series)
    j = 0
    for d in dates:
        while j < len(keys) and keys[j] <= d:
            last = series[keys[j]]
            j += 1
        out.append(last)
    return out


def _pctile(window, x):
    w = [v for v in window if v is not None]
    if not w or x is None:
        return None
    below = sum(1 for v in w if v < x)
    eq = sum(1 for v in w if v == x)
    return (below + 0.5 * eq) / len(w) * 100


def high_yield():
    rows = fred_series("BAMLH0A0HYM2")
    if len(rows) < 30:
        return None, rows
    last, prev = rows[-1], rows[-2]
    yr = [r["v"] for r in rows[-LOOK:]]
    item = {
        "key": "hy", "label": "하이일드 스프레드", "unit": "%", "symbol": "BAMLH0A0HYM2", "src": "fred",
        "value": round(last["v"], 2), "prev": round(prev["v"], 2),
        "chg": round(last["v"] - prev["v"], 2), "pct": round((last["v"] / prev["v"] - 1) * 100, 2) if prev["v"] else 0,
        "asof": last["d"], "baseline": None, "baseline_label": "",
        "spark": [{"d": r["d"], "v": r["v"]} for r in rows[-30:]],
        "hi30": max(r["v"] for r in rows[-30:]), "lo30": min(r["v"] for r in rows[-30:]),
        "avg1y": round(sum(yr) / len(yr), 2), "hi1y": max(yr), "lo1y": min(yr),
    }
    return item, rows


def fear_greed(hy_rows):
    spx = yahoo_daily("^GSPC", range_="2y")
    vix = yahoo_daily("^VIX", range_="2y")
    ief = yahoo_daily("IEF", range_="2y")
    if len(spx) < LOOK + 130 or len(vix) < 200 or len(ief) < 200 or len(hy_rows) < 200:
        print("[warn] fear_greed: 데이터 부족")
        return None
    dates = [r["d"] for r in spx]
    s = [r["c"] for r in spx]
    v = _ffill(dates, {r["d"]: r["c"] for r in vix})
    b = _ffill(dates, {r["d"]: r["c"] for r in ief})
    h = _ffill(dates, {r["d"]: r["v"] for r in hy_rows})
    n = len(dates)
    raw = {"mom": [None] * n, "vol": [None] * n, "junk": [None] * n, "safe": [None] * n}
    for i in range(n):
        if i >= 124:
            raw["mom"][i] = s[i] / (sum(s[i - 124:i + 1]) / 125) - 1
        if i >= 49 and v[i] is not None and all(x is not None for x in v[i - 49:i + 1]):
            raw["vol"][i] = v[i] / (sum(v[i - 49:i + 1]) / 50) - 1
        raw["junk"][i] = h[i]
        if i >= 20 and b[i] and b[i - 20]:
            raw["safe"][i] = (s[i] / s[i - 20] - 1) - (b[i] / b[i - 20] - 1)
    inv = {"vol": True, "junk": True}
    hist = []
    for i in range(n - 60, n):
        sc = {}
        for k in raw:
            p = _pctile(raw[k][max(0, i - LOOK + 1):i + 1], raw[k][i])
            if p is not None:
                sc[k] = round(100 - p if inv.get(k) else p)
        if len(sc) == 4:
            hist.append({"d": dates[i], "v": round(sum(sc.values()) / 4), "c": sc})
    if len(hist) < 2:
        return None
    last, prev = hist[-1], hist[-2]
    labels = {"mom": "모멘텀", "vol": "변동성", "junk": "정크본드", "safe": "안전자산"}
    return {
        "key": "fg", "label": "공포·탐욕 지수", "unit": "", "symbol": "WIZVIEW-FG", "src": "calc",
        "value": last["v"], "prev": prev["v"], "chg": last["v"] - prev["v"],
        "pct": round((last["v"] / prev["v"] - 1) * 100, 2) if prev["v"] else 0,
        "asof": last["d"], "baseline": None, "baseline_label": "",
        "band": band_of(last["v"]),
        "parts": [{"k": k, "label": labels[k], "score": last["c"][k]} for k in ["mom", "vol", "junk", "safe"]],
        "spark": [{"d": x["d"], "v": x["v"]} for x in hist[-30:]],
        "hi30": max(x["v"] for x in hist[-30:]), "lo30": min(x["v"] for x in hist[-30:]),
        "week_ago": hist[-6]["v"] if len(hist) >= 6 else None,
        "month_ago": hist[-22]["v"] if len(hist) >= 22 else None,
        "method": "위즈뷰 자체 산출(CNN 공포·탐욕 지수 아님). 모멘텀(S&P500 vs 125일선)·변동성(VIX vs 50일 평균)·정크본드(하이일드 스프레드)·안전자산(주식 vs 미 국채 20일 수익률 차) 4개를 최근 1년 백분위로 0~100 환산해 평균",
    }


def build():
    hy, rows = high_yield()
    fg = fear_greed(rows) if rows else None
    return [x for x in (fg, hy) if x]


if __name__ == "__main__":
    import json
    for it in build():
        print(json.dumps({k: it[k] for k in it if k not in ("spark",)}, ensure_ascii=False))
