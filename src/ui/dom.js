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
export function card(label, metric, text, extraNote, ico, tone) {
  const v = metric?.value;
  const tip = [metric?.source && `source: ${metric.source}`, metric?.note && `note: ${metric.note}`].filter(Boolean).join('\n');
  const body = [h('div', { class: 'k' }, label),
    h('div', { class: 'v ' + (tone ?? '') }, v == null ? '-' : text ?? String(v)),
    (v == null ? metric?.note : extraNote) ? h('div', { class: 'n' }, v == null ? metric?.note : extraNote) : null];
  return h('div', { class: 'card' + (ico ? ' kpi' : ''), title: tip || null },
    ico ? [h('div', { class: 'kb' }, body), h('div', { class: 'ib2 ' + (tone ?? '') }, icon(ico, 22))] : body);
}

export function table(heads, rows) {
  return h('div', { class: 'tbl' }, h('table', {},
    h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => (c && c.nodeType ? c : h('td', {}, c ?? '-'))))))));
}
export const td = (text, c) => h('td', { class: c || null }, text);

// 선 아이콘(24x24, 현재 글자색). 정적 문자열만 쓴다.
const ICONS = {
  upload: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5"/><path d="M12 12v8M9 15l3-3 3 3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  flask: '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.4 2h11.2a1.5 1.5 0 0 0 1.4-2l-5-10V3"/><path d="M7.5 15h9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  lines: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  arrow: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8M13 9l3 3-3 3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', right: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.5-6 7-6s6.2 2 7 6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
  award: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5"/>',
  alert: '<path d="M12 4L2.8 20h18.4L12 4z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l4-4 3 3 5-6"/>',
};
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('class', 'ico');
  s.innerHTML = ICONS[name] ?? '';
  return s;
}
