// 사용자 실행: node --env-file=.env.local scripts/export.js [--since=<ms>]
// 아카이브: ... --archive=2025Q3  (신청 1회 → 30초 간격 상태 확인 → data/archive-2025Q3.zip 저장, 압축은 직접 해제)
// 결과는 data/okx-*.json에 저장하고, 화면에는 종류별 건수만 출력한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '../src/core/okx/client.js';
import { syncAll } from '../src/core/okx/sync.js';
import { applyArchive, waitArchive } from '../src/core/okx/archive.js';

const { OKX_KEY, OKX_SECRET, OKX_PASSPHRASE } = process.env;
if (!OKX_KEY || !OKX_SECRET || !OKX_PASSPHRASE) {
  console.error('OKX_KEY / OKX_SECRET / OKX_PASSPHRASE 가 필요합니다 (.env.local).');
  process.exit(1);
}
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const since = sinceArg ? Number(sinceArg.slice(8)) : null;

const c = createClient({ key: OKX_KEY, secret: OKX_SECRET, passphrase: OKX_PASSPHRASE, fetch });
await c.syncTime();

const arcArg = process.argv.find((a) => a.startsWith('--archive='));
if (arcArg) {
  const m = /^(\d{4})Q([1-4])$/.exec(arcArg.slice(10));
  if (!m) { console.error('형식: --archive=2025Q3'); process.exit(1); }
  const o = { year: m[1], quarter: `Q${m[2]}` };
  console.log('신청:', (await applyArchive(c, o)).ready ? '이미 생성됨' : '생성 중');
  const r = await waitArchive(c, o, { onTick: (s) => console.log(`  상태: ${s}`) });
  if (r.state !== 'finished' || !r.fileHref) { console.error(`실패: state=${r.state} (다시 신청 필요)`); process.exit(1); }
  const buf = Buffer.from(await (await fetch(r.fileHref)).arrayBuffer());
  mkdirSync('data', { recursive: true });
  writeFileSync(`data/archive-${m[1]}Q${m[2]}.zip`, buf);
  console.log(`저장: data/archive-${m[1]}Q${m[2]}.zip (${buf.length} bytes). 압축을 직접 푸세요.`);
  process.exit(0);
}
const out = await syncAll(c, { since, onProgress: (l, n) => console.log(`  ${l}: ${n}`) });

mkdirSync('data', { recursive: true });
const { subtypes, ...rest } = out;
for (const [k, v] of Object.entries(rest)) writeFileSync(`data/okx-${k}.json`, JSON.stringify(v));
writeFileSync('data/okx-subtypes.json', JSON.stringify(subtypes));
console.log('--- 저장 완료 (건수) ---');
for (const [k, v] of Object.entries(out)) console.log(`${k}: ${v.length}`);
