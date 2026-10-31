// 원장 아카이브: 신청(POST, 하루 12회 제한)과 상태 조회(GET). 자동 반복 신청은 하지 않는다.
const PATH = '/api/v5/account/bills-history-archive';

function check({ year, quarter }) {
  const y = String(year), q = String(quarter).toUpperCase();
  if (!/^20\d\d$/.test(y) || !/^Q[1-4]$/.test(q)) throw new Error('year(2021~)·quarter(Q1~Q4) 형식 오류');
  return { year: y, quarter: q };
}

/** @returns {Promise<{ready:boolean}>} ready=true면 이미 파일이 있다 */
export async function applyArchive(c, o) {
  const data = await c.post(PATH, check(o));
  return { ready: String(data?.[0]?.result) === 'true' };
}

/** @returns {Promise<{state:string|null, fileHref:string|null, ts:number|null}>} state: finished|ongoing|failed */
export async function getArchive(c, o) {
  const d = (await c.get(PATH, check(o)))?.[0];
  if (!d) return { state: null, fileHref: null, ts: null };
  return { state: d.state ?? null, fileHref: d.fileHref || null, ts: d.ts ? Number(d.ts) : null };
}

/** 상태 확인만 반복한다(신청 아님). intervalMs 기본 30초. */
export async function waitArchive(c, o, { intervalMs = 30000, maxTries = 120, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onTick } = {}) {
  for (let i = 0; i < maxTries; i++) {
    const r = await getArchive(c, o);
    onTick?.(r.state);
    if (r.state === 'finished' || r.state === 'failed') return r;
    await sleep(intervalMs);
  }
  throw new Error('아카이브 대기 시간 초과');
}
