# OKX CSV 양식

OKX 주문 센터에서 내려받는 CSV다. **1행은 계정 메타**(거래소·UID·기간·시간대), **2행은 헤더**, 3행부터 데이터다.
아래 열 목록은 사용자가 받은 파일 기준이다. 실제 파일이 있으면 `head -n 2`로 대조하고, 다르면 실제 파일을 따른다.
열 의미 중 **(확인)** 표시는 이름만 보고 추정한 것이다. 2단계에서 API 데이터와 겹치는 기간을 비교해 확정한다.

## A. Order History (주문) → `Order`
| CSV 열 | 공통 필드 | 비고 |
|---|---|---|
| Order ID | ordId | 기본키 |
| Order Time | ts | 시간대 **(확인)** |
| Instrument | instType? | 상품군 표기인지 **(확인)** |
| Symbol | instId | 표기 → instId 변환 **(확인)** |
| Lvg | lever | |
| Side | side (+posSide) | "Open long" 같은 값이면 분리 **(확인)** |
| Order Type | ordType | market / limit 등 |
| Order Amount | sz | 단위는 Amount Unit 열 |
| Filled Amount | accFillSz | |
| Amount Unit | szUnit | 계약 수 / 코인 |
| Order Price | px | |
| Avg. Filled Price | avgPx | |
| Price Unit | — | |
| PNL | pnl | 검증용, 합산 금지 |
| Fee | fee | 검증용, 부호 **(확인)** |
| Fee Unit | feeCcy | |
| Status | state | 취소 판정 |
| Bot ID | botId | 봇 주문 구분 |

## B. Trade Details (체결) → `Fill`
| CSV 열 | 공통 필드 | 비고 |
|---|---|---|
| Order ID | ordId | Order와 1:N |
| Trade ID | tradeId | 기본키 |
| Trade Time | ts | 시간대 **(확인)** |
| Instrument | instType? | **(확인)** |
| Symbol | instId | **(확인)** |
| Filled Amount | fillSz | |
| Filled Amount Unit | szUnit | |
| Filled Price | fillPx | |
| Fill Price Unit | — | |
| Trading Volume | notional | 체결금액 |
| Trading Volume Unit | notionalCcy | |
| taker/maker | execType | T / M |
| Fee | fee | SPOT 손익 계산에 사용, 부호 **(확인)** |
| Fee Unit | feeCcy | 코인 / 견적통화 |

CSV B에는 **매수·매도 방향 열이 없다.** 방향은 같은 Order ID의 A.Side에서 가져온다(Order와 조인 필수).

## C. Trading History (계정 거래내역, UTC+8) → `Bill`
| CSV 열 | 공통 필드 | 비고 |
|---|---|---|
| id | billId | 기본키. API billId와 같은 체계인지 **(확인)** |
| Order id | ordId | 거래가 아닌 행은 비어 있을 수 있음 |
| Time | ts | UTC+8 |
| Trade Type | instType 또는 type | **(확인)** |
| Symbol | instId | |
| Action | subType 설명 | "Open long" 등. eventTypes 매핑 대상 |
| Amount | sz | |
| Trading Unit | szUnit | |
| Filled Price | px | |
| PnL | pnl | FUTURES·MARGIN 손익의 정본 |
| Fee | fee | 정본 |
| Fee Unit | feeCcy | |
| Position Change | posBalChg | 수량인지 증거금 잔고인지 **(확인)** |
| Position Balance | posBal | 위와 같음 **(확인)** |
| Balance Change | balChg | |
| Balance | bal | |
| Balance Unit | ccy | |
| Filled_price-USD / Pnl-USD / Fee-USD / Balance-USD / Balance_change-USD | `*Usd` | OKX가 붙인 USD 환산값. 통화가 다른 손익의 합계에 사용할 수 있음 |

## D. Position Snapshot (스냅샷, UTC+8) → `Position`
| CSV 열 | 공통 필드 |
|---|---|
| Position ID | posId (기본키) |
| Position Create Time / Position Update Time | cTime / uTime |
| Business Line | instType **(확인)** |
| Index | uly |
| Instrument Name | instId |
| Margin Mode | mgnMode |
| Direction | posSide / direction |
| Leverage | lever |
| Position size | pos (단위 **확인**) |
| Margin Amount / Margin Currency | margin / ccy |
| Assets amount / Liability amount / Asset currency / Liability currency | MARGIN 자산·부채 |
| Average Open Price / Mark Price | avgPx / markPx |
| Contract Face Value / Contract Face Value Currency / Contract Multiplier | ctVal / ctValCcy / ctMult |
| Snapshot time | snapshotTs |

## E. 원장 아카이브 (API로 받은 압축 파일 안의 CSV) → `Bill`
- 헤더가 API 필드명 그대로다: `instType billId subType ts balChg posBalChg bal posBal sz px ccy pnl fee mgnMode instId ordId execType interest …`
- **메타 행이 없을 수 있다.** 1행이 위 필드명이면 E로 판별한다.
- `ts`는 UTC ms다. `type` 열은 없다(`docs/OKX_API.md` 아카이브 절 참고).

## 판별 규칙 (`detectKind`)
| 종류 | 헤더에 있으면 |
|---|---|
| A | `Order Type` 그리고 `Status` |
| B | `Trade ID` 그리고 `taker/maker` |
| C | `Position Balance` 그리고 `Balance Change` |
| D | `Position ID` 그리고 `Mark Price` |
| E | `billId` 그리고 `balChg` (1행 또는 2행) |
