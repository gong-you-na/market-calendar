# WizView 자동 갱신 런북 (예약 작업이 매 실행마다 따르는 절차)

이 저장소는 Netlify가 그대로 배포하는 정적 사이트입니다. 페이지(`index.html`, `app.js`, `style.css`)는 건드리지 않고
`data/*.json`만 갱신해 커밋·푸시하면 Netlify가 자동 재배포합니다.

## 원칙
1. **사실만 기록한다.** 무엇이·언제·이전치·컨센서스·발표 수치·발표일 시장 지수 변화. 전망·해석·권유 문장("우호적", "안도 랠리", "주목", "관건" 등) 금지.
2. **숫자는 출처 2개 이상으로 교차 확인한다.** 일치하지 않으면 공식 출처(BLS·BEA·연준·ISM·한국은행·기업 IR)를 우선하고, 확인이 안 되면 `est: true`(★ 예상일) 또는 "—"로 남긴다. 지어내지 않는다.
3. **날짜는 한국시간 기준.** 미국 8:30 ET 발표 = 밤 9:30(서머타임) / 밤 10:30(11/1 이후). 2:00 PM ET(FOMC) = 새벽 3시 / 4시. 장후(after-hours) 실적은 **미국 날짜 +1일**에 기록하고 `time`에 "현지 M/D 장후"를 적는다. 장전 실적은 미국 날짜 그대로.
4. **변경은 changelog에 남긴다.** 날짜 변경, 결과 추가, 일정 추가·삭제를 `events.json.changelog`에 한 줄씩(`at`, `msg`).

## 실행 시각 (하루 3회, KST)
- **장전 22:40** — 미국 8:30 ET 지표(고용·CPI·PPI·소매판매·PCE·GDP) 직후, 개장 전후. 당일 지표 result 입력이 최우선.
- **장중 02:10** — 미국 장 중반. 히트맵·체온계 숫자 갱신 + 전날 못 채운 result 보완.
- **장 마감 07:10** — 종가·장후 실적·FOMC 결과 반영, 다음 60일 일정 교차 확인, 변경 이력 정리.

## 매 실행 절차
```
bash scripts/run_numbers.sh          # 1) 시세·VIX·비트코인 관련주 / 히트맵(S&P500·코스피·ETF) / 실적 히스토리 + 청산맵(run_hourly.sh) 갱신
```
`run_numbers.sh`는 스크립트 하나가 실패해도 나머지는 진행하고 마지막에 실패 여부를 종료코드로 알립니다. 실패한 스크립트 이름을 보고에 적습니다.
(청산맵은 GitHub Actions가 매시간 `live` 브랜치에 올리므로 예약 작업의 사본 갱신은 보조용입니다.)
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

## 운영자가 채팅으로 전달하는 것 (Claude가 즉시 반영)
- **투쓰의 한마디**: 페이지의 카드는 https://us-insight.com/club/67/contents?type=all 로 연결되는 링크일 뿐이며 본문은 사이트에 두지 않는다. 링크 주소를 바꾸라고 하면 `index.html`의 `#tooth` href만 수정.
- **주요 인물의 한마디(2026년 발언 아카이브, 수동)**: 자동 수집하지 않는다. 운영자가 인물·날짜·발언·출처를 주면 `data/voices.json.items`에 `{"id":<md5 10자>,"person":"<people.json id>","date":"YYYY-MM-DD","text":"한국어 요약 1~2문장('~라고 말했다')","quote":"원문 짧은 인용(25단어 이내, 없으면 \"\")","context":"발언 장소·형식","src":"매체","url":"...","topic":"주제"}`를 추가하고 `updated`·`people[].n/latest`를 갱신. 발언 요약은 보도 내용 그대로, 평가·해석을 덧붙이지 않는다. 새 인물은 `data/people.json`에 `{id,name,en,role,wiki,x}` 추가 후 `photos.yml` 워크플로(수동 실행)로 사진을 받는다. 이창용은 2026-04-20 퇴임(후임 신현송), 팀 쿡은 2026-09-01부로 이사회 의장(후임 CEO 존 터너스) — 역할 문구는 `people.json.role`.
- 둘 다 `python3 -c "import json;json.load(open(...))"` 검증 후 바로 커밋·푸시(Netlify 자동 배포). changelog에는 적지 않는다(일정 변경이 아님).

## 매시간 자동 갱신 (GitHub Actions, 사람 개입 없음)
- `.github/workflows/hourly.yml` → `scripts/run_hourly.sh`(`update_liq.py`) → `live` 브랜치에 orphan 커밋으로 force-push. main 은 건드리지 않으므로 Netlify 배포가 일어나지 않고, 페이지(`app.js`)는 `https://raw.githubusercontent.com/gong-you-na/market-calendar/live/data/*.json` 을 먼저 읽고 실패하면 배포본 `data/` 를 쓴다.
- (뉴스 헤드라인 수집·데일리 브리핑·인물 발언 자동 수집은 2026-10-20 운영자 결정으로 폐지. 인물 발언은 수동 아카이브.)
- 청산맵: OKX(캔들·OI 히스토리·공개 청산 체결·롱숏비율)·Bitget·Hyperliquid·Kraken(캔들·OI·펀딩). Binance·Bybit는 미국 IP 차단(451/403)이라 자동 제외되며 코드엔 남아 있어 접근 가능한 환경에서 실행하면 합산된다. 레버리지 10·25·50·100배 청산가에 신규 포지션 추정치를 누적하는 자체 추정이며 Coinglass 수치와 다르다.
- 사진: `.github/workflows/photos.yml`(수동 실행)이 Wikimedia Commons 공개 라이선스 사진을 `assets/people/`에 받아 main 에 커밋. 예약 작업 환경(공유 IP)에서는 Wikimedia API가 429를 돌려줄 수 있다.

## 이벤트 스키마 (`events.json.days["YYYY-MM-DD"]` 배열의 원소)
```
{ "t": "econ|fomc|earn|hol|mkt", "n": "이름", "imp": 1|2|3, "time": "밤 9시 30분",
  "tier": 1|2|3 (earn만), "ticker": "TSLA" (earn만), "est": true (예상일일 때만),
  "why": "무엇이 발표되나(사실)", "watch": "발표 항목", "stocks": [["테슬라",1],["금융 섹터",0]],
  "src": [{"name":"BLS","url":"..."}], "result": {...} }
```
`{{용어}}` 표기는 `terms.json`의 키와 일치할 때 클릭형 풀이가 됩니다.

## 데이터 파일 역할
- `events.json` 일정·결과(Claude가 편집) · `earnings.json` 8분기 실적·반응 · `market.json` 체온계·VIX
- `heatmap.json` S&P500 전 종목 + 코스피 상위 60 (1D/1W/1M, 시총, 섹터). 유니버스 캐시 `cache/universe_*.json`은 7일마다 자동 갱신(`--refresh-universe`로 강제).
- `heatmap.json.etf` ETF 79종(finviz ETF 맵 그룹 + 해외 EWY·EWT·EWJ·EWZ·FXI·INDA·EEM·EFA + 레버리지 SOXS·SOXL·TQQQ·SQQQ·TSLL + 원자재·코인). 타일 크기는 운용자산(AUM) 제곱근, 캐시 `cache/universe_etf.json` 7일.
- `market.json` 항목: 미국 탭(S&P500·나스닥·VIX·10년물·달러·금·WTI) / 한국 탭(코스피·코스닥·원/달러·비트코인+업비트 원화·김치프리미엄). 순서·탭은 `config.json.market[].tab`.
- `voices.json`(수동 아카이브) / `liq.json`(매시간) / `people.json` / `market.json.btc_stocks`(청산맵 옆 비트코인 관련주, `config.json.btc_stocks`) — 위 "매시간 자동 갱신"·"운영자가 채팅으로 전달하는 것" 참고.
- 페이지 순서: 투쓰의 한마디(링크) → 체온계 → 히트맵 → 마켓 캘린더(다음 7일·달력) → 청산맵 → 실적 → 변경 이력 → 인물의 한마디. 각 섹션 머리에 갱신 주기를 표시하므로 주기를 바꾸면 `index.html`의 `.sec-cad` 문구도 같이 고친다.
- 브라우저는 `/.netlify/functions/yf`(Yahoo·CBOE 중계)로 5분마다 실시간 보정하고, 매시간 파일은 30분마다 다시 읽으므로, 예약 작업은 "기준 스냅샷"을 만드는 역할입니다.

## 학습기업 추가·변경
`data/config.json`의 `companies`에 `{ticker, name, en, tier, theme, rt(pre|post)}`를 추가하고 `run_numbers.sh`를 실행하면 히스토리가 자동 수집됩니다. 히트맵 테두리는 tier로, 관심종목은 `update_heatmap.py`의 `WATCH`로 관리합니다.
