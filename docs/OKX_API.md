# OKX API 요약 (2026-10-31 공식 문서 확인)

출처: https://www.okx.com/docs-v5/en/ . 이 파일로 구현하고, 막힐 때만 원문을 해당 절만 확인한다.

## 인증
- 헤더 4개:
  - `OK-ACCESS-KEY`
  - `OK-ACCESS-SIGN`
  - `OK-ACCESS-TIMESTAMP`: UTC ISO 8601 밀리초, 예 `2020-12-08T09:08:57.715Z`
  - `OK-ACCESS-PASSPHRASE`
- 서명: `Base64(HMAC_SHA256(secret, ts + METHOD + requestPath + body))`
  - METHOD는 대문자다.
  - **GET은 쿼리스트링까지 requestPath에 포함하고**(`/api/v5/account/balance?ccy=BTC`), body는 빈 문자열이다.
  - POST는 body가 JSON 문자열이고, `Content-Type: application/json`을 보낸다.
- 서버 시간과 30초 넘게 차이 나면 거절된다(50102). 시작할 때 `GET /api/v5/public/time`(`data[0].ts`, ms)으로 시간차를 보정한다.
- 응답 형태는 `{ code: "0", msg: "", data: [...] }`이다. code가 "0"이 아니면 실패다. **숫자도 모두 문자열**이므로 파싱한다.
- 요청 제한에 걸리면 `50011`(HTTP 429 또는 200), 서버가 바쁘면 `50013`이 온다. 둘 다 기다렸다 재시도한다.

## 엔드포인트
| 용도 | 경로 | 기간 | 요청 제한 | instType | 페이지 커서 |
|---|---|---|---|---|---|
| 주문 | GET `/api/v5/trade/orders-history` | 7일 | 40회/2초 | **필수** | `after`·`before` = ordId |
| 주문 | GET `/api/v5/trade/orders-history-archive` | 3개월 | 20회/2초 | **필수** | ordId |
| 체결 | GET `/api/v5/trade/fills` | 3일 | 60회/2초 | 선택 | billId |
| 체결 | GET `/api/v5/trade/fills-history` | 3개월 | 10회/2초 | **필수** | billId |
| 원장 | GET `/api/v5/account/bills` | 7일 | 5회/1초 | 선택 | billId |
| 원장 | GET `/api/v5/account/bills-archive` | 3개월 | 5회/2초 | 선택 | billId |
| 원장 아카이브 신청 | POST `/api/v5/account/bills-history-archive` | 2021년~, 분기 | **12회/일** | — | — |
| 원장 아카이브 조회 | GET `/api/v5/account/bills-history-archive` | | 10회/2초 | — | — |
| 원장 유형표 | GET `/api/v5/account/subtypes` | | 20회/2초 | — | — |
| 포지션 | GET `/api/v5/account/positions` | 현재 | 10회/2초 | 선택(MARGIN/FUTURES) | 없음 |
| 포지션 이력 | GET `/api/v5/account/positions-history` | 3개월 | 10회/2초 | 선택 | `after`·`before` = uTime(ms) |
| 잔고 | GET `/api/v5/account/balance` | 현재 | 10회/2초 | — | — |
| 서버 시간 | GET `/api/v5/public/time` | | 10회/2초(IP) | — | — |
| 상품 정보 | GET `/api/v5/public/instruments` | | 20회/2초 | **필수** | — |
| 캔들(최근 1,440개) | GET `/api/v5/market/candles` | | 40회/2초(IP) | — | `after`·`before` = ts |
| 캔들(과거) | GET `/api/v5/market/history-candles` | | 20회/2초(IP) | — | ts |

- 공통 파라미터: `limit`(최대 100, 캔들은 300), `begin`·`end`(ms 필터, 주문·체결·원장).
- 페이지 넘기기:
  - 결과는 최신순이다.
  - 마지막 항목의 커서 값을 다음 `after`로 넣어 반복한다.
  - 빈 배열이 오면 끝이다. 받은 건수가 limit보다 적어도 끝이다.
- positions-history는 uTime이 같은 기록을 한 번에 모두 돌려준다(limit을 넘을 수 있다).
- 캔들 `bar`: `1m 5m 15m 1H 4H`는 UTC+8 기준 시가이고, 일봉은 `1Dutc`가 UTC 기준이다.

## 주요 응답 필드
**Order** (orders-history·archive): `ordId instType instId side posSide ordType sz px accFillSz avgPx state lever tdMode fee feeCcy pnl category cTime uTime tgtCcy`
- `state`는 `filled` / `canceled` / `mmp_canceled`다. 부분체결 후 취소된 주문은 `canceled`이면서 `accFillSz > 0`이다.
- `pnl`은 청산 주문의 손익이며 수수료를 뺀 값이 아니다. `category`는 normal / adl / full_liquidation / partial_liquidation / delivery 등이다.

**Fill** (fills·history): `tradeId ordId billId instType instId side posSide fillPx fillSz fillPnl execType fee feeCcy ts fillTime subType`
- `execType`: T=taker, M=maker.
- `posSide`: long / short(롱·숏 분리 모드), net(단방향 모드).
- `subType`: 1 매수, 2 매도, 3 롱 진입, 4 숏 진입, 5 롱 청산, 6 숏 청산, 100번대는 강제청산 계열.
- `fee`: **음수는 수수료, 양수는 리베이트**다. 통화는 `feeCcy`다.

**Bill** (bills·archive): `billId type subType ts instType instId ccy balChg bal posBalChg posBal sz px pnl fee interest mgnMode ordId tradeId execType fillTime notes`
- `sz`: FUTURES는 계약 수(항상 양수), 그 외는 잔고 통화 단위다.
- `px`: 거래 계열 subType(1~6 등)의 체결가다.
- `mgnMode`: isolated / cross / cash(현물). 거래가 아닌 원장은 `""`이다.
- `ordId`: type 2/5/9일 때만 값이 있다.
- **`posBal`·`posBalChg`는 문서상 "포지션 단위 잔고(balance)"다. 포지션 수량이라는 보장이 없다.** 2단계 inspect에서 의미를 확인하기 전까지 수량으로 쓰지 않는다.
- type·subType의 뜻은 `/account/subtypes`로 받는다(응답: `type typeDesc subTypeDetails[{subType subTypeDesc}]`).

**Position** (positions): `posId instType instId mgnMode posSide pos avgPx markPx upl lever liqPx margin mgnRatio interest notionalUsd ccy realizedPnl fee cTime uTime`
- `pos`: FUTURES는 계약 수, MARGIN은 기초자산 수량이다. 단방향 모드에서 양수는 롱, 음수는 숏이다.

**PositionHistory**: `posId instType instId mgnMode posSide direction type openAvgPx closeAvgPx openMaxPos closeTotalPos pnl fee fundingFee liqPenalty realizedPnl settledPnl lever ccy cTime uTime`
- `realizedPnl = pnl + fee + fundingFee + liqPenalty + settledPnl` (FUTURES 기준. MARGIN은 pnl·fee만 비교한다).
- `type`: 1 일부 청산, 2 전량 청산, 3 강제청산, 4 일부 강제청산, 5 ADL.

**Balance** (`data[0].details[]`): `ccy eq cashBal availBal frozenBal liab interest eqUsd spotBal openAvgPx accAvgPx spotUpl totalPnl`
- `openAvgPx`(현물 평균단가, USD)와 `spotUpl`은 SPOT 평균단가 계산을 **검증**하는 데 쓴다.

**Instrument**: `instId baseCcy quoteCcy settleCcy ctVal ctMult ctValCcy ctType lotSz minSz tickSz expTime state`
- `ctType`: linear(USDT 등 견적통화로 손익) / inverse(코인으로 손익).
- 노출액: linear는 `|pos| × ctVal × ctMult × 가격`, inverse는 `|pos| × ctVal × ctMult`(USD)다.
- SPOT의 먼지 기준으로 `minSz`를 쓸 수 있다.

## 원장 아카이브 (3단계)
- 신청: POST body `{"year":"2025","quarter":"Q3"}`(`type` 생략 시 전체) → `data[0].result`
  - `"true"`: 이미 파일이 있다.
  - `"false"`: 생성 중이다.
- 조회: GET `?year=2025&quarter=Q3` → `data[0] { fileHref, state, ts }`
  - `state`는 `finished` / `ongoing` / `failed`(다시 신청)다.
- 링크 유효시간은 5.5시간이다. 같은 분기는 30일 안에 다시 신청하지 않아도 된다. **신청은 하루 12회 제한**이므로 자동 반복 신청은 금지한다.
- 파일은 **압축 파일**이고, 압축을 풀면 CSV다. 열: `instType billId subType ts balChg posBalChg bal posBal sz px ccy pnl fee mgnMode instId ordId execType interest tag fillTime tradeId clOrdId fillIdxPx fillMarkPx …`
  - **`type` 열이 없다.** `/account/subtypes` 표로 subType에서 type을 찾는다.
  - `fillIdxPx`(체결 시점 지수가격)는 코인 단위 손익을 USD로 환산할 때 쓸 수 있다.
