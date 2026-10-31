# 데이터 규칙

## 상품군 (FUTURES·SPOT·MARGIN)
| 상품군 | 성격 | 거래 단위(라운드트립) | 비용 |
|---|---|---|---|
| FUTURES | 만기 선물, 포지션 있음 | 포지션 잔량 0→0 | 수수료, 만기 정산(DELIVERY) |
| MARGIN | 마진(차입) 거래, 포지션 있음 | 포지션 잔량 0→0 | 수수료, 대출 이자(INTEREST) |
| SPOT | 현물, 포지션 없음 | 코인 보유 0→0 (평균단가법) | 수수료(코인 또는 견적통화) |

SWAP(무기한)은 범위 밖이다. FUNDING 분류는 남겨 두되, 상품군 목록에 SWAP을 추가하기 전까지는 쓰이지 않는다.

## 입력 출처 3가지 (병합 우선순위: API > 아카이브 > CSV)
| 출처 | 기간 | 방식 |
|---|---|---|
| API (읽기 키) | 최근 약 3개월 | 브라우저에서 직접 호출(CORS 확인됨) |
| 원장 아카이브 | 2021년부터, 연·분기 단위 | API로 신청 → 파일 링크 → 다운로드 → 업로드(종류 E) |
| CSV 다운로드 | 2021-01-28부터 | OKX 주문 센터 → 다운로드. 1행 메타, 2행 헤더 |

## 출처별 필드 대응 (공통 레코드)
열 단위 대응은 `docs/CSV.md`, API 필드는 `docs/OKX_API.md`에 있다. 아래는 요약이다.

| 공통 레코드 | CSV | API | 기본키 | 쓰는 곳 |
|---|---|---|---|---|
| Order | A. Order History | `trade/orders-history` / `-archive` | 주문 ID | 주문 통계 |
| Fill | B. Trade Details | `trade/fills` / `fills-history` | 체결 ID | 체결·VWAP·maker/taker, **SPOT 손익** |
| Bill | C. Trading History, E. 아카이브 | `account/bills` / `bills-archive` | 원장 ID | **FUTURES·MARGIN 손익·수수료·이자**, 포지션 변화, 잔고 |
| Position | D. Position Snapshot | `account/positions` | 포지션 ID | 미청산 노출(FUTURES·MARGIN) |
| PositionHistory | (없음) | `account/positions-history` | 포지션 ID + 청산시각 | 복원 검증 |
| Balance | (없음) | `account/balance` | 통화 | SPOT 보유 현황 |

- CSV 판별 열: A=`Order Type`·`Status`·`Bot ID`, B=`Trade ID`·`taker/maker`, C=`Position Balance`·`Balance Change`, D=`Position ID`·`Mark Price`, E=3단계에서 확정.
- CSV 시간대: C·D는 UTC+8, A·B는 **미확인**(메타 행 확인). API는 UTC 밀리초다.
- CSV 메타 행에는 UID가 있으므로 화면에 노출하지 않고 커밋하지 않는다.

## 병합 규칙
1. 레코드 종류마다 출처별 덮는 기간 `[최소 ts, 최대 ts]`를 구한다.
2. 우선순위가 낮은 출처의 레코드 중 상위 출처의 기간 안에 드는 것은 버린다(API > 아카이브 > CSV).
3. ID 체계가 같다고 확인되면, 겹치는 구간을 ID로 대조해 누락·불일치를 데이터 점검 탭에 보고한다.
4. 같은 출처 안의 중복은 기본키로 제거한다.

## 지표별 정본 (중복 합산 금지)
| 지표 | 정본 | 검증용 |
|---|---|---|
| FUTURES·MARGIN 실현손익·수수료·이자 | Bill | Order PNL·Fee, Fill Fee, PositionHistory |
| SPOT 실현손익·수수료 | Fill (평균단가법) | Bill 잔고 변화 |
| 포지션 변화, 라운드트립 | Bill(변화량·잔량) / SPOT은 Fill | PositionHistory, Position |
| 체결 가격·수량·maker/taker | Fill | Order 평균가 |
| 주문 수·상태·체결률 | Order | — |
| 미청산 노출·레버리지·미실현 | Position (+ctVal), SPOT은 Balance | — |
| 잔고 변화 | Bill | 잔고 변화 ≠ 손익(이체·이자 포함) |

## 회계 규칙
1. 주문을 체결로 세지 않는다. 취소 주문은 거래가 아니며, 부분체결을 반영한다.
2. 손익과 수수료는 출처나 데이터셋을 넘어 중복 합산하지 않는다.
3. 잔고 이동과 거래 손익을 구분한다. 모든 Bill이 체결은 아니므로 분류한 뒤 집계한다.
4. 노출액에는 계약가치·배수를 반영하고, 수량 단위를 확인한 뒤 계산한다.
5. 실현손익과 미실현손익을 구분한다.
6. 복원 결과는 PositionHistory·Position과 대조하고, 차이를 숨기지 않는다.
7. SPOT에서 취득가를 모르는 매도는 손익을 계산하지 않고 사유를 표시한다.
8. 통화가 다른 금액은 그냥 더하지 않는다. 코인 마진 선물은 손익이 코인 단위다. 통화별 합계를 기본으로 하고, USD 합계에는 환산 기준을 표시한다.
9. API의 `fee`는 음수가 수수료, 양수가 리베이트다. CSV의 부호는 2단계에서 확인한다.
10. 없는 기록이나 숫자를 지어내지 않는다. 예시 데이터는 항상 배지로 구분한다.

## 원래 분석 요구사항 → 화면 대응
| 요구 산출물 | 위치 |
|---|---|
| 요약, 계정 개요 | `#/dashboard` |
| 주문·체결 통계 | `#/orders` |
| 거래 타임라인, 포지션 복원 | `#/trades` 상세 |
| 실현손익·수수료 | `#/dashboard`, `#/trades` |
| 미청산 포지션, 리스크·레버리지 | `#/positions` |
| 매매 습관, 실수·개선점 | `#/journal` (노션 연동 후) |

## 확인 결과 (2·3단계에서 채운다. 이후 세션은 다시 조사하지 않는다)
| 항목 | 결과 | 근거 |
|---|---|---|
| **posBal(CSV Position Balance)의 의미: 수량인가, 증거금 잔고인가** | | inspect(누적 수량과 비교) |
| 실제 사용 중인 type/subType과 설명(API), Trade Type/Action 값(CSV) | | inspect, `docs/subtypes.json` |
| MARGIN 이자, FUTURES 만기 정산, 강제청산의 subType | | inspect |
| 포지션 모드(롱·숏 분리 / 단방향) | | inspect(posSide 값) |
| SPOT 수수료 통화(기초코인/견적통화), CSV 수수료 부호 | | inspect |
| 코인 마진(inverse) 선물 사용 여부 | | inspect(ctType, ccy) |
| CSV ID와 API ID가 같은 체계인지 | | 겹치는 기간 비교 |
| CSV A·B 시간대, CSV 수량 단위 | | 메타 행, inspect |
| CSV Instrument/Symbol 표기 → instId 대응 | | inspect |
| 아카이브 압축 형식(zip 등), 메타 행 유무 | | 3단계 |
