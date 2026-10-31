# OKX 매매일지

<!-- 사람용 메모: 이 파일은 매 요청마다 컨텍스트에 실린다. 50줄 안팎으로 유지할 것.
     HTML 주석은 컨텍스트에 들어가지 않으므로 이런 메모는 비용이 0이다.
     경로별 규칙은 .claude/rules/ 에 있고, 해당 파일을 다룰 때만 로드된다. -->

OKX 거래 데이터를 브라우저에서 계산해 대시보드·거래 복기·매매일지를 보여주는 정적 웹앱.
데이터는 API(최근 3개월), 원장 아카이브, CSV(과거)로 받는다. 상품군은 FUTURES, SPOT, MARGIN이다.

## 절대 규칙
- API 키·시크릿·패스프레이즈와 노션 토큰을 코드, 커밋, 로그, 테스트, 대화에 남기지 않는다. 사용자에게 키를 붙여넣으라고 하지 않는다.
- `data/`, `.env*`, `vendor/`는 읽지 않는다(설정으로도 차단됨). 실데이터는 `scripts/inspect.js`의 집계 출력으로만 본다.
- 숫자를 지어내지 않는다. 근거가 없으면 `-`와 사유를 표시한다.
- 스택은 고정이다. 빌드 없음, npm 패키지 설치 금지, 서버 없음.

## 세션 운영 (토큰 절약)
1. 시작할 때 `PROGRESS.md`를 읽고, `docs/PLAN.md`에서 현재 단계 절만 읽는다. `docs/DATA.md`는 단계가 지시한 절만 읽는다.
2. 한 세션에는 한 단계만 한다. 단계 안에서도 "파일 하나 작성 → 그 테스트 실행" 단위로 작게 진행한다.
3. 끝낼 때: `PROGRESS.md`에 3줄(한 일 / 남은 일 / 주의)을 쓰고, 커밋을 1회 한 뒤, 사용자에게 `/clear`를 안내한다.
4. 고칠 파일만, 필요한 줄 범위만 읽는다. 방금 쓰거나 고친 파일은 다시 읽지 않는다. 저장소 전체 탐색과 grep은 하지 않는다(파일 목록은 아래 구조에 있다).
5. 답변은 코드 위주로 하고, 설명은 3줄 이내로 한다. 파일 전체를 다시 출력하지 않는다. 계획이나 요약을 반복하지 않는다.
6. 서브에이전트, MCP, 웹 검색은 쓰지 않는다. API·CSV 양식은 `docs/OKX_API.md`, `docs/CSV.md`에 있다(해당 단계에서 필요한 절만 읽는다). 계획 모드는 ★ 단계에서만 쓴다.
7. 테스트는 `node --test --test-reporter=dot tests/<이름>.test.js`로 돌린다(통과하면 점만 찍힌다). 전체 테스트(`npm test`)는 단계가 끝날 때만 돌린다.
8. 같은 오류로 두 번 실패하면 멈춘다. 원인 가설 1~2줄과 함께 사용자에게 묻는다.

## 구조
```
index.html  style.css  vendor/(차트 라이브러리, 읽기 금지)
src/core/      csv normalize merge eventTypes ledger positions spot orders metrics
src/core/okx/  sign client mapApi sync archive
src/ui/        화면
scripts/       export.js(사용자가 실행), inspect.js(집계만 출력)
tests/         *.test.js, fixtures/(합성 데이터)
docs/  PLAN.md(단계) DATA.md(회계 규칙) OKX_API.md(API) CSV.md(CSV 양식)
PROGRESS.md  .claude/rules/(경로별 규칙)
```

# Compact instructions
압축할 때는 현재 단계 번호, 바꾼 파일 목록, 실패 중인 테스트와 그 원인만 남긴다. 파일 내용과 도구 출력 원문은 버린다.
