"""주요 인물 프로필 사진: Wikipedia 대표 이미지(Wikimedia Commons, 공개 라이선스) → assets/people/<id>.jpg
라이선스·저작자 정보는 data/people.json 의 img_credit 에 기록. 실행: python3 scripts/fetch_people_photos.py  (사진이 없는 인물만 받음, --force 로 전체)
"""
import os, re, sys, json, html, time, urllib.request, urllib.parse
from common import load, save, ROOT, UA

FORCE = "--force" in sys.argv
BOT_UA = "WizViewBot/1.0 (https://github.com/gong-you-na/market-calendar; bot@wisdomtooth.local) python-urllib"
OUT = os.path.join(ROOT, "assets", "people")
os.makedirs(OUT, exist_ok=True)


import subprocess


def curl(url):
    # Wikimedia는 urllib 요청에 429를 자주 돌려줘 curl 사용
    r = subprocess.run(["curl", "-sS", "-m", "40", "-A", BOT_UA, "-L", url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:200])
    return r.stdout


def gj(url):
    return json.loads(curl(url).decode())


people = load("people.json", {"people": []})
todo = [p for p in people["people"] if FORCE or not os.path.exists(os.path.join(OUT, p["id"] + ".jpg"))]
if not todo:
    print("[ok] all photos present"); raise SystemExit
titles = "|".join(urllib.parse.quote(p["wiki"]) for p in todo)
j = gj(f"https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name|thumbnail&pithumbsize=480&titles={titles}&format=json&redirects=1")
by_title = {}
for pg in j["query"]["pages"].values():
    by_title[pg["title"]] = pg
# redirects 매핑
for r in j["query"].get("redirects", []):
    if r["to"] in by_title:
        by_title[r["from"]] = by_title[r["to"]]
time.sleep(1)
for p in todo:
    pg = by_title.get(p["wiki"])
    if not pg or not pg.get("pageimage"):
        print(f"[warn] no image for {p['wiki']}"); continue
    fname = pg["pageimage"]
    try:
        k = gj("https://commons.wikimedia.org/w/api.php?action=query&titles=File:" + urllib.parse.quote(fname) + "&prop=imageinfo&iiprop=url|extmetadata&format=json")
        ii = list(k["query"]["pages"].values())[0]["imageinfo"][0]
        em = ii.get("extmetadata", {})
        lic = em.get("LicenseShortName", {}).get("value", "")
        artist = html.unescape(re.sub("<[^>]+>", "", em.get("Artist", {}).get("value", ""))).strip()
        p["img_credit"] = {"file": fname, "license": lic, "artist": artist[:80], "url": ii.get("descriptionurl")}
    except Exception as e:
        print(f"[warn] license lookup {fname}: {e}", file=sys.stderr)
        p["img_credit"] = {"file": fname, "license": "", "artist": "", "url": "https://commons.wikimedia.org/wiki/File:" + fname}
    src = pg["thumbnail"]["source"].split("?")[0]
    try:
        data = curl(src)
        if len(data) < 2000:
            raise RuntimeError("image too small / blocked")
        with open(os.path.join(OUT, p["id"] + ".jpg"), "wb") as f:
            f.write(data)
        p["img"] = f"assets/people/{p['id']}.jpg"
        print(f"[ok] {p['id']}: {fname} ({lic}) {len(data)//1024}KB")
    except Exception as e:
        print(f"[warn] download {p['id']}: {e}", file=sys.stderr)
    time.sleep(1.2)
save("people.json", people)
