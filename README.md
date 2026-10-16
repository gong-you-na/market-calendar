# WizView — 위즈덤투스 투자 클리닉 (자동 갱신)

- `index.html` / `app.js` / `style.css` — 페이지. `data/*.json`을 읽어 렌더.
- `data/events.json` — 일정(한국시간, 롤링). 예약 작업이 갱신.
- `data/earnings.json` — 학습기업 8분기 실적·±5거래일 주가·다음 발표일 (Nasdaq·Yahoo Finance).
- `data/market.json` — 시장 체온계·VIX·학습기업 현재가/50일선.
- `data/heatmap.json` — 미장(S&P500)·국장(코스피 상위) 히트맵. `data/xray.json` — 1군 매물대·옵션 OI 엑스레이.
- `netlify/functions/yf.js` — 브라우저용 실시간 시세 프록시(Yahoo·CBOE).
- `chart.js` 캔들차트 · `heatmap.js` 트리맵.
- `data/terms.json` — 용어 풀이. `data/config.json` — 학습기업·기준선 설정.
- `scripts/` — 숫자 데이터 수집 스크립트. `AUTOMATION.md` — 예약 작업 런북.

로컬 확인: `python3 -m http.server 8765` → http://localhost:8765
- 데일리 토픽 보드는 별도 저장소 [wiztopics](https://github.com/gong-you-na/wiztopics) → https://wiztopics.netlify.app (이 저장소의 `data/*.json`을 읽기 전용으로 재사용).
