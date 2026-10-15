#!/usr/bin/env bash
# 숫자 데이터 갱신(시세·VIX·실적 히스토리). 예약 작업과 수동 실행 모두 이 스크립트를 사용.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/update_market.py
python3 scripts/update_earnings.py
python3 - <<'EOF'
import json
for f in ["data/market.json","data/earnings.json","data/events.json","data/terms.json","data/config.json"]:
    json.load(open(f, encoding="utf-8"))
print("[ok] all data files valid JSON")
EOF
