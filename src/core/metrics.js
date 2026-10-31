const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;
const dayKey = (ts) => new Date(Math.floor((ts + KST_MS) / DAY_MS) * DAY_MS).toISOString().slice(0, 10); // 청산일 KST

const m = (value, source, note = null) => ({ value, source, note });
const none = (note, source = null) => m(null, source, note);

/**
 * 라운드트립(4·5단계 trades) → 지표. 모든 지표는 {value, source, note}.
 * 금액은 통화별로 낸다. 승/패는 통화가 하나인 청산 거래만(net>0 승, net<0 패, 0은 무승부) 판정한다.
 * @param {any[]} trades buildPositions().trades + buildSpot().trades
 * @param {{
 *   filter?: 'ALL'|'FUTURES'|'SPOT'|'MARGIN',
 *   usdRate?: (ccy:string, ts:number, trade:any)=>({rate:number, basis:string}|null),
 *   notionalOf?: (trade:any)=>number|null,
 *   leverOf?: (trade:any)=>number|null,
 * }} [opts]
 *   usdRate: 주입받는 환산(CSV C *-USD → fillIdxPx → 캔들 종가 순). 없으면 USD 합계는 null.
 *   notionalOf: 최대 노출(USD) 계산용. 없으면 null. leverOf 기본은 trade.lever.
 */
export function buildMetrics(trades, opts = {}) {
  const filter = opts.filter ?? 'ALL';
  const all = trades.filter((t) => filter === 'ALL' || t.instType === filter);
  const closed = all.filter((t) => t.status === 'CLOSED' && t.closeTs != null);
  const open = all.filter((t) => t.status !== 'CLOSED');
  const src = `${filter} 라운드트립 ${closed.length}건(청산)`;
  const sortedClosed = [...closed].sort((a, b) => a.closeTs - b.closeTs);

  // 통화별 합계 (청산 거래만; 미청산은 별도 개수)
  const byCcy = {};
  for (const t of closed) {
    for (const [c, a] of Object.entries(t.amounts)) {
      const s = (byCcy[c] ??= { pnl: 0, fee: 0, interest: 0, funding: 0, net: 0 });
      s.pnl += a.pnl; s.fee += a.fee; s.interest += a.interest; s.funding += a.funding; s.net += a.net;
    }
  }

  // 승/패: 통화 하나인 거래
  const stat = {}; // ccy → {wins,losses,flat,winSum,lossSum}
  let mixed = 0;
  for (const t of closed) {
    if (t.ccy == null || t.net == null) { mixed++; continue; }
    const s = (stat[t.ccy] ??= { wins: 0, losses: 0, flat: 0, winSum: 0, lossSum: 0 });
    if (t.net > 0) { s.wins++; s.winSum += t.net; } else if (t.net < 0) { s.losses++; s.lossSum += t.net; } else s.flat++;
  }
  const winLoss = {};
  let wins = 0, decided = 0, judged = 0;
  for (const [c, s] of Object.entries(stat)) {
    const d = s.wins + s.losses;
    wins += s.wins; decided += d; judged += d + s.flat;
    winLoss[c] = {
      wins: s.wins, losses: s.losses, flat: s.flat,
      winRate: d + s.flat ? s.wins / (d + s.flat) : null,
      avgWin: s.wins ? s.winSum / s.wins : null,
      avgLoss: s.losses ? s.lossSum / s.losses : null,
      payoff: s.wins && s.losses ? (s.winSum / s.wins) / Math.abs(s.lossSum / s.losses) : null, // 손익비=평균이익/평균손실(절댓값)
    };
  }
  const mixedNote = mixed ? `통화 여럿인 거래 ${mixed}건은 승/패에서 제외` : null;

  // 일별 순손익·누적·MDD (통화별, 청산일 KST)
  const daily = {}; // ccy → {day: net}
  for (const t of sortedClosed) {
    const day = dayKey(t.closeTs);
    for (const [c, a] of Object.entries(t.amounts)) {
      const d = (daily[c] ??= {});
      d[day] = (d[day] ?? 0) + a.net;
    }
  }
  const equity = {}; // ccy → [{day, net, cum}]
  const mdd = {};
  for (const [c, d] of Object.entries(daily)) {
    let cum = 0, peak = 0, dd = 0;
    equity[c] = Object.keys(d).sort().map((day) => {
      cum += d[day];
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
      return { day, net: d[day], cum };
    });
    mdd[c] = dd; // 누적 순손익 기준 고점 대비 최대 하락(0에서 시작)
  }

  // 보유시간
  const holds = closed.filter((t) => t.openTs != null).map((t) => t.closeTs - t.openTs);

  // 롱/숏
  const side = { long: 0, short: 0 };
  for (const t of closed) if (t.side in side) side[t.side]++;

  // 레버리지 분포 (FUTURES·MARGIN)
  const leverOf = opts.leverOf ?? ((t) => t.lever ?? null);
  const levTrades = closed.filter((t) => t.instType === 'FUTURES' || t.instType === 'MARGIN');
  const lev = {};
  let levMissing = 0;
  for (const t of levTrades) {
    const l = leverOf(t);
    if (l == null) levMissing++; else lev[l] = (lev[l] ?? 0) + 1;
  }

  // USD 합계
  let usd;
  if (!opts.usdRate) usd = none('환산 기준(usdRate) 없음: USD 합계를 계산하지 않음');
  else {
    let sum = 0;
    const bases = new Set();
    const missing = new Set();
    for (const t of closed) {
      for (const [c, a] of Object.entries(t.amounts)) {
        const r = opts.usdRate(c, t.closeTs, t);
        if (!r) { missing.add(c); continue; }
        sum += a.net * r.rate; bases.add(r.basis);
      }
    }
    usd = missing.size ? none(`환산 불가 통화: ${[...missing].join(',')}`) : m(sum, [...bases].join(' + ') || null, `환산 기준: ${[...bases].join(', ') || '-'}`);
  }

  // 일 평균 거래 빈도 (첫~마지막 청산일 달력일 수 기준)
  let freq = none('청산 거래 없음');
  if (sortedClosed.length) {
    const days = Math.round((Date.parse(dayKey(sortedClosed.at(-1).closeTs)) - Date.parse(dayKey(sortedClosed[0].closeTs))) / DAY_MS) + 1;
    freq = m(closed.length / days, src, `${days}일(첫~마지막 청산일, KST) 달력일 기준`);
  }

  // 최대 노출
  let exposure = none('notionalOf 없음: 노출액(계약가치·배수 반영)을 계산하지 않음');
  if (opts.notionalOf) {
    const ev = [];
    let miss = 0;
    for (const t of all) {
      const n = opts.notionalOf(t);
      if (n == null || t.openTs == null) { miss++; continue; }
      ev.push([t.openTs, n]);
      if (t.closeTs != null) ev.push([t.closeTs, -n]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // 같은 시각이면 청산 먼저
    let cur = 0, max = 0;
    for (const [, d] of ev) { cur += d; if (cur > max) max = cur; }
    exposure = m(ev.length ? max : null, src, miss ? `노출액 미상 ${miss}건 제외` : '동시 보유 노출 합의 최댓값');
  }

  return {
    filter,
    count: m(closed.length, src, open.length ? `미청산 ${open.length}건 제외` : null),
    winLoss: m(winLoss, src, mixedNote),
    winRate: judged ? m(wins / judged, src, [mixedNote, Object.keys(stat).length > 1 ? '통화가 섞인 비율(통화별은 winLoss 참고)' : null].filter(Boolean).join('; ') || null) : none('판정 가능한 거래 없음', src),
    totals: m(byCcy, src, '통화별 합계(pnl·fee·interest·funding·net)'),
    usdNet: usd,
    avgHoldMs: holds.length ? m(holds.reduce((a, b) => a + b, 0) / holds.length, src) : none('보유시간 계산 가능한 거래 없음'),
    sides: m(side, src),
    daily: m(equity, src, '청산일 KST 기준, 통화별 일별 순손익과 누적'),
    mdd: m(mdd, src, '누적 순손익 기준(0에서 시작한 고점 대비 하락). 잔고 기준 MDD 아님'),
    leverage: levTrades.length ? m(lev, src, levMissing ? `레버리지 미상 ${levMissing}건` : null) : none('FUTURES·MARGIN 거래 없음'),
    maxExposure: exposure,
    perDay: freq,
  };
}
