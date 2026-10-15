"""공용 유틸: Yahoo Finance 일봉, Nasdaq 공개 데이터, JSON 입출력."""
import json, os, sys, time, datetime as dt
import urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def get_json(url, headers=None, retries=3, timeout=25):
    h = {"User-Agent": UA, "Accept": "application/json,text/plain,*/*"}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    print(f"[warn] fetch failed {url}: {last}", file=sys.stderr)
    return None


def load(name, default):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    p = os.path.join(DATA, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print(f"[ok] wrote {name}")


def yahoo_daily(symbol, start=None, end=None, range_=None):
    """일봉 [{d:'YYYY-MM-DD', c:close, o, h, l}] (미국 거래일 기준)."""
    q = {"interval": "1d", "includeAdjustedClose": "false"}
    if range_:
        q["range"] = range_
    else:
        q["period1"] = int(dt.datetime.combine(start, dt.time()).timestamp())
        q["period2"] = int(dt.datetime.combine(end, dt.time()).timestamp())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{urllib.parse.urlencode(q)}"
    j = get_json(url)
    try:
        res = j["chart"]["result"][0]
        ts = res["timestamp"]
        qd = res["indicators"]["quote"][0]
        off = dt.timezone(dt.timedelta(seconds=res.get("meta", {}).get("gmtoffset", -14400)))
        out = []
        for i, t in enumerate(ts):
            c = qd["close"][i]
            if c is None:
                continue
            d = dt.datetime.fromtimestamp(t, off).date()
            out.append({"d": d.isoformat(), "c": round(c, 2),
                        "o": round(qd["open"][i] or c, 2),
                        "h": round(qd["high"][i] or c, 2),
                        "l": round(qd["low"][i] or c, 2)})
        return out
    except Exception as e:  # noqa
        print(f"[warn] yahoo parse failed {symbol}: {e}", file=sys.stderr)
        return []


def now_kst():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
