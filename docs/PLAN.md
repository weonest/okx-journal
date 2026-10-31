# 개발 계획

각 단계는 한 세션에서 끝낸다. 완료 기준을 만족하면 `PROGRESS.md`를 갱신하고 커밋한 뒤 `/clear` 한다.
`★`는 로직이 어려운 단계다. 이 단계만 계획 모드와 상위 모델을 허용한다.
상품군은 FUTURES, SPOT, MARGIN이다. SWAP(무기한)은 범위 밖이지만, 상품군 목록 상수 하나에 추가하면 동작하게 만든다.

---

## 0단계: 환경 준비 (사용자와 함께, 1회)
현재 설치된 도구는 `gh`뿐이다. git과 Node 22 이상이 필요하다.

| OS | 설치 |
|---|---|
| Windows | `winget install --id Git.Git -e` / `winget install --id OpenJS.NodeJS.LTS -e` |
| macOS | `xcode-select --install`(git 포함), Node는 nodejs.org의 LTS 설치 파일 |

키트를 설치한 폴더에서 아래를 실행한다.
```
git --version && node --version
gh auth status                       # 안 되어 있으면 gh auth login (github.com)
curl -o vendor/lightweight-charts.mjs --create-dirs https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.mjs
```
- `package.json`: `{"type":"module","private":true,"scripts":{"test":"node --test --test-reporter=dot"}}`
- `.gitignore`: `data/`, `.env*`, `*.csv`, `!tests/fixtures/*.csv`, `.DS_Store`
```
git init -b main && git add -A && git commit -m "chore: 초기 키트"
gh repo create okx-journal --public --source=. --remote=origin --push
```
- 사용자 안내: OKX → Profile → API에서 **Read 권한만** 체크한 키를 만든다. 키 값은 `.env.local`에만 적는다(2단계).
- **완료 기준:** 빈 `npm test`가 통과하고 원격 저장소에 push된다.

## 1단계: 공통 레코드 + CSV 어댑터 (`csv.js`, `normalize.js`)
- 먼저 읽을 것: `docs/CSV.md` 전체(열 목록, 공통 필드 대응, 판별 규칙).
- `normalize.js` 상단 JSDoc에 공통 레코드를 정의한다. 필드명은 `docs/CSV.md`와 `docs/OKX_API.md`의 공통 필드명을 쓴다.
  - 종류: `Order`, `Fill`, `Bill`, `Position`, `PositionHistory`, `Balance`
  - 공통 필드: `source`(`csv|archive|api`), `ts`(UTC ms), `instType`
- `parseCsv(text)`: RFC 4180을 따른다. 따옴표, `""` 이스케이프, CRLF, BOM 제거를 처리한다.
- `parseOkxFile(text)` → `{ meta, headers, rows }`. 1행은 메타, 2행은 헤더다.
- `detectKind(headers)`: A/B/C/D를 판별한다. E는 3단계에서 추가한다. 모르는 헤더면 에러를 낸다.
- `fromCsv(kind, rows)`: 숫자를 파싱하고(`""`·`--`는 `null`), 시간대를 변환하고, 기본키 중복을 제거한다(건수 반환).
- fixtures: 실제 파일의 `head -n 2`에 합성 행 3~6개를 붙인다. 실제 파일이 없으면 `docs/CSV.md`의 열 목록으로 헤더를 만든다. FUTURES·SPOT·MARGIN 행을 섞는다.
- **완료 기준:** 따옴표·BOM·메타 행·판별·중복·시간 변환 테스트가 통과한다.

## 2단계: OKX API 어댑터 (`src/core/okx/`, `merge.js`, `scripts/`)
- 먼저 읽을 것: `docs/OKX_API.md`의 "인증", "엔드포인트", "주요 응답 필드" 절. 웹 문서 확인은 필요 없다.
- `sign.js`: 서명 원문은 `ts + METHOD + path(쿼리 포함) + body`이고, HMAC-SHA256 결과를 Base64로 인코딩한다(Web Crypto). `ts`는 UTC ISO 형식이다.
  - 테스트는 Node `crypto.createHmac` 결과와 비교한다.
- `client.js`: `createClient({ key, secret, passphrase, fetch })`
  - 헤더 4개를 붙인다.
  - `public/time`으로 서버와의 시간차를 보정한다.
  - `paginate()`: 문서의 커서로 끝까지 반복한다. 요청 사이에 간격을 두고, 요청 제한 응답을 받으면 기다렸다 재시도한다.
- 조회 범위:
  - `instType`이 필수인 엔드포인트는 FUTURES, SPOT, MARGIN을 반복한다.
  - `bills`는 instType 없이 전체를 받는다(이체·이자도 필요). 상품군 필터는 앱에서 한다.
  - `positions`와 `positions-history`는 FUTURES, MARGIN만 조회한다.
  - SPOT 보유 현황은 `balance`로 받는다.
- `mapApi.js`: API JSON → 공통 레코드. fixture는 문서 예시 형태의 합성 JSON이다.
- `sync.js`: 최근 엔드포인트(3일/7일)와 3개월 archive 엔드포인트를 합친다. 마지막 동기화 시각 이후만 받는 증분 동기화를 한다.
- `merge.js`: 출처 우선순위로 병합한다(DATA.md "병합 규칙").
- `scripts/export.js`: 사용자가 `node --env-file=.env.local scripts/export.js`로 실행한다.
  - `.env.local`에는 `OKX_KEY`, `OKX_SECRET`, `OKX_PASSPHRASE`를 적는다.
  - 결과는 `data/okx-*.json`에 저장하고, 화면에는 종류별 건수만 출력한다.
  - 원장 유형표(`/account/subtypes`)도 `data/okx-subtypes.json`에 저장한다. 이 파일은 키 정보가 없으므로 `docs/subtypes.json`으로 복사해 커밋해도 된다.
- `scripts/inspect.js`: `data/`의 집계만 출력한다.
  - type/subType 고유값과 건수(설명 포함), 수수료 통화
  - 포지션 모드(posSide 값), 단위, id 형식
  - **posBal의 의미:** 상품별로 subType+sz 누적 수량과 posBal을 나란히 출력해, posBal이 수량인지 증거금 잔고인지 판단한다.
  - CSV 파일이 `data/`에 있으면, 겹치는 기간의 ID 일치율을 출력한다.
- 사용자가 export를 실행하면, 에이전트는 inspect 결과로 DATA.md "확인 결과"를 채운다.
- **완료 기준:** 서명·페이지네이션(가짜 fetch)·매핑·병합 테스트가 통과하고, 확인 결과가 기록된다.

## 3단계: 과거 원장 아카이브 (`src/core/okx/archive.js`)
3개월보다 오래된 원장을 API로 받는다. 연·분기 단위로 신청한 뒤, 생성된 파일을 내려받는 방식이다.
- 먼저 읽을 것: `docs/OKX_API.md` "원장 아카이브" 절, `docs/CSV.md` "E" 절.
- `archive.js`: `applyArchive({ year, quarter })`, `getArchive({ year, quarter })` → `{ state, fileHref }`
  - 신청은 **하루 12회 제한**이다. 자동으로 반복 신청하지 않고, 상태 확인(GET)만 반복한다.
- `scripts/export.js --archive 2025Q3`: 신청 → 긴 간격(30초 이상)으로 상태 확인 → 완료되면 압축 파일을 `data/`에 저장한다. 압축은 사용자가 직접 푼다.
- `csv.js`에 종류 **E(원장 아카이브)** 를 추가한다.
  - 메타 행이 없을 수 있다.
  - `type`은 `docs/subtypes.json`으로 subType에서 찾는다.
- 화면(8단계 설정 탭)에서의 흐름: 연·분기 선택 → 신청 → 상태 확인 → 완료 시 링크를 새 탭으로 연다(브라우저 다운로드) → 받은 파일을 업로드한다. 앱은 파일을 fetch하지 않는다.
- **완료 기준:** 서명된 POST/GET 테스트(가짜 fetch)와 E 파싱 테스트가 통과하고, 실제 1개 분기 파일의 헤더가 DATA.md에 기록된다.

## 4단계 ★: 원장 정리 + 포지션 복원 — FUTURES·MARGIN (`eventTypes.js`, `ledger.js`, `positions.js`)
- `eventTypes.js`: Bill type/subType(CSV는 Trade Type/Action) → `TRADE | INTEREST | DELIVERY | FUNDING | TRANSFER | LIQUIDATION | ADL | OTHER`
  - 2단계 관측값으로 채운다. 표에 없으면 UNKNOWN으로 둔다.
  - INTEREST는 마진 대출 이자, DELIVERY는 만기 선물 정산이다.
  - subType마다 수량 효과를 함께 정의한다: 롱 진입 +, 롱 청산 −, 숏 진입 +, 숏 청산 −, 단방향 모드의 매수 +, 매도 −. 강제청산·ADL·만기 정산은 청산(−)이다. 설명은 `docs/subtypes.json`을 따른다.
- `ledger.js`: 시간순으로 정렬한다.
  - 포지션 키별로 `sz × 수량 효과`를 누적해 잔량을 만들고, 직전 잔량(prev)과 비교해 효과를 판정한다.
    - `OPEN`: prev=0 → ≠0
    - `INCREASE`: |잔량| > |prev|
    - `REDUCE`: |잔량| < |prev|, 잔량 ≠ 0
    - `CLOSE`: 잔량=0
    - `FLIP`: 부호 반전
  - `posBal`(CSV는 Position Balance)은 2단계에서 수량으로 확인된 경우에만 교차검증용으로 쓴다.
  - 잔고를 대사한다(같은 통화의 직전 `bal` + `balChg` = `bal`, 허용오차 1e-8).
- `positions.js`: 포지션 키(instId, 롱/숏 분리 모드면 instId|side)별로 0 → … → 0 구간을 **라운드트립(=1거래)** 으로 묶는다.
  - 필드: id, instType, side, openTs, closeTs, maxSize, pnl, fee, interest, funding, net, billIds.
  - 구간 안의 같은 상품 INTEREST·FUNDING을 그 거래에 귀속시킨다. DELIVERY는 청산으로 처리한다.
  - FLIP은 닫힘과 새 오픈으로 나눈다. 끝까지 닫히지 않은 구간은 `OPEN`으로 둔다.
  - 금액에는 통화(`ccy`)를 붙인다. 코인 마진(inverse) 선물은 손익이 코인 단위다.
  - 검증 1: `positions-history`와 거래 단위로 비교한다. FUTURES는 `realizedPnl`, MARGIN은 pnl·fee를 비교하고 차이 목록을 만든다.
  - 검증 2: 최종 수량을 Position과 대조한다.
- **완료 기준:** 오픈→증가→감소→청산, 플립, 이자 귀속, 만기 정산, 미청산, 잔고 불일치, positions-history 차이, 코인 단위 손익 테스트가 통과한다.

## 5단계: 현물 손익 — SPOT (`spot.js`)
현물에는 포지션이 없으므로 Fill로 코인별 보유수량과 평균단가를 추적한다(평균단가법).
- 매수: 보유수량에 순수량을 더한다(수수료를 코인으로 냈으면 차감). 원가에 체결금액을 더한다(견적통화 수수료 포함).
- 매도: 실현손익 = (체결가 − 평균단가) × 수량 − 수수료.
- 보유가 먼지 기준(기본값: 상품 정보의 `minSz`) 미만으로 떨어지면 0으로 보고 라운드트립을 닫는다. 라운드트립 형태는 4단계와 같게 맞춘다.
- 수수료 처리는 `feeCcy`로 판단한다. 기초코인이면 수량을 조정하고, 견적통화면 원가·손익을 조정한다.
- 취득가를 모르는 경우(데이터 기간 전부터 보유, 입금받은 코인): 해당 매도 손익은 `null`과 사유를 반환하고, 데이터 점검 탭에 표시한다.
- 수수료가 견적통화가 아닌 제3의 코인이면 환산하지 않고 note에 남긴다.
- 검증 1: SPOT Bill의 잔고 변화와 Fill 합계를 대사한다.
- 검증 2: API `balance`의 `openAvgPx`(OKX가 계산한 현물 평균단가)와 우리 평균단가를 비교한다.
- **완료 기준:** 분할 매수→일부 매도→전량 매도, 코인 수수료, 취득가 미상, 먼지 처리 테스트가 통과한다.

## 6단계: 주문·체결 통계 (`orders.js`)
- Order와 Fill을 주문 ID로 조인한다. 체결수량 합, VWAP, 체결 수수료 합, maker/taker 건수를 구한다. Order 값과 다르면 불일치 목록에 넣는다.
- 상품군별로 상태·유형 건수, 체결률, 취소율, 부분체결, 시장가/지정가 비율을 구한다.
- Order·Fill → Bill 매칭률만 보고한다. **손익·수수료는 합산하지 않는다.**
- **완료 기준:** 1주문 다체결, 부분체결, 취소 주문 테스트가 통과한다.

## 7단계: 지표 (`metrics.js`)
- 입력은 4·5단계 라운드트립이다. 상품군 필터(전체/FUTURES/SPOT/MARGIN)를 지원한다.
- 지표:
  - 거래 수, 승/패(net>0), 승률, 평균 이익/손실, 손익비
  - 순손익, 수수료, 이자, 펀딩, 평균 보유시간, 롱/숏 분포
- 금액 합계는 통화별로 낸다. USD 합계는 다음 순서의 환산값을 쓰고, 어느 기준을 썼는지 note에 남긴다.
  1. CSV C의 `*-USD` 열
  2. 아카이브의 `fillIdxPx`
  3. 청산 시점 캔들 종가
- 일별 순손익(청산일 KST)과 누적 곡선을 구한다. MDD는 누적 순손익 기준이며, 잔고 기준 MDD는 따로 라벨을 붙인다.
- 레버리지 분포(MARGIN·FUTURES), 최대 노출, 일 평균 거래 빈도를 구한다.
- **완료 기준:** 손으로 계산한 기대값과 일치하는 테스트가 통과한다.

## 8단계: 화면 1 — 설정·동기화·업로드·데이터 점검·대시보드
- `#/settings`:
  - 키 입력과 "이 기기에 기억"
  - 동기화 버튼(진행률), 마지막 동기화 시각, 키 지우기
  - 아카이브 신청·상태·링크 열기(3단계 흐름)
- 업로드: CSV(A~E) 여러 개를 선택하거나 끌어다 놓는다. "예시 데이터 보기"는 fixtures를 쓴다.
- `#/data`:
  - 출처별 기간·건수, 병합 결과
  - 중복, 미분류 이벤트, 잔고 불일치, 매칭률
  - positions-history 차이, 취득가 미상, 미확인 가정
- `#/dashboard`:
  - KPI 카드
  - 누적 순손익 라인, 일별 손익 막대
  - 월 캘린더(KST)
  - 상품군·종목·롱/숏 표
- 로컬 확인: `npx --yes http-server -c-1 -p 8080`. 사용자가 브라우저로 확인한다.
- **완료 기준:** 예시 데이터로 모든 탭이 렌더된다. 실제 키로 동기화한 건수가 export 결과와 일치한다.

## 9단계: 화면 2 — 거래 상세·포지션·주문
- `#/trades`: 라운드트립 목록(정렬, 상품군·종목·방향 필터).
  - 상세 화면: 이벤트 타임라인, 연결된 체결
  - 상세 화면의 캔들 차트: 진입·청산 마커 표시. 데이터는 공개 API `market/candles`로 가져온다(키 불필요).
- `#/positions`:
  - FUTURES·MARGIN 실시간 포지션(없으면 CSV 스냅샷)과 SPOT 보유(`balance`)
  - 노출액, 미실현(OKX 제공값 우선, 없으면 **추정**), 레버리지, 증거금
  - ctVal은 공개 API `public/instruments`로 가져온다.
- `#/orders`: 6단계 통계.
- **완료 기준:** 상세 화면과 캔들이 표시된다.

## 10단계: 배포
```
gh api -X POST repos/{owner}/okx-journal/pages -f "source[branch]=main" -f "source[path]=/"
gh api repos/{owner}/okx-journal/pages --jq .html_url
```
- 사이트는 공개되지만 데이터와 키는 각 기기 브라우저에만 저장된다.
- **완료 기준:** 배포 URL에서 예시 데이터와 동기화가 동작한다.

## 11단계 (선택): 노션 매매일지 연동
- 사용자 준비:
  - **개인** 노션에 DB를 만든다. 속성: 날짜, 종목, 방향, 전략(multi), 실수(multi), 등급, 연결ID(text).
  - 통합은 **읽기 권한만** 주고, 이 DB에만 연결한다.
- 토큰과 DB 링크는 설정 탭에서 입력받는다. 저장 규칙은 API 키와 같다.
- 이 단계에서만 Notion API 최신 버전과 DB 조회 엔드포인트를 공식 문서에서 1회 확인한다.
- 연결 규칙:
  - 연결ID가 라운드트립 id와 같으면 연결한다.
  - 연결ID가 없으면 같은 종목이면서 보유 구간 안의 날짜인 거래에 연결한다.
- 본문 블록은 거래 상세를 열 때만 불러온다.
- `metrics.js`에 전략별·실수별 손익·승률 집계를 추가한다.
- **완료 기준:** 노션 일지가 거래 상세와 `#/journal`에 보이고, 전략·실수 집계가 표시된다.

## 범위 밖
SWAP·OPTION, 기기 간 CSV 동기화, AI 분석, 로그인, 서버, 다국어.
