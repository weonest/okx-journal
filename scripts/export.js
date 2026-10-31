// 사용자 실행: node --env-file=.env.local scripts/export.js [--since=<ms>]
// 결과는 data/okx-*.json에 저장하고, 화면에는 종류별 건수만 출력한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '../src/core/okx/client.js';
import { syncAll } from '../src/core/okx/sync.js';

const { OKX_KEY, OKX_SECRET, OKX_PASSPHRASE } = process.env;
if (!OKX_KEY || !OKX_SECRET || !OKX_PASSPHRASE) {
  console.error('OKX_KEY / OKX_SECRET / OKX_PASSPHRASE 가 필요합니다 (.env.local).');
  process.exit(1);
}
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const since = sinceArg ? Number(sinceArg.slice(8)) : null;

const c = createClient({ key: OKX_KEY, secret: OKX_SECRET, passphrase: OKX_PASSPHRASE, fetch });
await c.syncTime();
const out = await syncAll(c, { since, onProgress: (l, n) => console.log(`  ${l}: ${n}`) });

mkdirSync('data', { recursive: true });
const { subtypes, ...rest } = out;
for (const [k, v] of Object.entries(rest)) writeFileSync(`data/okx-${k}.json`, JSON.stringify(v));
writeFileSync('data/okx-subtypes.json', JSON.stringify(subtypes));
console.log('--- 저장 완료 (건수) ---');
for (const [k, v] of Object.entries(out)) console.log(`${k}: ${v.length}`);
