# 진행 기록

현재 단계: 5

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

## 3단계 (2026-10-31) — 완료(실파일 확인은 거래 발생 후로 이월)
- 한 일: client.post, okx/archive.js(apply/get/wait), fromCsv E에 subtypes→type·SWAP→FUTURES, export.js --archive=2025Q3, tests/archive.test.js(전체 22개 통과)
- 남은 일: 사용자는 거래 이력이 전혀 없어 아카이브 실파일이 없음. 거래가 생기고 3개월이 지나면 `--archive=<분기>`로 받아 헤더를 DATA.md에 기록. 호출 시 `docs/subtypes.json`을 opts.subtypes로 넘길 것
- 주의: 신청은 하루 12회 제한(스크립트는 1회만 신청). 다운로드 응답 형식(zip 여부)은 실제 실행으로 확인 필요

## 4단계 (2026-10-31) — 완료(실데이터 검증은 거래 발생 후로 이월)
- 한 일: eventTypes.js(classify/positionKey), ledger.js(buildLedger: 잔량·효과·잔고 대사), positions.js(buildPositions: 라운드트립·이자 귀속·history/Position 대조), 테스트 3개(전체 통과)
- 남은 일: 포지션 모드, posBal 의미, 실제 subType, INTEREST·FUNDING 금액이 balChg인지 실데이터 확인. liqPenalty·settledPnl은 realizedPnl 비교에 미반영(차이로 표시됨)
- 주의: posBal은 쓰지 않음. 열린 기록 없는 청산은 orphans, 금액은 amounts[ccy]로 통화별 보관(통화 여럿이면 평면 합계 null)

## 5단계 (2026-10-31) — 완료(실데이터 검증은 거래 발생 후로 이월)
- 한 일: spot.js(buildSpot: 평균단가법·코인/견적 수수료·취득가 미상·먼지·라운드트립, Bill 잔고 대사, openAvgPx 대조), tests/spot.test.js 8개(전체 통과)
- 남은 일: CSV B(Fill)에는 side 컬럼이 없어 normalize가 side를 채우지 않음 → CSV Fill은 noSide로 빠진다. 실파일 확인 후 매핑 필요. 먼지 기준 minSz는 호출 측이 opts.dust로 전달. Bill의 tradeId·SPOT 수수료 통화 실데이터 확인
- 주의: 라운드트립 pnl은 수수료 제외, fee는 매수수수료(매도분 몫)+매도수수료. 기초코인 수수료는 수량 차감으로 평균단가에 녹음(fee 미포함). 제3통화 수수료는 notes

<!-- 단계가 끝날 때마다 아래 형식으로 3줄 추가 -->
<!--
## N단계 (YYYY-MM-DD)
- 한 일:
- 남은 일:
- 주의:
-->
