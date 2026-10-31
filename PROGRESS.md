# 진행 기록

현재 단계: 2

## 0단계 (2026-10-31)
- 한 일: package.json, .gitignore, vendor 차트 라이브러리, git init, private 저장소 weonest/okx-journal push
- 남은 일: OKX Read 전용 API 키 발급(키는 .env.local에만, 2단계에서 사용)
- 주의: 저장소는 계획(public)과 달리 private. Node v26.13.0

## 1단계 (2026-10-31)
- 한 일: csv.js(parseCsv/parseOkxFile/detectKind), normalize.js(공통 레코드 JSDoc, fromCsv A~E), tests/csv.test.js + 합성 fixtures 12개 통과
- 남은 일: CSV A·B 시간대·Instrument·Side 표기·Fee 부호는 실파일 확인 필요(메타에 UTC±N 없으면 ts=null, tzOffsetHours로 지정)
- 주의: A·B 시각은 옵션 없이 추정하지 않음. fixture 헤더는 docs/CSV.md 기준 합성이라 실파일과 대조 필요

<!-- 단계가 끝날 때마다 아래 형식으로 3줄 추가 -->
<!--
## N단계 (YYYY-MM-DD)
- 한 일:
- 남은 일:
- 주의:
-->
