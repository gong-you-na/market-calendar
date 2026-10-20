"""비트코인 청산맵(추정) → data/liq.json
거래소 공개 데이터(OKX·Bitget·Hyperliquid·Kraken, 접근 가능하면 Binance·Bybit)에서
 - 15분봉 7일(가격·거래대금, 거래소 합산)
 - 미결제약정(OI)·펀딩비·롱숏 비율
 - 실제 청산 체결(OKX 공개 청산 주문, 롤링 누적 → 24시간 롱/숏 청산액)
을 모아 레버리지 구간(10·25·50·100배)별 청산 예상 가격대를 누적한 히트맵 격자를 계산합니다.
Coinglass와 같은 방식의 "추정치"이며 수치는 같지 않습니다. 실행: python3 scripts/update_liq.py
"""
import sys, json, math, time, base64, datetime as dt, urllib.request
from common import load, save, get_json, now_kst, UA

DAYS = 7
STEP = 900                     # 15분
BINS = 240                     # 가격 구간 수
LEV = [(10, 0.22), (25, 0.30), (50, 0.26), (100, 0.22)]   # (레버리지, 비중)
MM = 0.005                     # 유지증거금률(근사)
HALF_LIFE = 3 * 86400          # 포지션 자연 청산(정리) 반감기
now = int(time.time())
start = (now - DAYS * 86400) // STEP * STEP


def post_json(url, body, timeout=25):
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"User-Agent": UA, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"[warn] post failed {url}: {e}", file=sys.stderr)
        return None


# ───────── 캔들: {ts: [o,h,l,c,vol_usd]} 거래소별 ─────────
def okx_candles():
    out = {}
    after = None
    for _ in range(12):
        u = f"https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=15m&limit=100" + (f"&after={after}" if after else "")
        j = get_json(u)
        if not j or j.get("code") != "0" or not j["data"]:
            break
        for r in j["data"]:
            t = int(r[0]) // 1000
            if t < start:
                continue
            out[t] = [float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[7])]  # volCcyQuote = USDT
        after = j["data"][-1][0]
        if int(after) // 1000 < start:
            break
        time.sleep(0.15)
    return out


def bitget_candles():
    out = {}
    end = now * 1000
    for _ in range(8):
        j = get_json(f"https://api.bitget.com/api/v2/mix/market/history-candles?symbol=BTCUSDT&productType=USDT-FUTURES&granularity=15m&limit=200&endTime={end}")
        if not j or j.get("code") != "00000" or not j["data"]:
            break
        for r in j["data"]:
            t = int(r[0]) // 1000
            if t >= start:
                out[t] = [float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])]
        end = int(j["data"][0][0]) - 1
        if end // 1000 < start:
            break
        time.sleep(0.15)
    return out


def hyper_candles():
    j = post_json("https://api.hyperliquid.xyz/info", {"type": "candleSnapshot", "req": {"coin": "BTC", "interval": "15m", "startTime": start * 1000, "endTime": now * 1000}})
    out = {}
    for r in j or []:
        t = int(r["t"]) // 1000
        c = float(r["c"])
        out[t] = [float(r["o"]), float(r["h"]), float(r["l"]), c, float(r["v"]) * c]
    return out


def kraken_candles():
    j = get_json(f"https://futures.kraken.com/api/charts/v1/trade/PF_XBTUSD/15m?from={start}&to={now}")
    out = {}
    for r in (j or {}).get("candles", []):
        t = int(r["time"]) // 1000
        c = float(r["close"])
        out[t] = [float(r["open"]), float(r["high"]), float(r["low"]), c, float(r["volume"]) * c]
    return out


def binance_candles():
    out = {}
    s = start * 1000
    for _ in range(3):
        j = get_json(f"https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000&startTime={s}", retries=1)
        if not isinstance(j, list) or not j:
            break
        for r in j:
            out[int(r[0]) // 1000] = [float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[7])]
        s = int(j[-1][0]) + 1
        if len(j) < 1000:
            break
    return out


def bybit_candles():
    out = {}
    end = now * 1000
    for _ in range(4):
        j = get_json(f"https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1000&end={end}", retries=1)
        rows = (((j or {}).get("result") or {}).get("list") or [])
        if not rows:
            break
        for r in rows:
            t = int(r[0]) // 1000
            if t >= start:
                out[t] = [float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])]
        end = int(rows[-1][0]) - 1
        if end // 1000 < start or len(rows) < 1000:
            break
    return out


# ───────── OI·펀딩: 거래소별 현재값 ─────────
def oi_funding():
    ex = []
    j = get_json("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP")
    f = get_json("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP")
    try:
        ex.append({"name": "OKX", "oi_usd": float(j["data"][0]["oiUsd"]), "funding": float(f["data"][0]["fundingRate"]) * 100})
    except Exception as e:
        print("[warn] okx oi", e, file=sys.stderr)
    j = get_json("https://api.bitget.com/api/v2/mix/market/open-interest?symbol=BTCUSDT&productType=USDT-FUTURES")
    f = get_json("https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol=BTCUSDT&productType=USDT-FUTURES")
    t = get_json("https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES")
    try:
        px = float(t["data"][0]["lastPr"])
        ex.append({"name": "Bitget", "oi_usd": float(j["data"]["openInterestList"][0]["size"]) * px, "funding": float(f["data"][0]["fundingRate"]) * 100})
    except Exception as e:
        print("[warn] bitget oi", e, file=sys.stderr)
    j = post_json("https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"})
    try:
        i = [k for k, x in enumerate(j[0]["universe"]) if x["name"] == "BTC"][0]
        c = j[1][i]
        ex.append({"name": "Hyperliquid", "oi_usd": float(c["openInterest"]) * float(c["markPx"]), "funding": float(c["funding"]) * 100 * 8})  # 1h → 8h 환산
    except Exception as e:
        print("[warn] hyper oi", e, file=sys.stderr)
    j = get_json("https://futures.kraken.com/derivatives/api/v3/tickers/PF_XBTUSD")
    try:
        t = j["ticker"]
        ex.append({"name": "Kraken", "oi_usd": float(t["openInterest"]) * float(t["markPrice"]), "funding": float(t.get("fundingRatePrediction") or t.get("fundingRate") or 0) / float(t["markPrice"]) * 100 * 8 if abs(float(t.get("fundingRate") or 0)) > 0.01 else float(t.get("fundingRate") or 0) * 100})
    except Exception as e:
        print("[warn] kraken oi", e, file=sys.stderr)
    j = get_json("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", retries=1)
    f = get_json("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", retries=1)
    try:
        ex.append({"name": "Binance", "oi_usd": float(j["openInterest"]) * float(f["markPrice"]), "funding": float(f["lastFundingRate"]) * 100})
    except Exception:
        print("[info] binance unreachable (지역 제한) — 제외")
    j = get_json("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", retries=1)
    try:
        t = j["result"]["list"][0]
        ex.append({"name": "Bybit", "oi_usd": float(t["openInterestValue"]), "funding": float(t["fundingRate"]) * 100})
    except Exception:
        print("[info] bybit unreachable (지역 제한) — 제외")
    for e in ex:
        e["oi_usd"] = round(e["oi_usd"]); e["funding"] = round(e["funding"], 4)
    ex.sort(key=lambda x: -x["oi_usd"])
    return ex


def okx_oi_history():
    """15분 OI(USD) 히스토리 {ts: oi_usd} — 신규 포지션 추정 가중치용"""
    out = {}
    end = None
    for _ in range(8):
        u = "https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=15m&limit=100" + (f"&end={end}" if end else "")
        j = get_json(u)
        if not j or j.get("code") != "0" or not j["data"]:
            break
        for r in j["data"]:
            t = int(r[0]) // 1000
            if t >= start:
                out[t] = float(r[3])
        end = j["data"][-1][0]
        if int(end) // 1000 < start:
            break
        time.sleep(0.15)
    return out


def okx_liquidations():
    """최근 청산 체결(공개 100건) — 롤링 캐시에 누적"""
    cache = load("cache/liq_events.json", [])
    seen = {(e["t"], e["px"], e["sz"], e["side"]) for e in cache}
    for uly in ("BTC-USDT", "BTC-USD"):
        j = get_json(f"https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly={uly}&state=filled&limit=100")
        for d in (j or {}).get("data", []):
            for x in d.get("details", []):
                t = int(x["ts"]) // 1000
                px = float(x["bkPx"]); sz = float(x["sz"])
                ct = 0.01 if uly == "BTC-USDT" else 100 / px   # USDT 계약 0.01 BTC, USD 계약 100 USD
                usd = sz * ct * px
                key = (t, px, sz, x["posSide"])
                if key in seen:
                    continue
                seen.add(key)
                cache.append({"t": t, "px": px, "sz": sz, "side": x["posSide"], "usd": round(usd), "ex": "OKX"})
    cut = now - 7 * 86400
    cache = sorted([e for e in cache if e["t"] >= cut], key=lambda e: e["t"])
    save("cache/liq_events.json", cache)
    return cache


def lsr():
    j = get_json("https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H")
    try:
        return float(j["data"][0][1])
    except Exception:
        return None


# ───────── 합산 캔들 ─────────
srcs = {}
for name, fn in [("OKX", okx_candles), ("Bitget", bitget_candles), ("Hyperliquid", hyper_candles), ("Kraken", kraken_candles), ("Binance", binance_candles), ("Bybit", bybit_candles)]:
    try:
        c = fn()
        if c:
            srcs[name] = c
            print(f"[info] {name}: {len(c)} candles")
        else:
            print(f"[info] {name}: no candles (제외)")
    except Exception as e:
        print(f"[warn] {name} candles failed: {e}", file=sys.stderr)
if "OKX" not in srcs:
    raise SystemExit("OKX candles missing")

ts = sorted(t for t in srcs["OKX"] if t >= start)
candles = []
for t in ts:
    o, h, l, c, v = srcs["OKX"][t]
    vol = 0.0
    for name, cs in srcs.items():
        r = cs.get(t)
        if r:
            vol += r[4]
            h = max(h, r[1]); l = min(l, r[2])
    candles.append([t, round(o, 1), round(h, 1), round(l, 1), round(c, 1), round(vol)])
if len(candles) < 100:
    raise SystemExit("too few candles")

# ───────── 격자 계산 ─────────
oih = okx_oi_history()
lo = min(c[3] for c in candles); hi = max(c[2] for c in candles)
pad = (hi - lo) * 0.12 or hi * 0.02
p0 = lo - pad; p1 = hi + pad
dp = (p1 - p0) / BINS
N = len(candles)
grid = [[0.0] * BINS for _ in range(N)]
levels = []   # [col_created, bin, value, side, alive]
prev_oi = None
for i, (t, o, h, l, c, v) in enumerate(candles):
    oi = oih.get(t)
    d_oi = max(0.0, oi - prev_oi) if (oi is not None and prev_oi is not None) else 0.0
    prev_oi = oi if oi is not None else prev_oi
    # 신규 포지션 추정치: 거래대금의 일부 + OI 증가분
    new_pos = v * 0.08 + d_oi * 0.5
    if new_pos <= 0:
        continue
    for L, w in LEV:
        val = new_pos * w / 2
        pl = c * (1 - (1 - MM) / L)   # 롱 청산가
        ps = c * (1 + (1 - MM) / L)   # 숏 청산가
        for px, side in ((pl, "long"), (ps, "short")):
            b = int((px - p0) / dp)
            if 0 <= b < BINS:
                levels.append([i, b, val, side, True])
# 레벨 진행: 생성 이후 가격이 닿을 때까지 유지, 자연 감쇠
decay = 0.5 ** (STEP / HALF_LIFE)
liq_series = [[0.0, 0.0] for _ in range(N)]   # [롱 청산 추정, 숏 청산 추정]
for lv in levels:
    i0, b, val, side, _ = lv
    px = p0 + (b + 0.5) * dp
    cur = val
    for j in range(i0 + 1, N):
        t, o, h, l, c, v = candles[j]
        if l <= px <= h:
            liq_series[j][0 if side == "long" else 1] += cur
            lv[4] = False
            break
        grid[j][b] += cur
        cur *= decay
    else:
        lv[2] = cur
nz = sorted(v for r in grid for v in r if v > 0)
mx = nz[int(len(nz) * 0.995)] if nz else 1          # 상위 0.5%는 포화(밝은 띠), 나머지는 제곱근 스케일
GAMMA = 0.55
enc = bytearray()
for r in grid:
    for v in r:
        enc.append(int(round(255 * min(1.0, v / mx) ** GAMMA)) if v > 0 else 0)
# 현재 남아 있는 레벨 상위(가격 구간별 합)
alive = {}
for i0, b, val, side, ok in levels:
    if ok:
        k = (b, side)
        alive[k] = alive.get(k, 0) + val
top = sorted(alive.items(), key=lambda x: -x[1])[:12]
cur_px = candles[-1][4]
top_levels = [{"p": round(p0 + (b + 0.5) * dp), "usd": round(v), "side": s} for (b, s), v in top]
top_levels.sort(key=lambda x: x["p"])

# ───────── 실제 청산·OI·펀딩 ─────────
events = okx_liquidations()
cut24 = now - 86400
long24 = sum(e["usd"] for e in events if e["t"] >= cut24 and e["side"] == "long")
short24 = sum(e["usd"] for e in events if e["t"] >= cut24 and e["side"] == "short")
ex = oi_funding()
oi_total = sum(e["oi_usd"] for e in ex)
fund = sum(e["funding"] * e["oi_usd"] for e in ex) / oi_total if oi_total else None

out = {
    "updated": now_kst().strftime("%Y-%m-%d %H:%M KST"),
    "price": cur_px, "prev24": next((c[4] for c in candles if c[0] >= now - 86400 - STEP), None),
    "grid": {"t0": candles[0][0], "dt": STEP, "p0": round(p0, 1), "dp": round(dp, 4), "bins": BINS, "cols": N, "max_usd": round(mx), "gamma": GAMMA, "b64": base64.b64encode(bytes(enc)).decode()},
    "candles": candles,
    "liq_est": [[round(a), round(b)] for a, b in liq_series],
    "levels": top_levels,
    "exchanges": ex, "oi_total_usd": round(oi_total), "funding_avg": round(fund, 4) if fund is not None else None,
    "lsr": lsr(),
    "liq24h": {"long_usd": round(long24), "short_usd": round(short24), "n": sum(1 for e in events if e["t"] >= cut24), "src": "OKX 공개 청산 체결 표본(매시간 최근 100건씩 누적)"},
    "recent": [{"t": e["t"], "side": e["side"], "px": e["px"], "usd": e["usd"], "ex": e["ex"]} for e in sorted([e for e in events if e["usd"] >= 1000], key=lambda e: -e["t"])[:30]],
    "sources": list(srcs.keys()),
    "method": "거래소 합산 15분봉 거래대금·OI 증가분으로 신규 포지션을 추정하고 10·25·50·100배 레버리지 청산가(유지증거금 0.5%)에 누적. 가격이 닿으면 소멸, 3일 반감기 감쇠. Coinglass와 같은 추정 방식이며 수치는 다릅니다.",
}
save("liq.json", out)
print(f"[info] liq: {N} cols, price {cur_px}, exchanges {[e['name'] for e in ex]}, 24h liq long ${long24:,.0f} short ${short24:,.0f}")
