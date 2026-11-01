# 진행 기록

현재 단계: 11

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

## 6단계 (2026-10-31) — 완료(실데이터 검증은 거래 발생 후로 이월)
- 한 일: orders.js(buildOrders: ordId 조인·VWAP·maker/taker·불일치 목록·상품군별 상태/체결률/취소율/부분체결/시장가 비율·Bill 매칭률), tests/orders.test.js 4개(전체 통과)
- 남은 일: CSV A/B의 state·ordType·execType 표기(maker/taker, canceled 등)와 szUnit 실파일 확인. Order fee 부호·accFillSz 단위(계약수 vs 코인) 실데이터 확인
- 주의: 손익·수수료는 합산하지 않음(주문 단위 fee 대조만). 체결 없는 주문은 불일치에서 제외. 체결률=state filled 기준, 부분체결=체결>0 & 수량 미달 & 미완료

## 7단계 (2026-10-31) — 완료(실데이터 검증은 거래 발생 후로 이월)
- 한 일: metrics.js(buildMetrics: 상품군 필터·통화별 합계·승률/평균/손익비·일별 KST 누적·누적 MDD·보유시간·롱숏·레버리지·최대 노출·일 빈도), tests/metrics.test.js 5개(전체 통과)
- 남은 일: USD 합계는 opts.usdRate(ccy,ts,trade)→{rate,basis}를 호출 측이 주입(CSV C *-USD → fillIdxPx → 캔들 종가 순서는 8단계 조립부에서). 레버리지는 trade.lever, 최대 노출은 opts.notionalOf 필요 — trade에 lever·ctVal 전파는 미구현. 잔고 기준 MDD 미구현
- 주의: 통화 여럿인 거래는 승/패에서 제외(note 표시). 승률 분모는 무승부 포함, 손익비=평균이익/|평균손실|. MDD는 0에서 시작한 누적 순손익 기준

## 8단계 (2026-10-31) — 코드 완료, 브라우저 확인 대기
- 한 일: core/pipeline.js(CSV·API→병합→분석, tests/pipeline.test.js), index.html·style.css, src/ui/(app·store·dom·settings·data·dashboard). 전체 테스트 통과
- 남은 일: 사용자가 `npx --yes http-server -c-1 -p 8080`로 예시 데이터·모든 탭 렌더, 실제 키 동기화 건수가 export와 일치하는지 확인. vendor의 createChart export명과 브라우저 CORS(OKX 개인 API 직접 호출 가능 여부) 미확인. 동기화 결과는 새로고침 시 사라짐(증분 저장 없음)
- 주의: USD 합계는 usdRate 미주입이라 '-'. 9단계 탭(거래·주문·포지션)과 journal은 자리표시

## 9단계 (2026-10-31) — 코드 완료, 브라우저 확인 대기
- 한 일: src/ui/trades.js(목록 정렬·필터, 상세 타임라인, market/history-candles 캔들+진입·청산 마커), positions.js(Position/CSV 스냅샷, SPOT 보유), orders.js(6단계 통계), app.js 라우트 연결. 전체 테스트 통과
- 남은 일: 브라우저에서 예시 데이터로 거래 상세·캔들 표시 확인(8단계 확인 포함). vendor에 addCandlestickSeries·setMarkers(v4) 존재 여부 미확인. 캔들은 1회 100개만 조회(긴 보유는 봉이 굵어짐)
- 주의: 미실현·노출은 선형계약 가정의 '추정'(OKX upl 필드가 Position 레코드에 없음). public/instruments는 쓰지 않고 Position.ctVal 사용. 상세에서 FUTURES 체결 연결은 Bill.tradeId 기준

## 10단계 (2026-10-31) — 배포 완료, 브라우저 확인 대기
- 한 일: 저장소 public 전환, push, GitHub Pages(main /) 활성화 → https://weonest.github.io/okx-journal/ (주요 파일 200 확인)
- 남은 일: 배포 URL에서 예시 데이터 렌더·키 동기화 확인. OKX 개인 API의 브라우저 CORS 허용 여부 미확인(막히면 동기화는 export.js로 대체). 11단계(노션)는 선택
- 주의: 저장소가 public이므로 커밋에 키·data 금지(.gitignore로 차단됨, 이력 스캔 시 키 패턴 없음)

## 예시 데이터 확장 (2026-10-31)
- 한 일: scripts/make-demo.js(고정 시드 합성) → demo/{order,fills,bills}.csv·extra.json. FUTURES 40건·SPOT 4건·열린 포지션 2·BTC 보유. 원장·주문 대사 불일치 0. loadSample은 demo/ 사용(tests/fixtures는 테스트 전용 유지)
- 주의: 선물 Bill은 CSV E(아카이브) 형식+docs/subtypes.json으로 분류. CSV Fill에 side가 없어 현물 체결·Position·balance는 extra.json에 정규화 레코드로 넣음. .gitignore에 !demo/*.csv

## 11단계 (2026-10-31) — 코드 완료, 실제 노션 DB 확인 대기
- 한 일: core/notion.js(속성 파싱·일지↔거래 연결·전략/실수/등급 집계, tests/notion.test.js), scripts/notion-export.js(DB 조회+본문→data/notion-journal.json), ui/journal.js(#/journal 업로드·집계·목록, 거래 상세에 일지 표시), 예시 일지 demo/journal.json
- 남은 일: 사용자가 노션에 개인 DB(속성: 날짜·종목·방향·전략·실수·등급·연결ID)와 읽기 전용 통합을 만들고 .env.local에 NOTION_TOKEN·NOTION_DB를 넣은 뒤 `node --env-file=.env.local scripts/notion-export.js` 실행 → 파일을 #/journal에 업로드. 실제 속성 타입(종목이 select인지 text인지 등)은 확인 필요
- 주의: 계획과 달리 브라우저 직접 호출이 아니라 내보내기 스크립트(노션 API CORS). Notion-Version 2022-06-28 고정(2025-09-03부터 DB query는 deprecated, data source query로 이동 — 문서에서 엔드포인트 경로는 확인 못 함). 집계는 metrics.js가 아니라 notion.js에 둠. 시각 있는 일지는 ±5분 허용 연결

## 대시보드 개편 (2026-10-31)
- 한 일: 기간 탭(전체·7·30·90일) 공유, "N일 손익" 큰 숫자+누적 영역차트, 일간 PnL 막대(크로스헤어 값 표시)+PnL 분석(일 승률·수익일/손실일·누적 이익/손실), KPI 4개만 노출·나머지 접기, 구분별 성과 탭화. metrics.periodPnl 추가(+테스트)
- 주의: 기간 기준일은 오늘이 아니라 데이터의 마지막 청산일. 브라우저 확인 대기

## 트레이딩 캘린더 개편 (2026-10-31)
- 한 일: OKX식 캘린더(일별 손익·N건 청산 셀, 수익/손실 테두리) + 우측 총 손익(스파크라인)·수익 팩터·승/패율(반원 링)·손익비. core metrics.monthStats(+테스트)
- 주의: 월 집계는 거래 단위·선택한 상품군/통화 기준. 손실이 없으면 수익 팩터·손익비는 `--`. 브라우저 확인 대기

## 거래 탭 통합 레이아웃 (2026-10-31)
- 한 일: #/trades를 한 화면으로 — 위: 선택 거래 캔들(봉 선택)+연결된 노션 일지+타임라인(접기), 아래: 검색·필터·정렬 표(매매일·종목·SIDE·최대수량·순손익·평균 진입/청산가·전략·실수·등급). 행 클릭 시 위가 바뀜. positions.js에 avgEntryPx/avgExitPx(수량 가중, FUTURES·MARGIN) 추가(+테스트). 캔들 구간 캐시
- 주의: 현물은 평균 진입/청산가 '-'. 레버리지·마진·ROE 열은 trade에 데이터가 없어 미구현. 브라우저 확인 대기

## 탭 구성 개편 (2026-10-31)
- 한 일: 상단 탭 = 종합 대시보드 · 거래 상세 목록 · 트레이딩 캘린더(#/calendar) · 주기별 손익 정산(#/periods) · 매매일지, 나머지(주문·포지션·데이터 점검·설정)는 "더 보기". 헤더 우측에 CSV 업로드·동기화(설정으로)·삭제. 대시보드에서 캘린더 분리. 거래 상세의 요약 줄(진입→청산·통화별 손익) 제거. core metrics.periodTable(+테스트), .claude/rules/ui.md 라우트 갱신
- 주의: 브라우저 확인 대기. 동기화 버튼은 설정 탭으로 이동만 함

## 상단 시세 패널 (2026-10-31)
- 한 일: ui/market.js — 주요 5개 탭 상단에 유지되는 종목 카드 5개(나의 최다 거래 / OKX 거래량 상위 토글, OKX 공개 ticker)+캔들 차트(1분·15분·1시간·4시간·1일·1주)+내 진입·청산 마커(선택 거래는 큰 마커·해당 구간 확대). 거래 탭은 자체 차트를 제거하고 행 선택이 상단 차트를 바꿈. 캘린더는 상단 차트만 추가된 형태
- 주의: 시세는 브라우저에서 OKX 공개 API 직접 호출(CORS 허용 여부 미확인). 마커는 라운드트립 진입/청산 시각 기준(분할 체결은 별도 표시 안 함). 브라우저 확인 대기

## 이 기기에 기억 개선 (2026-10-31)
- 한 일: 체크박스를 켜는 즉시 키 저장(동기화를 누르지 않아도), 켜 둔 동안 불러온 데이터(API 동기화·CSV·노션 일지)를 IndexedDB에 저장하고 새로고침 때 복원(store.restore). 끄면 저장분 삭제. 예시 데이터는 저장 안 함. 이전에는 키만 동기화 시점에 저장되고 데이터는 새로고침하면 사라졌음
- 주의: 데이터는 이 브라우저(배포 도메인)에만 있음. 브라우저 확인 대기

## 모바일(iPhone 15, 393px) (2026-10-31)
- 한 일: viewport-fit=cover·safe-area·홈 화면 추가 메타, 헤더 아이콘화+탭 가로 스와이프(선택 탭 자동 스크롤), 종목 카드 가로 스와이프, 차트 높이 300, KPI 2열, 표는 내부 가로 스크롤, 속성/필터 팝오버 전폭, 입력 16px(iOS 확대 방지). 데스크톱 레이아웃은 유지
- 주의: 실기기·브라우저 확인 전(개발 환경에서 화면 렌더 불가). 문제 화면은 스크린샷으로 요청받아 수정

## 거래별 복기 페이지 + 체결 표시 (2026-11-01)
- 한 일: 세션 상세 목록 "열기" → 노션식 복기 페이지(src/ui/review.js, core/review.js). 거래 값 자동 + 진입근거·전략·심리·규칙수행도·피드백·할일·실수·등급·마진 편집, ROE(마진 입력 시), 레버리지(Order.lever), 체결 표, 댓글, 이미지(붙여넣기·끌어다놓기, 1600px JPEG), 마크다운 본문. IndexedDB 'reviews'에 항상 저장(예시 데이터는 저장 안 함), #/journal에 백업 내보내기/불러오기, 통계는 노션+복기 합산. 라운드트립에 execs(체결 목록) 추가, 표 "체결" 열, 선택 거래 차트 마커를 체결마다 B/S로
- 남은 일: 실기기 확인. 실제 4회 거래가 0→0 구간 4개였는데 1건으로 묶였다면 inspect로 해당 상품 Bill 순서 확인 필요
- 주의: 거래 1건 = 포지션 0→0(업계 관행). 복기 키는 거래 id(`instId|side#여는 billId`)라 여는 Bill이 데이터에서 빠지면 연결이 끊김

## 기기 간 복기 동기화 — Google Drive (2026-11-01)
- 한 일: core/drive.js(appDataFolder 조회·업로드·병합, 거래별 updatedAt 최신 우선)+테스트, ui/cloud.js(외부 스크립트 없는 OAuth 리다이렉트 로그인, 시작·화면 복귀·1분마다·저장 3초 뒤 동기화, 이미지는 별도 파일+IndexedDB 캐시), 설정 탭 연결 섹션·준비 안내, 복기 페이지 상태 표시. 가짜 Drive로 두 기기 E2E 확인(A→B 전략·이미지, B→A 심리)
- 남은 일: 사용자가 Google Cloud에서 OAuth 클라이언트 ID 발급(원본·리디렉션 URI = 배포 주소) → config.js 또는 설정 탭에 입력 → 실제 기기에서 확인
- 주의: 토큰 1시간 만료 → "다시 연결"(변경분은 남았다가 연결 후 올라감). "이 기기에 기억"을 끄면 로그인 리다이렉트 후 OKX 데이터는 다시 동기화해야 함. 복기 삭제(거래 단위)는 아직 없음

## 드라이브 폴더 변경 + 거래 데이터 동기화 (2026-11-01)
- 한 일: 저장 위치를 숨김 폴더 → 내 드라이브 "OKX Journal"(reviews.json, okx-data.json, 이미지/)로 변경(drive.file, appProperties 표식으로 찾음), 예전 appDataFolder 복기·이미지는 첫 동기화 때 자동 이전. OKX·CSV 거래 데이터도 기본키 누적 병합(mergeRaw/mergeData)으로 드라이브 동기화, API 동기화는 교체 → 누적(3개월 지난 기록 보존). 가짜 Drive E2E: 이전·CSV 없는 기기 B에 거래 38건·복기 표시·역방향 반영 확인
- 남은 일: OAuth 동의 화면에 drive.file 범위 추가 후 실제 계정으로 확인. "불러온 데이터 비우기"는 이 기기만 비움(드라이브와 다시 합쳐짐)
- 주의: 예전 숨김 폴더 데이터는 지우지 않음(드라이브 설정 > 앱 관리에서 삭제 가능). okx-data.json은 거래가 많으면 수 MB

## 드라이브 권한 범위 오류 수정 (2026-11-01)
- 한 일: 요청 범위를 drive.file 하나로 줄이고(drive.appdata는 이미 허용된 경우에만 예전 데이터 이전), 로그인 때 받은 scope를 저장해 drive.file이 없으면 API를 부르지 않고 "다시 연결 필요" 안내. 403 범위 부족도 같은 안내로 처리
- 남은 일: 사용자 기기에서 연결 해제 → 다시 연결 후 OKX Journal 폴더 생성 확인
- 주의: 이 변경 전에 받은 토큰은 scope 기록이 없어 한 번 다시 연결해야 함

## 모의 매매 직접 입력 (2026-11-01)
- 한 일: 세션 상세 목록 "+ 모의 매매" → 복기 페이지에서 종목·SIDE·매매/청산일(KST)·수량·진입/청산가·순손익·통화·레버리지를 직접 입력(core/review.js newMock·mockTrade·mockTrades). 복기 저장소에 mock: 키로 저장해 드라이브로 기기 간 동기화, 삭제는 삭제 표시(tombstone)로 다른 기기에서도 사라짐. 표 "모의" 열·구분 필터(전체/실거래/모의), 차트 진입·청산 마커. 대시보드·통계(S.result)에는 넣지 않음
- 남은 일: 실기기 확인. 모의 매매만 모아 보는 통계가 필요하면 별도 요청
- 주의: 값은 계산으로 채우지 않음(순손익도 직접 입력). 예시 데이터 켠 동안 만든 모의 매매는 저장되지 않음

<!-- 단계가 끝날 때마다 아래 형식으로 3줄 추가 -->
<!--
## N단계 (YYYY-MM-DD)
- 한 일:
- 남은 일:
- 주의:
-->
