# 자동 갱신 런북 (예약 작업이 매 실행마다 따르는 절차)

이 저장소는 Netlify가 그대로 배포하는 정적 사이트입니다. 페이지(`index.html`, `app.js`, `style.css`)는 건드리지 않고
`data/*.json`만 갱신해 커밋·푸시하면 Netlify가 자동 재배포합니다.

## 원칙
1. **사실만 기록한다.** 무엇이·언제·이전치·컨센서스·발표 수치·발표일 시장 지수 변화. 전망·해석·권유 문장("우호적", "안도 랠리", "주목", "관건" 등) 금지.
2. **숫자는 출처 2개 이상으로 교차 확인한다.** 일치하지 않으면 공식 출처(BLS·BEA·연준·ISM·한국은행·기업 IR)를 우선하고, 확인이 안 되면 `est: true`(★ 예상일) 또는 "—"로 남긴다. 지어내지 않는다.
3. **날짜는 한국시간 기준.** 미국 8:30 ET 발표 = 밤 9:30(서머타임) / 밤 10:30(11/1 이후). 2:00 PM ET(FOMC) = 새벽 3시 / 4시. 장후(after-hours) 실적은 **미국 날짜 +1일**에 기록하고 `time`에 "현지 M/D 장후"를 적는다. 장전 실적은 미국 날짜 그대로.
4. **변경은 changelog에 남긴다.** 날짜 변경, 결과 추가, 일정 추가·삭제를 `events.json.changelog`에 한 줄씩(`at`, `msg`).

## 매 실행 절차
```
bash scripts/run_numbers.sh          # 1) 시세·VIX·실적 히스토리·다음 발표일(Nasdaq) 갱신
```
2) `data/events.json` 갱신 (Claude가 직접 편집)
   - **발표 완료 처리**: 오늘(KST) 이전 날짜 중 `result`가 없는 `econ`/`fomc` 이벤트 → 웹 검색으로 발표 수치 확인 → `result` 추가
     - `result` 형식: `{actual, est, prev, dir(up|down|flat), head, note, rows?[[항목,발표,예상,비고]], trend?[{l,v}]}`
     - `note`에는 수치와 구성 항목, 전월 수정치, 발표일 S&P500·나스닥·10년물 변화만 적는다.
   - **실적 이벤트**(`t:"earn"`)는 `earnings.json`이 EPS·반응을 자동 공급하므로 `result`를 쓰지 않는다. 다만 매출·가이던스 등 EPS 외 수치를 `why` 뒤에 사실로 1~2문장 추가해도 된다.
   - **일정 확인·추가**: 오늘부터 60일 치. `data/earnings.json`의 `next.date`와 `events.json`의 실적 이벤트 날짜(KST 환산)가 다르면 events를 고치고 changelog에 "TSLA 10/22 → 10/23 변경"처럼 기록. ★ 예상일(`est:true`)은 공식 일정이 확인되면 `est`를 제거.
   - 거시 일정 출처(교차 확인용): BLS 일정, BEA 일정, 연준 FOMC 캘린더, ISM, 미시간대, 한국은행 금통위 일정, NYSE·KRX 휴장일, fedratecalc.com 경제캘린더. 컨센서스는 Investing.com·Trading Economics·주요 언론 기사에서 확인하고 `why`에 "컨센서스 x.x%"로 적는다.
   - 새 용어가 필요하면 `data/terms.json`에 한 줄 정의 추가(사실 설명만).
   - `events.json.updated`를 현재 KST로 갱신.
3) 검증: `python3 -c "import json;json.load(open('data/events.json'))"`
4) 커밋·푸시:
```
git add data && git commit -m "data: YYYY-MM-DD HH:MM KST 자동 갱신 — <변경 요약>" && git push
```
5) 완료 보고(짧게): 바뀐 항목만. 바뀐 게 없으면 "변경 없음".

## 이벤트 스키마 (`events.json.days["YYYY-MM-DD"]` 배열의 원소)
```
{ "t": "econ|fomc|earn|hol|mkt", "n": "이름", "imp": 1|2|3, "time": "밤 9시 30분",
  "tier": 1|2|3 (earn만), "ticker": "TSLA" (earn만), "est": true (예상일일 때만),
  "why": "무엇이 발표되나(사실)", "watch": "발표 항목", "stocks": [["테슬라",1],["금융 섹터",0]],
  "src": [{"name":"BLS","url":"..."}], "result": {...} }
```
`{{용어}}` 표기는 `terms.json`의 키와 일치할 때 클릭형 풀이가 됩니다.

## 학습기업 추가·변경
`data/config.json`의 `companies`에 `{ticker, name, en, tier, theme, rt(pre|post)}`를 추가하고 `run_numbers.sh`를 실행하면 히스토리가 자동 수집됩니다.
