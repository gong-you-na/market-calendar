"""주요 인물의 한마디 → data/voices.json (매시간)
- 트럼프: Truth Social 공개 아카이브(trumpstruth.org RSS) 원문 게시물
- 그 외: 발언을 보도한 기사 헤드라인(Google News RSS, 영문·국문) — 원문 트윗은 X API(유료) 없이는 수집 불가
- data/voices_manual.json: 사람이 채팅으로 전달해 Claude가 추가한 발언(항상 보존, kind=manual)
실행: python3 scripts/update_voices.py
"""
import re, sys, html, time, hashlib, datetime as dt, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from common import load, save, now_kst, UA

KEEP_PER_PERSON = 40
MAJOR = ["bloomberg", "cnbc", "reuters", "wall street journal", "wsj", "financial times", "new york times", "washington post", "ap news", "associated press", "axios", "politico",
         "the hill", "fortune", "business insider", "yahoo finance", "marketwatch", "barron", "forbes", "techcrunch", "the verge", "cnn", "bbc", "nbc", "abc news", "cbs", "fox business", "fox news",
         "the guardian", "npr", "time", "the economist", "semafor", "the information", "investing.com", "benzinga", "coindesk",
         "연합뉴스", "연합인포맥스", "한국경제", "매일경제", "조선비즈", "조선일보", "중앙일보", "동아일보", "한겨레", "경향신문", "머니투데이", "서울경제", "뉴스1", "뉴시스", "이데일리", "파이낸셜뉴스", "아시아경제", "헤럴드경제", "전자신문", "zdnet", "kbs", "mbc", "sbs", "ytn", "jtbc", "news1", "코인데스크", "블로터", "디지털타임스"]
def is_major(src):
    s = (src or "").lower()
    return any(m in s for m in MAJOR)
KEEP_DAYS = 14
now = dt.datetime.now(dt.timezone.utc)


def fetch(url):
    last = None
    for i, ua in enumerate([UA, "WizView/1.0 (+https://wizview.netlify.app)"]):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/rss+xml,application/xml,text/xml,*/*"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as e:
            last = e; time.sleep(1 + i)
    print(f"[warn] fetch failed {url[:90]}: {last}", file=sys.stderr)
    return None


def clean(t):
    t = html.unescape(re.sub(r"<br\s*/?>", "\n", t or ""))
    t = re.sub("<[^>]+>", "", t)
    return re.sub(r"[ \t]+", " ", t).strip()


def when(s):
    try:
        t = parsedate_to_datetime(s)
        return (t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc)
    except Exception:
        return now


def truth(p):
    out = []
    b = fetch("https://www.trumpstruth.org/feed")
    if not b:
        return out
    root = ET.fromstring(b)
    for it in root.iter("item"):
        desc = clean(it.findtext("description"))
        # "RT: url" 줄·첨부 링크 줄 제거
        lines = [l.strip() for l in desc.split("\n")]
        lines = [l for l in lines if l and not re.match(r"^(RT:|View (image|video)|https?://)", l)]
        text = " ".join(lines).strip()
        text = re.sub(r"https?://\S+", "", text).strip()
        if len(text) < 12:
            continue   # 이미지·리포스트만 있는 게시물은 제외
        orig = None
        for c in it:
            if c.tag.endswith("originalUrl"):
                orig = (c.text or "").strip()
        link = orig or (it.findtext("link") or "").strip()
        out.append({"person": p["id"], "kind": "post", "src": "Truth Social", "text": text[:600], "url": link, "at": when(it.findtext("pubDate")).isoformat(timespec="seconds"), "lang": "en"})
    return out


def gnews(p, q, lang):
    out = []
    hl, gl, ceid = ("ko", "KR", "KR:ko") if lang == "ko" else ("en-US", "US", "US:en")
    url = f"https://news.google.com/rss/search?q={urllib.parse.quote(q + ' when:2d')}&hl={hl}&gl={gl}&ceid={ceid}"
    b = fetch(url)
    if not b:
        return out
    try:
        root = ET.fromstring(b)
    except Exception as e:
        print(f"[warn] xml {p['id']}: {e}", file=sys.stderr); return out
    surname = p["en"].split()[-1].lower()
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        s = it.find("source"); source = clean(s.text) if s is not None and s.text else "뉴스"
        title = re.sub(r"\s+-\s+[^-]{2,60}$", "", title)
        tl = title.lower()
        # 인물 이름이 제목에 있어야 함(성 또는 한글 이름)
        if surname not in tl and p["name"].replace(" ", "")[:2] not in title.replace(" ", "") and p["name"].split()[-1] not in title:
            continue
        out.append({"person": p["id"], "kind": "news", "src": source[:40], "text": title[:300], "url": (it.findtext("link") or "").strip(),
                    "at": when(it.findtext("pubDate")).isoformat(timespec="seconds"), "lang": lang})
    return out


cfg = load("people.json", {"people": []})
prev = load("voices.json", {}) or {}
manual = load("voices_manual.json", []) or []
new = []
for p in cfg["people"]:
    got = []
    for s in p.get("sources", []):
        try:
            if s["type"] == "truth":
                got += truth(p)
            elif s["type"] == "gnews":
                got += gnews(p, s["q"], s.get("lang", "en"))
        except Exception as e:
            print(f"[warn] {p['id']} {s}: {e}", file=sys.stderr)
        time.sleep(0.3)
    print(f"[info] {p['id']}: {len(got)}")
    new += got

cut = now - dt.timedelta(days=KEEP_DAYS)
old = [v for v in (prev.get("items") or []) if v.get("kind") != "manual"]
seen, items = set(), []
for v in new + old:
    try:
        if dt.datetime.fromisoformat(v["at"]) < cut:
            continue
    except Exception:
        continue
    key = v["person"] + "|" + re.sub(r"[^0-9a-z가-힣]", "", v["text"].lower())[:50]
    if key in seen:
        continue
    seen.add(key)
    v["id"] = hashlib.md5((v["person"] + v["url"] + v["text"][:40]).encode()).hexdigest()[:10]
    items.append(v)
# 수동 입력(항상 보존)
for m in manual:
    m = dict(m); m["kind"] = "manual"; m.setdefault("src", "직접 입력")
    m["id"] = m.get("id") or hashlib.md5((m["person"] + m["text"][:60]).encode()).hexdigest()[:10]
    items.append(m)
items.sort(key=lambda v: v["at"], reverse=True)
# 주요 매체 우선: 주요 매체 보도가 6건 이상인 인물은 군소 매체 보도를 뺀다
major_cnt = {}
for v in items:
    if v["kind"] == "news" and is_major(v["src"]):
        major_cnt[v["person"]] = major_cnt.get(v["person"], 0) + 1
per = {}
final = []
for v in items:
    if v["kind"] == "news" and not is_major(v["src"]) and major_cnt.get(v["person"], 0) >= 6:
        continue
    c = per.get(v["person"], 0)
    if v["kind"] == "manual" or c < KEEP_PER_PERSON:
        final.append(v); per[v["person"]] = c + 1
people_out = [{k: p.get(k) for k in ("id", "name", "en", "role", "x", "truth", "img", "img_credit")} for p in cfg["people"]]
for p in people_out:
    p["n"] = per.get(p["id"], 0)
    p["latest"] = next((v["at"] for v in final if v["person"] == p["id"]), None)
save("voices.json", {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "people": people_out, "items": final,
                     "note": "Truth Social은 원문 게시물, 그 외는 발언을 보도한 기사 헤드라인입니다(원문 트윗은 X API 미사용). '직접 입력'은 운영자가 전달한 발언."})
print(f"[info] voices: {len(final)} items, {len(manual)} manual")
