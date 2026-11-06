"""학습기업 증권사 목표주가 → data/targets.json
- 한국 종목: 네이버페이 증권에 올라온 최근 종목 리포트 5건의 증권사·발행일·목표주가·변경(상향/하향/유지/신규).
  목표주가는 리포트 요약에서 먼저 찾고, 없으면 첨부 PDF 첫 페이지(pdftotext)에서 찾는다. 못 찾으면 null("—").
  한 번 읽은 리포트는 id로 캐시해 다시 내려받지 않는다.
- 미국 종목: 개별 증권사 목록을 주는 무료 출처가 없어 Nasdaq 공개 컨센서스(최저·평균·최고, 매수/보유/매도 수)만.
화면 원칙: 증권사가 공표한 숫자를 날짜순으로 옮길 뿐, 평균·상승여력 같은 계산이나 해석을 덧붙이지 않는다.
실행: python3 scripts/update_targets.py
"""
import html, os, re, subprocess, sys, tempfile, time, urllib.request
from common import load, save, get_json, now_kst, UA

cfg = load("config.json", {})
prev = load("targets.json", {})
cache = {}
for v in (prev.get("kr") or {}).values():
    for it in v.get("items", []):
        if it.get("id") is not None:
            cache[it["id"]] = it

NUM = r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*(만\s*원|천\s*원|원)"
KEY = r"(?:목표\s*주가|목표가|적정\s*주가|TP)"
PAT = re.compile(KEY + r"(?:\s*\(12M\))?(?:\s*\((?:상향|하향|유지|신규)\))?[\s:：]*(?:를|은|는|을)?[^0-9\n]{0,8}?" + NUM, re.I)
PAT_WIDE = re.compile(KEY + r"(?:\s*\(12M\))?(?:\s*\((?P<pre>상향|하향|유지|신규)\))?[^0-9\n]{0,70}?" + NUM, re.I)
VERB = {"상향": "상향", "하향": "하향", "유지": "유지", "신규": "신규", "개시": "신규", "U": "상향", "D": "하향", "M": "유지"}


def to_won(num, unit):
    v = float(num.replace(",", ""))
    u = unit.replace(" ", "")
    return int(round(v * 10000)) if u == "만원" else int(round(v * 1000)) if u == "천원" else int(round(v))


def change_of(text):
    """목표주가 변경 표기. 같은 칸(레이아웃 공백 3칸 이상이면 다른 칸) 안의 표기만 인정한다."""
    cells = [c for c in re.split(r"\s{3,}|\n|\|", text) if "목표" in c or "TP" in c]
    for c in cells:  # 목표주가(하향) · 목표주가 (유지)
        m = re.search(KEY + r"\s*(?:\(12M\))?\s*\((상향|하향|유지|신규)\)", c, re.I)
        if m:
            return VERB[m.group(1)]
    for c in cells:  # 2,000,000원(하향) · 3,700,000원 (U)
        m = re.search(NUM + r"\s*\((상향|하향|유지|신규|U|D|M)\)", c)
        if m:
            return VERB[m.group(3)]
    for c in cells:  # 목표주가 48만원을 유지한다 · 목표주가를 200만원으로 하향 · 목표주가는 변경하지 않는다
        m = re.search(KEY + r"(?:[^.]|\.(?=\d)){0,40}?(상향|하향|유지|신규|개시|변경하지\s*않)", c, re.I)
        if m:
            return "유지" if m.group(1).startswith("변경") else VERB[m.group(1)]
    return None


def find_tp(text):
    for p in (PAT, PAT_WIDE):
        for m in p.finditer(text):
            tp = to_won(m.group(m.lastindex - 1), m.group(m.lastindex))
            if tp >= 1000:  # 비율·연도 오탐 방지
                return tp
    return None


def pdf_text(url):
    if not url:
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=30).read()
        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(data); f.flush()
            r = subprocess.run(["pdftotext", "-l", "1", "-layout", f.name, "-"], capture_output=True, text=True, timeout=60)
            return r.stdout
    except FileNotFoundError:
        print("[warn] pdftotext 없음 — PDF에서 목표주가를 찾지 않음", file=sys.stderr)
    except Exception as e:  # noqa
        print(f"[warn] pdf {url}: {e}", file=sys.stderr)
    return ""


out = {"updated": now_kst().strftime("%Y-%m-%d %H:%M KST"), "kr": {}, "us": {}}

for c in cfg.get("companies", []):
    tk = c["ticker"]
    if c.get("mkt") == "kr":
        j = get_json(f"https://m.stock.naver.com/api/stock/{tk}/integration")
        rs = (j or {}).get("researches") or []
        items = []
        for r in rs[:5]:
            rid = r.get("id")
            if rid in cache and cache[rid].get("tp") is not None and cache[rid].get("chg") is not None:
                items.append(cache[rid]); continue
            d = (get_json(f"https://m.stock.naver.com/api/research/company/{rid}") or {}).get("researchContent") or {}
            body = html.unescape(re.sub(r"<[^>]+>", " ", d.get("content", "")))
            tp, chg = find_tp(body), change_of(body)
            if tp is None or chg is None:
                pdf = pdf_text(d.get("attachUrl"))
                if tp is None:
                    tp = find_tp(pdf)
                if tp is not None and chg is None:
                    chg = change_of(pdf)
            wd = r.get("wdt", "")
            items.append({"id": rid, "date": f"{wd[:4]}-{wd[4:6]}-{wd[6:8]}" if len(wd) == 8 else d.get("writeDate"),
                          "broker": r.get("bnm") or d.get("brokerName"), "title": r.get("tit") or d.get("title"),
                          "tp": tp, "chg": chg})
            time.sleep(0.3)
        if items:
            out["kr"][tk] = {"name": c["name"], "items": items}
        elif tk in (prev.get("kr") or {}):
            out["kr"][tk] = prev["kr"][tk]
    else:
        j = get_json(f"https://api.nasdaq.com/api/analyst/{tk}/targetprice")
        co = ((j or {}).get("data") or {}).get("consensusOverview") or {}
        if co.get("priceTarget"):
            out["us"][tk] = {"low": co.get("lowPriceTarget"), "avg": co.get("priceTarget"), "high": co.get("highPriceTarget"),
                             "buy": co.get("buy"), "hold": co.get("hold"), "sell": co.get("sell"),
                             "asof": now_kst().strftime("%Y-%m-%d")}
        elif tk in (prev.get("us") or {}):
            out["us"][tk] = prev["us"][tk]
        time.sleep(0.3)

save("targets.json", out)
miss = sum(1 for v in out["kr"].values() for it in v["items"] if it["tp"] is None)
print(f"[ok] targets: 국내 {len(out['kr'])}종목({miss}건 목표주가 미확인) · 미국 {len(out['us'])}종목")
