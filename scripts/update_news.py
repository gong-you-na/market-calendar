"""오늘의 주요 이슈: 국내외 언론 헤드라인 수집 → data/news.json (매시간, 원문 헤드라인 그대로)
출처: WSJ(RSS) · Bloomberg·CNBC·Reuters(Google News RSS 경유) · 연합뉴스·한국경제(RSS) · 매일경제·조선비즈(Google News 경유)
해석·요약을 덧붙이지 않고 제목·출처·시각·링크만 저장합니다. 실행: python3 scripts/update_news.py
"""
import re, sys, html, time, json, hashlib, datetime as dt, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from common import load, save, now_kst, UA

GN = "https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={ceid}"
def gn(q, kr=False):
    return GN.format(q=urllib.parse.quote(q), hl="ko" if kr else "en-US", gl="KR" if kr else "US", ceid="KR:ko" if kr else "US:en")

FEEDS = [
    # (출처명, URL, 지역, 가중치, google news 여부)
    ("WSJ", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "us", 1.0, False),
    ("WSJ", "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", "us", 0.7, False),
    ("Bloomberg", gn("site:bloomberg.com when:1d"), "us", 1.0, True),
    ("CNBC", gn("site:cnbc.com (markets OR stocks OR fed OR economy) when:1d"), "us", 0.95, True),
    ("Reuters", gn("site:reuters.com (markets OR stocks OR fed OR economy OR tariff) when:1d"), "us", 0.95, True),
    ("연합뉴스", "https://www.yna.co.kr/rss/economy.xml", "kr", 0.9, False),
    ("연합뉴스", "https://www.yna.co.kr/rss/market.xml", "kr", 0.9, False),
    ("한국경제", "https://www.hankyung.com/feed/finance", "kr", 0.9, False),
    ("한국경제", "https://www.hankyung.com/feed/economy", "kr", 0.8, False),
    ("매일경제", gn("site:mk.co.kr (증시 OR 코스피 OR 금리 OR 환율 OR 반도체) when:1d", kr=True), "kr", 0.85, True),
    ("조선비즈", gn("site:biz.chosun.com (증시 OR 코스피 OR 금리 OR 환율 OR 반도체) when:1d", kr=True), "kr", 0.8, True),
]

# 시장 영향 키워드(사실 기반 랭킹용). 가중치만 있고 해석은 없음.
KW = {
    "en": [(r"\b(fed|fomc|warsh|rate cut|rate hike|interest rate)", 3), (r"\b(cpi|inflation|pce|payrolls|jobs report|unemployment|gdp)", 3),
           (r"\b(tariff|trade war|china|export control)", 2.5), (r"\b(nvidia|tesla|apple|microsoft|alphabet|amazon|meta|openai|tsmc|samsung|sk hynix)", 2),
           (r"\b(s&p 500|nasdaq|dow|wall street|stocks|treasury|yield|bond)", 1.5), (r"\b(bitcoin|crypto|ethereum)", 1.2), (r"\b(oil|opec|crude|gold)", 1.2),
           (r"\b(earnings|guidance|results)", 1.5), (r"\b(trump|white house|congress|shutdown)", 1.5), (r"\b(selloff|rally|record|plunge|surge|tumble|soar)", 1.5)],
    "ko": [(r"(연준|금리|fomc|워시|한국은행|한은|금통위)", 3), (r"(물가|cpi|고용|gdp|성장률)", 2.5), (r"(관세|무역|수출|중국)", 2),
           (r"(삼성전자|sk하이닉스|하이닉스|현대차|엔비디아|테슬라|애플|tsmc)", 2), (r"(코스피|코스닥|증시|외국인|기관|지수)", 2), (r"(환율|원화|달러)", 1.8),
           (r"(비트코인|가상자산|코인)", 1.2), (r"(실적|영업이익|가이던스)", 1.5), (r"(급등|급락|사상 최고|신고가|연저점|최저)", 1.5), (r"(반도체|ai|인공지능)", 1.5)],
}
NOISE = [r"(opinion|op-ed|podcast|newsletter|crossword|horoscope|recipe|how to|what to know)", r"(부고|인사|동정|포토|사진|날씨|스포츠|연예|운세|\[표\]|\[게시판\]|\[부고\]|\[인사\])",
         r"(광고|협찬|보도자료|출시|협약|선정|수상|개최|모집|후원|캠페인|이벤트|기부|봉사)"]


def fetch(url):
    last = None
    for i, ua in enumerate([UA, "WizView/1.0 (+https://wizview.netlify.app)", "Mozilla/5.0"]):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/rss+xml,application/xml,text/xml,*/*"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as e:
            last = e; time.sleep(1.0 * (i + 1))
    print(f"[warn] feed failed {url[:80]}: {last}", file=sys.stderr)
    return None


def clean(t):
    t = html.unescape(re.sub("<[^>]+>", "", t or "")).strip()
    return re.sub(r"\s+", " ", t)


def parse(xml_bytes, src, region, weight, is_gn):
    items = []
    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        print(f"[warn] xml parse {src}: {e}", file=sys.stderr); return items
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        source = src
        if is_gn:
            # "제목 - 매체" 꼴. 매체는 <source>에도 있음
            s = it.find("source")
            if s is not None and s.text:
                source = clean(s.text)
            title = re.sub(r"\s*[-–|]\s*(" + re.escape(source) + r"|조선비즈|매일경제|Bloomberg(\.com)?|CNBC|Reuters|The Wall Street Journal|WSJ)\s*$", "", title)
            title = re.sub(r"\s+[-–]\s+[^-–]{2,40}$", "", title)
            source = {"The Wall Street Journal": "WSJ", "Bloomberg.com": "Bloomberg", "Bloomberg": "Bloomberg", "CNBC": "CNBC", "Reuters": "Reuters"}.get(source, source)
            for k in ("매일경제", "조선비즈", "Bloomberg", "CNBC", "Reuters"):
                if k in source:
                    source = k
            if source in ("조선비즈", "매일경제"):
                pass
            elif not any(k in source for k in ("Bloomberg", "CNBC", "Reuters", "WSJ", "매일경제", "조선비즈")):
                source = src  # 원하는 매체가 아닌 결과는 피드 이름으로
        if not title or not link:
            continue
        try:
            t = parsedate_to_datetime(pub)
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone.utc)
        except Exception:
            t = dt.datetime.now(dt.timezone.utc)
        items.append({"title": title, "url": link, "source": source, "at": t.astimezone(dt.timezone.utc).isoformat(timespec="seconds"), "region": region, "w": weight})
    return items


def strip_src(t):
    t = re.sub(r"\s*[-–|]\s*(조선비즈|매일경제|한국경제|연합뉴스|Bloomberg(\.com)?|CNBC|Reuters|The Wall Street Journal|WSJ)\s*$", "", t)
    return t.strip()


def norm(t):
    t = re.sub(r"^\s*(\[[^\]]{1,12}\]|\([^)]{1,12}\))\s*", "", t)   # [속보]·(종합) 등 머리표 제거
    t = re.sub(r"\s*(\[[^\]]{1,20}\]|\([^)]{1,10}\))\s*$", "", t)
    return re.sub(r"[^0-9a-z가-힣]", "", t.lower())[:60]


def score(it, now):
    lang = "ko" if it["region"] == "kr" else "en"
    t = it["title"].lower()
    s = it["w"] * 2
    for pat, w in KW[lang]:
        if re.search(pat, t):
            s += w
    for pat in NOISE:
        if re.search(pat, t):
            s -= 4
    age_h = (now - dt.datetime.fromisoformat(it["at"])).total_seconds() / 3600
    s += max(0, 3 - age_h / 4)        # 12시간에 걸쳐 3점 → 0점
    if age_h > 30:
        s -= 10
    return round(s, 2)


now = dt.datetime.now(dt.timezone.utc)
prev = load("news.json", {}) or {}
items = []
for src, url, region, w, is_gn in FEEDS:
    b = fetch(url)
    if not b:
        continue
    got = parse(b, src, region, w, is_gn)
    print(f"[info] {src}: {len(got)}")
    items += got
    time.sleep(0.3)

# 이전 실행 항목(최근 30시간)과 합쳐 중복 제거
old = [i for i in (prev.get("items") or []) if (now - dt.datetime.fromisoformat(i["at"])).total_seconds() < 30 * 3600]
seen, merged = {}, []
for it in items + old:
    k = norm(it["title"])
    if not k or k in seen:
        continue
    seen[k] = True
    it["w"] = it.get("w", 0.8)
    it["title"] = strip_src(it["title"])
    merged.append(it)
for it in merged:
    it["score"] = score(it, now)
    it["id"] = hashlib.md5(it["url"].encode()).hexdigest()[:10]
    it.pop("w", None)
merged.sort(key=lambda x: -x["score"])
# 상위 3: 미국·한국이 섞이도록(최소 1개씩), 나머지는 점수순
top, used = [], set()
us = [i for i in merged if i["region"] == "us"]; kr = [i for i in merged if i["region"] == "kr"]
for pool in (us, kr):
    if pool:
        top.append(pool[0]); used.add(pool[0]["id"])
for i in merged:
    if len(top) >= 3:
        break
    if i["id"] not in used:
        top.append(i); used.add(i["id"])
top.sort(key=lambda x: -x["score"])
rest = [i for i in merged if i["id"] not in used][:45]
out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "updated_utc": now.isoformat(timespec="seconds"),
       "top": [i["id"] for i in top], "items": top + rest,
       "sources": sorted({i["source"] for i in merged}),
       "note": "헤드라인은 각 매체 원문 그대로이며 WizView의 해석이 아닙니다. 순서는 매체·키워드·시각 기준 자동 정렬."}
save("news.json", out)
print(f"[info] news: {len(merged)} merged, top: {[i['title'][:40] for i in top]}")
