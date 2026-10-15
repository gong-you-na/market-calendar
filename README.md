# 위즈덤투스 마켓 캘린더 (자동 갱신)

- `index.html` / `app.js` / `style.css` — 페이지. `data/*.json`을 읽어 렌더.
- `data/events.json` — 일정(한국시간, 롤링). 예약 작업이 갱신.
- `data/earnings.json` — 학습기업 8분기 실적·±5거래일 주가·다음 발표일 (Nasdaq·Yahoo Finance).
- `data/market.json` — 시장 체온계·VIX·학습기업 현재가/50일선.
- `data/terms.json` — 용어 풀이. `data/config.json` — 학습기업·기준선 설정.
- `scripts/` — 숫자 데이터 수집 스크립트. `AUTOMATION.md` — 예약 작업 런북.

로컬 확인: `python3 -m http.server 8765` → http://localhost:8765
