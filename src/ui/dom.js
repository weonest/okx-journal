// DOM·표시 보조. 계산은 하지 않는다(표시 형식만).
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export const KST = 9 * 3600 * 1000;
export const fmtTs = (ts) => (ts == null ? '-' : new Date(ts + KST).toISOString().slice(0, 16).replace('T', ' '));
export const fmtDate = (ts) => (ts == null ? '-' : new Date(ts + KST).toISOString().slice(0, 10));

export function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '-';
  return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
export const fmtPct = (v) => (v == null ? '-' : (v * 100).toFixed(1) + '%');
export function fmtDur(ms) {
  if (ms == null) return '-';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + '분';
  if (m < 1440) return (m / 60).toFixed(1) + '시간';
  return (m / 1440).toFixed(1) + '일';
}
export const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/** 지표 카드. 값이 null이면 '-'와 사유를 보이고, 툴팁에 source·note를 넣는다. */
export function card(label, metric, text, extraNote) {
  const v = metric?.value;
  const tip = [metric?.source && `source: ${metric.source}`, metric?.note && `note: ${metric.note}`].filter(Boolean).join('\n');
  return h('div', { class: 'card', title: tip || null },
    h('div', { class: 'k' }, label),
    h('div', { class: 'v' }, v == null ? '-' : text ?? String(v)),
    (v == null ? metric?.note : extraNote) ? h('div', { class: 'n' }, v == null ? metric?.note : extraNote) : null);
}

export function table(heads, rows) {
  return h('div', { class: 'tbl' }, h('table', {},
    h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => (c && c.nodeType ? c : h('td', {}, c ?? '-'))))))));
}
export const td = (text, c) => h('td', { class: c || null }, text);
