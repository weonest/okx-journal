# 진행 기록

현재 단계: 3

## 0단계 (2026-10-31)
- 한 일: package.json, .gitignore, vendor 차트 라이브러리, git init, private 저장소 weonest/okx-journal push
- 남은 일: OKX Read 전용 API 키 발급(키는 .env.local에만, 2단계에서 사용)
- 주의: 저장소는 계획(public)과 달리 private. Node v26.13.0

## 1단계 (2026-10-31)
- 한 일: csv.js(parseCsv/parseOkxFile/detectKind), normalize.js(공통 레코드 JSDoc, fromCsv A~E), tests/csv.test.js + 합성 fixtures 12개 통과
- 남은 일: CSV A·B 시간대·Instrument·Side 표기·Fee 부호는 실파일 확인 필요(메타에 UTC±N 없으면 ts=null, tzOffsetHours로 지정)
- 주의: A·B 시각은 옵션 없이 추정하지 않음. fixture 헤더는 docs/CSV.md 기준 합성이라 실파일과 대조 필요

## 2단계 (2026-10-31) — 완료(데이터 확인은 3단계/CSV로 이월)
- 한 일: sign/client/mapApi/sync(okx/), merge.js, scripts/export.js·inspect.js, tests/okx.test.js(전체 19개 통과)
- 남은 일: export 인증 성공, 최근 3개월 거래 0건. DATA.md "확인 결과"는 아카이브·CSV 데이터로 채운다. 사용자가 `cp data/okx-subtypes.json docs/subtypes.json` 실행 필요
- 주의: API instType SWAP·FUTURES는 앱 FUTURES로 합침. CSV E(archive)의 instType SWAP 변환은 3단계에서. 첫 export 실행 시 실제 응답으로 오류 가능(코드는 가짜 fetch로만 검증)

## 3단계 (2026-10-31) — 코드 완료, 실파일 확인 남음
- 한 일: client.post, okx/archive.js(apply/get/wait), fromCsv E에 subtypes→type·SWAP→FUTURES, export.js --archive=2025Q3, tests/archive.test.js(전체 22개 통과)
- 남은 일: 사용자가 `node --env-file=.env.local scripts/export.js --archive=<분기>` 실행 후 압축 해제, 실제 헤더를 DATA.md "확인 결과"에 기록(완료 기준). 호출 시 `docs/subtypes.json`을 opts.subtypes로 넘길 것
- 주의: 신청은 하루 12회 제한(스크립트는 1회만 신청). 다운로드 응답 형식(zip 여부)은 실제 실행으로 확인 필요

<!-- 단계가 끝날 때마다 아래 형식으로 3줄 추가 -->
<!--
## N단계 (YYYY-MM-DD)
- 한 일:
- 남은 일:
- 주의:
-->
