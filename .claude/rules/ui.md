---
paths:
  - "src/ui/**"
  - "index.html"
  - "style.css"
---
# 화면 규칙
- 해시 라우팅으로 탭을 나눈다: `#/dashboard #/trades #/orders #/positions #/journal #/data #/settings`
- 화면 코드에서는 `src/core` 함수만 호출한다. UI에서 손익을 계산하지 않는다.
- 외부 스크립트를 불러오지 않는다. 차트는 `vendor/lightweight-charts.mjs`를 import한다(v4 API: `addLineSeries`, `addHistogramSeries`).
- 키 입력란은 `type=password`로 둔다. 저장 위치는 기본 sessionStorage이고, "이 기기에 기억"을 켰을 때만 localStorage를 쓴다.
- CSS는 `style.css` 하나에 CSS 변수로 다크 테마를 만든다. 390px 폭에서 가로 스크롤이 없어야 한다.
- 숫자 툴팁에는 source와 note를 표시한다. 예시 데이터를 보여줄 때는 배지를 상시 표시한다.
- 디자인 미세조정을 반복하지 않는다. 사용자가 브라우저로 확인한 뒤 요청한 것만 고친다.
