// 마크다운 → 블록 트리(순수 함수). 화면은 이 트리로 DOM을 만들고 HTML 문자열은 쓰지 않는다.
// 지원: # 제목(1~3), 문단, - / * / 1. 목록(들여쓰기 2칸 = 1단계), - [ ] / [x] 체크, > 인용, ``` 코드, --- 구분선, | 표 |
// 인라인: **굵게**, *기울임*, ~~취소선~~, `코드`, [글](http·https·mailto 링크)

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** @returns {{t:string, [k:string]:any}[]} 인라인 조각 */
export function parseInline(s) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^`([^`]+)`/.exec(rest))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      if (SAFE_URL.test(m[2])) out.push({ t: 'a', href: m[2], c: parseInline(m[1]) });
      else out.push({ t: 'text', v: m[0] }); // 허용하지 않는 주소는 글자 그대로
      i += m[0].length; continue;
    }
    if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest))) { flush(); out.push({ t: 'b', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) { flush(); out.push({ t: 's', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = /^\*(?=[^\s*])([^*]*?[^\s*])\*/.exec(rest)) || (m = /^\*([^\s*])\*/.exec(rest))) { flush(); out.push({ t: 'i', c: parseInline(m[1]) }); i += m[0].length; continue; }
    buf += s[i]; i++;
  }
  flush();
  return out;
}

const row = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/**
 * @param {string} text
 * @returns {{t:string, line?:number, [k:string]:any}[]} 블록. 목록 항목에는 원문 줄 번호(line)를 둔다(체크 토글용).
 */
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = null, list = null, quote = null;
  const end = () => { para = list = quote = null; };
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    let m;
    if ((m = /^\s*```\s*([\w-]*)\s*$/.exec(l))) { // 코드 블록: 닫는 ``` 까지 그대로
      end();
      const code = [];
      n++;
      while (n < lines.length && !/^\s*```\s*$/.test(lines[n])) code.push(lines[n++]);
      blocks.push({ t: 'code', lang: m[1] || null, text: code.join('\n') });
      continue;
    }
    if (!l.trim()) { end(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { end(); blocks.push({ t: 'h', level: m[1].length, c: parseInline(m[2].trim()) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { end(); blocks.push({ t: 'hr' }); continue; }
    if (l.includes('|') && n + 1 < lines.length && isSep(lines[n + 1])) { // 표: 머리줄 + 구분줄 + 본문줄
      end();
      const head = row(l).map(parseInline), rows = [];
      n += 2;
      while (n < lines.length && lines[n].includes('|') && lines[n].trim()) rows.push(row(lines[n++]).map(parseInline));
      n--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(l))) {
      para = list = null;
      if (!quote) { quote = { t: 'quote', lines: [] }; blocks.push(quote); }
      quote.lines.push(parseInline(m[1]));
      continue;
    }
    // 목록: "- [ ] 할 일" / "[ ] 할 일"(노션 내보내기) / "- 항목" / "1. 항목"
    const li = /^(\s*)(?:([-*+])\s+|(\d+)[.)]\s+)?(?:\[( |x|X)\]\s+)?(.*)$/.exec(l);
    const isItem = li && (li[2] || li[3] || li[4] != null);
    if (isItem) {
      para = quote = null;
      const ordered = !!li[3];
      if (!list || list.ordered !== ordered) { list = { t: ordered ? 'ol' : 'ul', ordered, start: ordered ? Number(li[3]) : null, items: [] }; blocks.push(list); }
      list.items.push({ depth: Math.floor(li[1].replace(/\t/g, '  ').length / 2), check: li[4] == null ? null : li[4].toLowerCase() === 'x', c: parseInline(li[5]), line: n });
      continue;
    }
    list = quote = null;
    if (!para) { para = { t: 'p', lines: [] }; blocks.push(para); }
    para.lines.push(parseInline(l.trim()));
  }
  return blocks;
}

/** 원문의 n번째 줄 체크박스를 뒤집는다(미리보기에서 체크할 때). 체크 줄이 아니면 그대로. */
export function toggleCheck(text, n) {
  const lines = String(text ?? '').split('\n');
  if (n < 0 || n >= lines.length) return text;
  lines[n] = lines[n].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}
