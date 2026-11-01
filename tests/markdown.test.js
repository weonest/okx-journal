import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, toggleCheck } from '../src/core/markdown.js';

const txt = (c) => c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : txt(x.c))).join('');

test('제목·문단·구분선', () => {
  const b = parseMarkdown('# 큰 제목\n## 중간\n### 작은\n첫 줄\n둘째 줄\n\n---\n다음 문단');
  assert.deepEqual(b.map((x) => x.t), ['h', 'h', 'h', 'p', 'hr', 'p']);
  assert.deepEqual(b.slice(0, 3).map((x) => x.level), [1, 2, 3]);
  assert.equal(b[3].lines.length, 2); // 붙은 줄은 한 문단
  assert.equal(txt(b[0].c), '큰 제목');
});

test('인라인: 굵게·기울임·취소선·코드·링크, 허용 안 된 링크는 글자 그대로', () => {
  const c = parseInline('**굵게** *기울임* ~~취소~~ `x*y` [OKX](https://okx.com) [나쁨](javascript:alert(1))');
  assert.deepEqual(c.filter((x) => x.t !== 'text').map((x) => x.t), ['b', 'i', 's', 'code', 'a']);
  assert.equal(c.find((x) => x.t === 'code').v, 'x*y');
  assert.equal(c.find((x) => x.t === 'a').href, 'https://okx.com');
  assert.ok(c.some((x) => x.t === 'text' && x.v.includes('javascript:alert(1)')));
  assert.deepEqual(parseInline('2 * 3 * 4').map((x) => x.t), ['text']); // 공백 둘러싼 * 는 기울임 아님
});

test('목록: 순서 없음/있음, 들여쓰기 단계, 체크박스(노션 내보내기 "[ ] " 포함), 줄 번호', () => {
  const b = parseMarkdown('- 하나\n  - 둘\n- [ ] 할 일\n- [x] 끝\n[ ] 노션 할 일\n\n1. 첫째\n2. 둘째');
  assert.equal(b[0].t, 'ul'); assert.equal(b[0].items.length, 5);
  assert.deepEqual(b[0].items.map((i) => i.depth), [0, 1, 0, 0, 0]);
  assert.deepEqual(b[0].items.map((i) => i.check), [null, null, false, true, false]);
  assert.equal(b[0].items[2].line, 2);
  assert.equal(b[1].t, 'ol'); assert.equal(b[1].start, 1); assert.equal(b[1].items.length, 2);
});

test('인용·코드 블록(안의 마크다운은 해석하지 않음)·표', () => {
  const b = parseMarkdown('> 손절은 기계적으로\n> 두 번째\n```js\nconst a = **b**;\n```\n| 구분 | 값 |\n|---|---:|\n| 진입 | 2850 |\n| 청산 | 2795 |');
  assert.deepEqual(b.map((x) => x.t), ['quote', 'code', 'table']);
  assert.equal(b[0].lines.length, 2);
  assert.equal(b[1].lang, 'js'); assert.equal(b[1].text, 'const a = **b**;');
  assert.equal(b[2].head.length, 2); assert.equal(b[2].rows.length, 2); assert.equal(txt(b[2].rows[1][1]), '2795');
});

test('toggleCheck: 해당 줄 체크만 뒤집는다', () => {
  assert.equal(toggleCheck('a\n- [ ] b\n- [x] c', 1), 'a\n- [x] b\n- [x] c');
  assert.equal(toggleCheck('a\n- [ ] b\n- [x] c', 2), 'a\n- [ ] b\n- [ ] c');
  assert.equal(toggleCheck('a', 5), 'a');
});
