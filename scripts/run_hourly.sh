#!/usr/bin/env bash
# 매시간 갱신(GitHub Actions `hourly` 워크플로가 실행): 주요 이슈·인물 발언·비트코인 청산맵. 결과는 `live` 브랜치에만 올라감.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
python3 scripts/update_news.py   || { echo "[err] news"; fail=1; }
python3 scripts/update_voices.py || { echo "[err] voices"; fail=1; }
python3 scripts/update_liq.py    || { echo "[err] liq"; fail=1; }
python3 - <<'PY'
import json
for f in ["data/news.json","data/voices.json","data/liq.json","data/voices_manual.json","data/people.json"]:
    json.load(open(f, encoding="utf-8"))
print("[ok] hourly data files valid JSON")
PY
exit $fail
