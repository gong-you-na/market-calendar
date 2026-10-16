"""히트맵 데이터: 미장(S&P500 전 종목) + 국장(코스피 상위) → data/heatmap.json
- 유니버스(섹터·시총)는 주 1회 갱신해 data/cache/universe_us.json / universe_kr.json 에 캐시
- 등락률(1D)은 Yahoo spark(20개씩), 1W/1M은 Yahoo chart 1mo 종가로 계산
실행: python3 scripts/update_heatmap.py [--refresh-universe]
"""
import sys, re, html, json, time, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
from common import load, save, get_json, now_kst, UA

REFRESH = "--refresh-universe" in sys.argv
cfg = load("config.json", {})
TIER = {c["ticker"]: c["tier"] for c in cfg["companies"]}
WATCH = {"PLTR", "HOOD", "LITE", "PANW", "MRVL", "AMD", "NVDA", "MU", "GOOGL", "AMZN"}  # 과거 3군·관심 (테두리 없음, 툴팁만)

SECTOR_KO = {
    "Information Technology": "기술", "Financials": "금융", "Health Care": "헬스케어", "Consumer Discretionary": "임의소비재",
    "Communication Services": "커뮤니케이션", "Industrials": "산업재", "Consumer Staples": "필수소비재", "Energy": "에너지",
    "Utilities": "유틸리티", "Real Estate": "부동산", "Materials": "소재",
}


def get_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")


def parse_cap(s):
    s = s.replace(",", "").strip()
    m = re.match(r"([\d.]+)\s*([TBM])?", s)
    if not m:
        return None
    v = float(m.group(1)); u = m.group(2)
    return v * {"T": 1e12, "B": 1e9, "M": 1e6, None: 1}[u]


def universe_us():
    cache = load("cache/universe_us.json", None)
    if cache and not REFRESH and (dt.date.today() - dt.date.fromisoformat(cache["asof"])).days < 7:
        return cache["items"]
    print("[info] refreshing US universe")
    s = get_text("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    t = re.search(r'<table[^>]*id="constituents"[^>]*>(.*?)</table>', s, re.S).group(1)
    sectors = {}
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        c = [html.unescape(re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(c) >= 4:
            sectors[c[0].replace(".", "-")] = (c[1], c[2], c[3])
    s = get_text("https://stockanalysis.com/list/sp-500-stocks/")
    items = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
        c = [html.unescape(re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(c) >= 7 and c[1]:
            tk = c[1].replace(".", "-")
            cap = parse_cap(c[6])
            nm, sec, ind = sectors.get(tk, (c[2], "기타", ""))
            if cap:
                items.append({"t": tk, "n": nm or c[2], "sector": SECTOR_KO.get(sec, sec), "ind": ind, "cap": cap})
    if len(items) < 400:
        raise SystemExit("US universe parse failed")
    save("cache/universe_us.json", {"asof": dt.date.today().isoformat(), "items": items})
    return items


KR_LIST = [  # 코스피 시총 상위 + 학습 관련 (티커, 이름, 섹터)
    ("005930", "삼성전자", "반도체"), ("000660", "SK하이닉스", "반도체"), ("373220", "LG에너지솔루션", "2차전지"), ("207940", "삼성바이오로직스", "헬스케어"),
    ("005380", "현대차", "자동차"), ("000270", "기아", "자동차"), ("068270", "셀트리온", "헬스케어"), ("105560", "KB금융", "금융"),
    ("035420", "NAVER", "인터넷"), ("055550", "신한지주", "금융"), ("012450", "한화에어로스페이스", "방산·우주"), ("005490", "POSCO홀딩스", "소재"),
    ("028260", "삼성물산", "지주"), ("035720", "카카오", "인터넷"), ("034020", "두산에너빌리티", "전력·에너지"), ("042660", "한화오션", "조선"),
    ("009540", "HD한국조선해양", "조선"), ("329180", "HD현대중공업", "조선"), ("086790", "하나금융지주", "금융"), ("000810", "삼성화재", "금융"),
    ("006400", "삼성SDI", "2차전지"), ("051910", "LG화학", "소재"), ("003550", "LG", "지주"), ("015760", "한국전력", "전력·에너지"),
    ("032830", "삼성생명", "금융"), ("066570", "LG전자", "전자"), ("009150", "삼성전기", "전자부품"), ("010130", "고려아연", "소재"),
    ("017670", "SK텔레콤", "통신"), ("030200", "KT", "통신"), ("316140", "우리금융지주", "금융"), ("011200", "HMM", "운송"),
    ("033780", "KT&G", "필수소비재"), ("018260", "삼성에스디에스", "IT서비스"), ("096770", "SK이노베이션", "에너지"), ("034730", "SK", "지주"),
    ("003670", "포스코퓨처엠", "2차전지"), ("010140", "삼성중공업", "조선"), ("267260", "HD현대일렉트릭", "전력·에너지"), ("272210", "한화시스템", "방산·우주"),
    ("047050", "포스코인터내셔널", "상사"), ("090430", "아모레퍼시픽", "소비재"), ("036570", "엔씨소프트", "게임"), ("259960", "크래프톤", "게임"),
    ("402340", "SK스퀘어", "지주"), ("000100", "유한양행", "헬스케어"), ("326030", "SK바이오팜", "헬스케어"), ("128940", "한미약품", "헬스케어"),
    ("011070", "LG이노텍", "전자부품"), ("064350", "현대로템", "방산·우주"), ("004020", "현대제철", "소재"), ("002380", "KCC", "소재"),
    ("298040", "효성중공업", "전력·에너지"), ("010120", "LS ELECTRIC", "전력·에너지"), ("006800", "미래에셋증권", "금융"), ("024110", "기업은행", "금융"),
    ("138040", "메리츠금융지주", "금융"), ("161390", "한국타이어앤테크놀로지", "자동차"), ("021240", "코웨이", "소비재"), ("097950", "CJ제일제당", "필수소비재"),
]


def universe_kr():
    cache = load("cache/universe_kr.json", None)
    if cache and not REFRESH and (dt.date.today() - dt.date.fromisoformat(cache["asof"])).days < 7:
        return cache["items"]
    print("[info] refreshing KR universe (market caps)")
    items = []

    def one(row):
        code, name, sector = row
        cap = None
        try:
            s = get_text(f"https://stockanalysis.com/quote/krx/{code}/")
            i = s.find("Market Cap")
            m = re.search(r"([\d.,]+)\s*([TBM])", re.sub("<[^>]+>", " ", s[i:i + 600]))
            if m:
                cap = parse_cap(m.group(1) + m.group(2))
        except Exception as e:
            print("[warn] kr cap", code, e, file=sys.stderr)
        return {"t": f"{code}.KS", "n": name, "sector": sector, "ind": "", "cap": cap}

    with ThreadPoolExecutor(6) as ex:
        items = list(ex.map(one, KR_LIST))
    items = [i for i in items if i["cap"]]
    save("cache/universe_kr.json", {"asof": dt.date.today().isoformat(), "items": items})
    return items


def spark(symbols):
    """1D 등락률·현재가. 20개씩."""
    out = {}
    for i in range(0, len(symbols), 20):
        chunk = symbols[i:i + 20]
        j = get_json("https://query1.finance.yahoo.com/v8/finance/spark?symbols=" + ",".join(chunk) + "&range=1d&interval=1d")
        if not j:
            continue
        for s, v in j.items():
            try:
                out[s] = {"p": v.get("fulldayPrice") or (v.get("close") or [None])[-1], "d1": v.get("fulldayChangePercent"),
                          "pc": v.get("chartPreviousClose")}
            except Exception:
                pass
        time.sleep(0.2)
    return out


def month_closes(symbols):
    """1W/1M 등락률: 1mo 일봉 종가. 20개씩 spark(range=1mo)."""
    out = {}
    for i in range(0, len(symbols), 20):
        chunk = symbols[i:i + 20]
        j = get_json("https://query1.finance.yahoo.com/v8/finance/spark?symbols=" + ",".join(chunk) + "&range=1mo&interval=1d")
        if not j:
            continue
        for s, v in j.items():
            cl = [c for c in (v.get("close") or []) if c is not None]
            if len(cl) >= 6:
                last = cl[-1]
                out[s] = {"w1": round((last / cl[-6] - 1) * 100, 2), "m1": round((last / cl[0] - 1) * 100, 2)}
        time.sleep(0.2)
    return out


def build(items, tag):
    syms = [i["t"] for i in items]
    q = spark(syms)
    m = month_closes(syms)
    rows = []
    for it in items:
        s = it["t"]
        if s not in q or q[s]["d1"] is None:
            continue
        r = {"t": s, "n": it["n"], "sector": it["sector"], "ind": it["ind"], "cap": it["cap"],
             "p": q[s]["p"], "d1": round(q[s]["d1"], 2), "w1": m.get(s, {}).get("w1"), "m1": m.get(s, {}).get("m1")}
        base = s.split(".")[0]
        if base in TIER:
            r["tier"] = TIER[base]
        elif base in WATCH:
            r["watch"] = True
        rows.append(r)
    # 섹터 요약(시총 가중)
    sec = {}
    for r in rows:
        a = sec.setdefault(r["sector"], {"cap": 0, "w": 0, "n": 0})
        a["cap"] += r["cap"]; a["w"] += r["cap"] * r["d1"]; a["n"] += 1
    sectors = [{"sector": k, "cap": v["cap"], "d1": round(v["w"] / v["cap"], 2), "n": v["n"]} for k, v in sec.items()]
    sectors.sort(key=lambda x: -x["cap"])
    print(f"[info] {tag}: {len(rows)} stocks, {len(sectors)} sectors")
    return {"stocks": rows, "sectors": sectors}


out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST")}
out["us"] = build(universe_us(), "US")
out["kr"] = build(universe_kr(), "KR")
# 지수 요약
idx = spark(["^GSPC", "^IXIC", "^DJI", "^RUT", "^KS11", "^KQ11"])
out["index"] = {k: {"p": v["p"], "d1": round(v["d1"], 2) if v["d1"] is not None else None} for k, v in idx.items()}
save("heatmap.json", out)
