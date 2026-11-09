#!/usr/bin/env bash
# 숫자 데이터 갱신(시세·VIX·공포탐욕·하이일드·히트맵(미장·국장·ETF)·실적 히스토리·증권사 목표주가 + 청산맵). 예약 작업과 수동 실행 모두 이 스크립트를 사용.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
python3 scripts/update_market.py   || { echo "[err] market"; fail=1; }
python3 scripts/update_heatmap.py  || { echo "[err] heatmap"; fail=1; }
python3 scripts/update_earnings.py || { echo "[err] earnings"; fail=1; }
python3 scripts/update_crash.py    || { echo "[err] crash"; fail=1; }
bash scripts/run_hourly.sh         || { echo "[err] hourly(liq)"; fail=1; }
python3 - <<'PY'
import json
for f in ["data/market.json","data/heatmap.json","data/earnings.json","data/events.json","data/terms.json","data/config.json","data/voices.json","data/liq.json","data/crash.json"]:
    json.load(open(f, encoding="utf-8"))
print("[ok] all data files valid JSON")
PY
exit $fail
