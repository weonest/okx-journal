# OKX 매매일지

OKX 거래 데이터를 브라우저에서 계산해 대시보드·거래 복기·매매일지를 보여주는 정적 웹앱.
데이터는 API(최근 3개월), 원장 아카이브, CSV(과거)로 받는다. 상품군은 FUTURES, SPOT, MARGIN이다.

## 원칙
- API 키·시크릿·패스프레이즈와 노션 토큰을 코드, 커밋, 로그, 테스트에 남기지 않는다.
- `data/`, `.env*`, `vendor/`는 에이전트가 읽지 않는다(`.claude/settings.json`에서 차단). 실데이터는 `scripts/inspect.js`의 집계 출력으로만 본다.
- 숫자를 지어내지 않는다. 근거가 없으면 `-`와 사유를 표시한다.
- 스택 고정: 빌드 없음, npm 패키지 설치 금지, 서버 없음. 기기 간 복기 동기화는 사용자 본인의 Google Drive(appDataFolder)를 쓴다.

## 구조
```
index.html  style.css  vendor/(차트 라이브러리)
src/core/      csv normalize merge eventTypes ledger positions spot orders metrics
src/core/okx/  sign client mapApi sync archive
src/ui/        화면
scripts/       export.js(사용자가 실행), inspect.js(집계만 출력)
tests/         *.test.js, fixtures/(합성 데이터)
docs/  PLAN.md(단계) DATA.md(회계 규칙) OKX_API.md(API) CSV.md(CSV 양식)
PROGRESS.md(진행 기록)  .claude/rules/(경로별 규칙)
```

## 명령
- 테스트 하나: `node --test --test-reporter=dot tests/<이름>.test.js`
- 전체 테스트: `npm test`
- 로컬 실행: `npx --yes http-server -c-1 -p 8080`
- 실데이터 받기(사용자 터미널): `node --env-file=.env.local scripts/export.js`
