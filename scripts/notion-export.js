// 사용자 실행: node --env-file=.env.local scripts/notion-export.js [--no-body]
// .env.local: NOTION_TOKEN=<읽기 전용 통합 토큰>, NOTION_DB=<DB 링크 또는 ID>
// 결과는 data/notion-journal.json (앱의 #/journal에서 업로드). 화면에는 건수만 출력한다.
// 브라우저에서는 Notion API가 CORS로 막혀 있어 스크립트로 내보낸다. Notion-Version은 DB 조회가 문서화된 2022-06-28로 고정.
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseNotionPages } from '../src/core/notion.js';

const { NOTION_TOKEN, NOTION_DB } = process.env;
if (!NOTION_TOKEN || !NOTION_DB) { console.error('NOTION_TOKEN / NOTION_DB 가 필요합니다 (.env.local).'); process.exit(1); }
const dbId = (NOTION_DB.replace(/-/g, '').match(/[0-9a-f]{32}/i) ?? [])[0];
if (!dbId) { console.error('NOTION_DB에서 32자리 DB ID를 찾지 못했습니다.'); process.exit(1); }
const withBody = !process.argv.includes('--no-body');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch('https://api.notion.com/v1' + path, {
      method, headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion ${res.status} ${j.code ?? ''}: ${j.message ?? ''}`.trim());
    await sleep(350); // 평균 3회/초 제한
    return j;
  }
  throw new Error('Notion 요청 제한(429)이 계속됩니다');
}

const pages = [];
let cursor;
do {
  const j = await api('POST', `/databases/${dbId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  pages.push(...j.results); cursor = j.has_more ? j.next_cursor : null;
  console.log(`  페이지: ${pages.length}`);
} while (cursor);

const entries = parseNotionPages(pages);
if (withBody) {
  const line = (b) => {
    const x = b[b.type]; const t = (x?.rich_text ?? []).map((r) => r.plain_text).join('');
    return !t ? null : b.type === 'to_do' ? `${x.checked ? '[x]' : '[ ]'} ${t}` : /^heading_/.test(b.type) ? `# ${t}` : /list_item$/.test(b.type) ? `- ${t}` : t;
  };
  for (const [i, e] of entries.entries()) {
    let c; const lines = [];
    do {
      const j = await api('GET', `/blocks/${e.pageId}/children?page_size=100${c ? '&start_cursor=' + c : ''}`);
      for (const b of j.results) { const l = line(b); if (l) lines.push(l); }
      c = j.has_more ? j.next_cursor : null;
    } while (c);
    e.body = lines;
    if ((i + 1) % 10 === 0) console.log(`  본문: ${i + 1}/${entries.length}`);
  }
}
mkdirSync('data', { recursive: true });
writeFileSync('data/notion-journal.json', JSON.stringify({ exportedAt: Date.now(), entries }));
console.log(`--- 저장 완료: data/notion-journal.json (일지 ${entries.length}건, 날짜 없음 ${entries.filter((e) => !e.date).length}, 연결ID 있음 ${entries.filter((e) => e.linkId).length}) ---`);
