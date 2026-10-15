# WizTopics 자동 갱신 런북 (예약 작업이 매 실행마다 따르는 절차)

WizTopics(`topics/`)는 위즈덤투스 데일리 토픽 보드다. 페이지 코드(`index.html`, `app.js`, `style.css`)는 **수정하지 않는다**. 예약 작업은 `topics/data/` 아래 JSON만 만들고 푸시한다. Netlify가 저장소 변경을 감지해 자동 배포한다.

## 산출물 (매일 3개 파일)
1. `topics/data/YYYY-MM-DD.json` — 오늘 하루치 (아래 스키마)
2. `topics/data/latest.json` — 1번과 동일한 내용 복사
3. `topics/data/index.json` — `{"dates": ["2026-10-15", "2026-10-16", ...]}` 오름차순, 오늘 날짜 추가 (최근 60일 유지)

작성 후 반드시 `python3 -I -c "import json;json.load(open('topics/data/YYYY-MM-DD.json'))"` 로 검증한다.

## 커밋·푸시
```
git -C /home/claude/market-calendar add topics/data && \
git -C /home/claude/market-calendar -c user.name=wisdomtooth-bot -c user.email=bot@wisdomtooth.local \
  commit -m "topics: YYYY-MM-DD 데일리 토픽 보드" && \
git -C /home/claude/market-calendar push origin main
```
푸시 거부 시 `git pull --rebase origin main` 후 1회 재시도.

## 스키마 (`topics/data/YYYY-MM-DD.json`)
값을 모르면 **지어내지 말고** `null`(숫자) 또는 `"확인 불가"`(문자열)로 둔다. 페이지는 `null`을 "확인 불가"로 표시한다.

```jsonc
{
  "date": "2026-10-15", "weekday": "목", "generated_at": "2026-10-15 06:55 KST", "generated_by": "예약 작업",
  "headline": "한 줄 헤드라인 (20자 내외)",
  "summary": ["한눈에 5줄"],
  "thermometer": [ {"key":"vix|tnx|dxy|krw|gold","label":"","value":0,"unit":"%|원|$|","pct":0,"band":"기준선 대비 설명","asof":"10/15 06:45"} ],
  "markets": {
    "us": {"asof":"", "indices":[{"name":"","close":"51,621.48","pct":-0.09}], "movers":[{"name":"","pct":0,"note":""}], "notes":["..."]},
    "kr": {"asof":"", "indices":[{"name":"","close":"","pct":0,"chg":"-454.59"}], "flows":[{"who":"외국인|기관|개인","amount":-36241,"note":""}], "flows_unit":"억원 (코스피 현물)", "movers":[...], "notes":[...]},
    "futures": {"asof":"", "items":[{"name":"","pct":0,"value":"$103.8","note":""}], "premarket":"한 줄"}
  },
  "macro": {"fed":"연준 한 단락", "geo":"지정학 한 단락"},
  "events": [{"kst":"10/22 (수) 새벽","what":"","tag":"지표|연준|실적|휴장"}],
  "checks": ["국장 개장 전 체크 3개"],
  "youtube": {
    "note": "수집 방법·한계 한 줄",
    "domestic": [{"channel":"","title":"","when":"10/14","minutes":41,"views":null,"likes":null,"angle":"이 영상의 각도","url":""}],
    "intl": [{"channel":"","title":"","when":"","views":null,"angle":"","url":""}],
    "frame_gap": "국내 채널 공통 프레임 vs 비어 있는 각도 (한 줄)"
  },
  "angles": ["오늘 등장한 각도 6~8개 — 매트릭스 열"],
  "coverage_matrix": [{"channel":"삼프로TV","region":"KR|US","covered":["각도명", ...]}],
  "topics": [ {
    "id":"t1","rank":1,"kind":"급부상 · 국장↔미장","urgency":"오늘 안에|이번 주|상시",
    "title_trust":"","title_curious":"","thumb":"6자 내외",
    "fact":"","insight":"","checks":["","",""],
    "emotion":"","hook":"구독 전환 포인트","diff":"차별화","angles":["이 주제가 쓰는 각도"],
    "signals": [{"label":"","value":"-7.57%","source":""}],          // 근거 수치 4개 (문자열 그대로 표시)
    "charts": [                                                     // 1~2개. 숫자 단위가 같은 항목끼리만 한 차트에
      {"type":"bar","title":"","unit":"%","items":[{"label":"","value":-7.57,"tag":"선택"}],"source":""},
      {"type":"line","title":"","unit":"%","points":[{"x":"10/13","label":"CPI 전","y":22}],"source":""},
      {"type":"line","title":"","unit":"$","series":[{"name":"실제","points":[{"x":"24.9","y":0.62}]},{"name":"예상","points":[...]}],"source":""}
    ],
    "coverage": [{"channel":"","region":"KR|US","when":"","angle":"","views":null}]
  } ],
  "pick": {"id":"t1","why":"오늘 1개만 찍는다면 — 이유 2줄"},
  "pipeline": [{"when":"","what":"선행 기획"}],
  "sources": [{"title":"","url":""}],
  "unverified": ["확인 못 한 항목"]
}
```

### 차트 데이터 원칙
- `bar`: 등락률·확률처럼 **같은 단위** 항목 비교. 값 부호로 색이 정해진다(양수 빨강·음수 파랑). 항목 3~8개.
- `line`: 시간 흐름(인상 확률 변화, CDS, 금리 추이, 8분기 EPS). `points` 또는 2개 이상 `series`. 점 2개 이상.
- 조회수·검색량·좋아요는 **확인된 경우에만** 숫자로 넣고, 아니면 `null`. "관심도 추정"은 `signals`에 `"0 / 8편"`처럼 **세어서 확인한 값**으로 표현한다(예: 국내 채널 중 이 각도를 다룬 편수).
- 좋은 근거 수치의 예: 당일 등락률, 지표 실제 vs 예상, 인상 확률 변화, 외국인 순매도 누적, 채권 수익률·CDS, 학습기업 8분기 반응(earnings.json), 국내/해외 커버 채널 수, 고점 대비 낙폭 vs 과거 위기.

### WizView 데이터 재사용
같은 저장소의 `data/market.json`(시세·VIX·학습기업 현재가), `data/earnings.json`(8분기 실적·반응·다음 발표일), `data/events.json`(일정)을 1차 출처로 쓴다. `asof`를 확인해 전일 종가인지 표기한다.
