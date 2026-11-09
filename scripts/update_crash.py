"""코스피 급락 진료 기록부 → data/crash.json
- 손으로 쓰는 부분(구간 이름·기간·원인·전환점·요약·서킷/사이드카 날짜, 화면에 안 나오는 src)은 crash.json에 그대로 두고,
  이 스크립트는 숫자(series·calc·sc_unk)만 다시 계산해 덮어쓴다.
- series 한 줄: [날짜, 코스피 종가, 장중 저가, 외국인, 외국인 코스피200 선물, 기관, 개인(이상 억원),
                 신용거래융자 잔고(조), 실제 반대매매(억), 반대매매 비중(%), 투자자예탁금(조), 원/달러, 필라델피아 반도체지수 전일%]
- 출처(화면 비표시): 코스피·원/달러·SOX Yahoo 일봉 / 투자자별 순매수 네이버페이 증권(거래소 집계, 2026-11-09 수집 중단 — 기존 값만 유지) / 신용·반대매매·예탁금 금융투자협회 FreeSIS
실행: python3 scripts/update_crash.py
"""
import datetime as dt, json, time, urllib.request
from common import load, save, get_json, yahoo_daily, now_kst, UA

START = "2025-12-30"
C = load("crash.json", None)
if not C:
    raise SystemExit("[err] data/crash.json 없음 — 구간 정의가 필요합니다")

def ymd(d): return d.replace("-", "")

# 1) 지수·환율·반도체
ks = {r["d"]: r for r in yahoo_daily("^KS11", range_="2y") if r["d"] >= START}
fx = {r["d"]: r["c"] for r in yahoo_daily("KRW=X", range_="2y")}
sox = yahoo_daily("^SOX", range_="2y"); soxd = [r["d"] for r in sox]
def sox_for(d):  # 한국 d일 직전 미국 거래일의 등락률
    p = [i for i, x in enumerate(soxd) if x < d]
    if len(p) < 1 or p[-1] < 1: return None
    i = p[-1]; return round((sox[i]["c"] / sox[i - 1]["c"] - 1) * 100, 2)
days = sorted(ks)
if len(days) < 30:
    raise SystemExit("[err] 코스피 일봉을 받지 못함")

# 2) 투자자별 순매수: 기존 값 재사용, 최근 3거래일과 빈 날만 새로 받음
NAVER_OFF = True  # 대체 수집처(공식 경로)가 정해지면 교체
old = {r[0]: r for r in C.get("series", [])}
def num(s):
    try: return int(str(s).replace(",", "").replace("+", ""))
    except Exception: return None
flows = {}
for i, d in enumerate(days):
    o = old.get(ymd(d))
    if NAVER_OFF:  # 2026-11-09 운영자 결정: 네이버 내부 API 수집 중단 — 기존 값만 유지, 새 날짜는 빈 값
        flows[d] = o[3:7] if o else [None] * 4; continue
    if o and o[3] is not None and i < len(days) - 3:
        flows[d] = o[3:7]; continue
    k = get_json(f"https://m.stock.naver.com/api/index/KOSPI/trend?bizdate={ymd(d)}") or {}
    f = get_json(f"https://m.stock.naver.com/api/index/FUT/trend?bizdate={ymd(d)}") or {}
    if k.get("bizdate") == ymd(d):
        flows[d] = [num(k.get("foreignValue")), num(f.get("foreignValue")) if f.get("bizdate") == ymd(d) else None,
                    num(k.get("institutionalValue")), num(k.get("personalValue"))]
    else:
        flows[d] = o[3:7] if o else [None] * 4
    time.sleep(0.15)

# 3) 금융투자협회: 신용융자(070BO), 증시자금·반대매매(060BO)
def kofia(obj):
    body = json.dumps({"dmSearch": {"tmpV40": "1000000", "tmpV41": "1", "tmpV1": "D", "tmpV45": ymd(START),
                                    "tmpV46": now_kst().strftime("%Y%m%d"), "OBJ_NM": obj}}).encode()
    try:
        req = urllib.request.Request("https://freesis.kofia.or.kr/meta/getMetaDataList.do", data=body,
                                     headers={"User-Agent": UA, "Content-Type": "application/json"})
        return {x["TMPV1"]: x for x in json.loads(urllib.request.urlopen(req, timeout=30).read())["ds1"]}
    except Exception as e:  # noqa
        print(f"[warn] kofia {obj}: {e}"); return {}
cr = kofia("STATSCU0100000070BO"); mo = kofia("STATSCU0100000060BO")

series = []
for d in days:
    k, o = ymd(d), old.get(ymd(d))
    c_ = cr.get(k); m_ = mo.get(k)
    row = [k, round(ks[d]["c"], 2), round(ks[d]["l"], 2)] + flows[d] + [
        round(c_["TMPV2"] / 1e6, 2) if c_ else (o[7] if o else None),
        round(m_["TMPV6"] / 100) if m_ else (o[8] if o else None),
        m_["TMPV7"] if m_ else (o[9] if o else None),
        round(m_["TMPV2"] / 1e6, 1) if m_ else (o[10] if o else None),
        round(fx[d], 1) if d in fx else None, sox_for(d)]
    series.append(row)
D = [r[0] for r in series]; R = {r[0]: r for r in series}

# 4) 코스피200 장중 −5% 이상(발동 보도 미확인) 자동 표시 — 네이버 수집 중단으로 정지
try:
    if NAVER_OFF: raise RuntimeError("naver off")
    k2 = []
    for p in range(1, 8):
        rr = get_json(f"https://m.stock.naver.com/api/index/KPI200/price?pageSize=60&page={p}") or []
        k2 += rr
        if not rr or rr[-1]["localTradedAt"] < START: break
    k2 = sorted({x["localTradedAt"]: x for x in k2}.values(), key=lambda x: x["localTradedAt"])
    f_ = lambda s: float(s.replace(",", ""))
    known = set(C["marks"]["cb"]) | set(C["marks"]["sc"])
    unk = []
    for a, b in zip(k2, k2[1:]):
        if b["localTradedAt"] >= "2026-01-01" and f_(b["lowPrice"]) / f_(a["closePrice"]) - 1 <= -0.05:
            dd = ymd(b["localTradedAt"])
            if dd not in known: unk.append(dd)
    if unk: C["marks"]["sc_unk"] = unk
except Exception as e:  # noqa
    print(f"[warn] kpi200: {e}")

# 5) 구간별 계산
def S(col, a, b): return sum((R[x][col] or 0) for x in D[a:b + 1])
def last_le(m, d):
    ks_ = [x for x in m if x <= d]; return m[max(ks_)] if ks_ else None
eps = C["episodes"]
for n, e in enumerate(eps):
    si = D.index(e["start"]); pre = D[si - 1]; pc = R[pre][1]
    win = [x for x in D if e["start"] <= x <= (D[-1] if e.get("live") else e["end"])]
    tr = min(win, key=lambda x: R[x][1]); ti = D.index(tr)
    lowd = min(win, key=lambda x: R[x][2])
    after = D[ti + 1:]
    rec = None if e.get("live") else next((x for x in after if R[x][1] >= pc), None)
    best = max(after[:40], key=lambda x: R[x][1]) if after else None
    endw = rec or best
    post = [x for x in after if endw and x <= endw][:15]
    pa, pb = (D.index(post[0]), D.index(post[-1])) if post else (None, None)
    streak = next((after[k] for k in range(len(after) - 2) if all((R[after[k + m]][3] or 0) > 0 for m in range(3))), None)
    wl = [x for x in D[si:min(ti + 4, len(D))] if R[x][8] is not None]
    peak = max(wl, key=lambda x: R[x][8]) if wl else None
    nxt = D.index(eps[n + 1]["start"]) - 1 if n + 1 < len(eps) else len(D) - 1
    ei = len(D) - 1 if e.get("live") else max(min(D.index(endw) if endw else ti, nxt), D.index(e["end"]))
    crd = lambda d: next((R[x][7] for x in reversed(D[:D.index(d) + 1]) if R[x][7] is not None), None)
    crd_d = lambda d: next((x for x in reversed(D[:D.index(d) + 1]) if R[x][7] is not None), None)
    dep = lambda d: next((R[x][10] for x in reversed(D[:D.index(d) + 1]) if R[x][10] is not None), None)
    pe = post[-1] if post else tr
    e["calc"] = {
        "pre": pre, "pre_close": pc, "trough": tr, "trough_close": R[tr][1], "dd": round((R[tr][1] / pc - 1) * 100, 2),
        "low_day": lowd, "low": R[lowd][2], "rec": rec, "rec_td": (D.index(rec) - ti) if rec else None,
        "best": best, "best_close": R[best][1] if best else None, "best_pct": round((R[best][1] / R[tr][1] - 1) * 100, 2) if best else None,
        "si": si, "ti": ti, "ei": ei,
        "f_drop": S(3, si, ti), "fut_drop": S(4, si, ti), "inst_drop": S(5, si, ti), "ind_drop": S(6, si, ti),
        "post_start": post[0] if post else None, "post_end": post[-1] if post else None, "post_days": len(post),
        "f_post": S(3, pa, pb) if post else 0, "fut_post": S(4, pa, pb) if post else 0,
        "inst_post": S(5, pa, pb) if post else 0, "ind_post": S(6, pa, pb) if post else 0,
        "f_streak3": streak,
        "credit_pre": crd(pre), "credit_pre_d": crd_d(pre), "credit_tr": crd(tr), "credit_tr_d": crd_d(tr),
        "credit_rec": crd(pe), "credit_rec_d": crd_d(pe),
        "liq_peak_d": peak, "liq_peak": R[peak][8] if peak else None, "liq_peak_pct": R[peak][9] if peak else None,
        "dep_pre": dep(pre), "dep_tr": dep(tr), "dep_rec": dep(pe),
        "fx_pre": R[pre][11], "fx_max": max((R[x][11] or 0) for x in win), "fx_rec": R[pe][11],
    }
C["series"] = series
C["updated"] = now_kst().strftime("%Y-%m-%d %H:%M KST")
C["asof"] = D[-1]
save("crash.json", C)
print(f"[ok] crash: {len(series)}거래일 · 구간 {len(eps)}개 · 발동 미확인 {len(C['marks'].get('sc_unk', []))}일")
