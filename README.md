# WizView — 위즈덤투스 투자 클리닉 (자동 갱신)

- `index.html` / `app.js` / `style.css` — 페이지. `data/*.json`을 읽어 렌더.
- `data/events.json` — 일정(한국시간, 롤링). 예약 작업이 갱신.
- `data/earnings.json` — 학습기업 8분기 실적·±5거래일 주가·다음 발표일 (Nasdaq·Yahoo Finance).
- `data/market.json` — 시장 체온계·VIX·학습기업 현재가/50일선·비트코인 관련주.
- `data/heatmap.json` — 미장(S&P500)·국장(코스피 상위)·ETF(finviz 구성 + EWY·EWT·EWJ·EWZ·SOXS 등) 히트맵.
- 투쓰의 한마디 — US INSIGHT 클럽(https://us-insight.com/club/67/contents?type=all)으로 가는 링크 카드.
- `data/voices.json` — 주요 인물의 한마디: 2026년 공개 발언 아카이브(수동 관리, 날짜·요약·짧은 인용·출처).
- `data/liq.json` — 비트코인 청산맵(OKX·Bitget·Hyperliquid·Kraken 공개 데이터로 자체 추정, 매시간). `data/people.json` — 인물 목록·사진 출처.
- 매시간 파일(liq)은 GitHub Actions(`.github/workflows/hourly.yml`)가 `live` 브랜치에만 올리고 페이지가 raw.githubusercontent 에서 직접 읽습니다(Netlify 재배포 없음). main 의 사본은 예약 작업이 하루 2회(미국·한국 장 마감 16분 후) 갱신.
- `netlify/functions/yf.js` — 브라우저용 실시간 시세 프록시(Yahoo·CBOE).
- `heatmap.js` 트리맵 · `liq.js` 청산맵 캔버스.
- `data/terms.json` — 용어 풀이. `data/config.json` — 학습기업·기준선 설정.
- `scripts/` — 숫자 데이터 수집 스크립트. `AUTOMATION.md` — 예약 작업 런북.

로컬 확인: `python3 -m http.server 8765` → http://localhost:8765
- 데일리 토픽 보드는 별도 저장소 [wiztopics](https://github.com/gong-you-na/wiztopics) → https://wiztopics.netlify.app (이 저장소의 `data/*.json`을 읽기 전용으로 재사용).
