import { h } from './dom.js';
import { S, subscribe, addCsv, clearData } from './store.js';
import { settingsView } from './settings.js';
import { dataView } from './data.js';
import { dashboardView, calendarView } from './dashboard.js';
import { periodsView } from './periods.js';
import { tradesView } from './trades.js';
import { ordersView } from './orders.js';
import { journalView } from './journal.js';
import { positionsView } from './positions.js';

const ROUTES = {
  dashboard: ['종합 대시보드', dashboardView], trades: ['거래 상세 목록', tradesView], calendar: ['트레이딩 캘린더', calendarView], periods: ['주기별 손익 정산', periodsView],
  journal: ['매매일지', journalView], orders: ['주문 통계', ordersView], positions: ['포지션', positionsView], data: ['데이터 점검', dataView], settings: ['설정', settingsView],
};
const MAIN = ['dashboard', 'trades', 'calendar', 'periods', 'journal'];
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const badge = document.getElementById('badge');

function render() {
  const name = (location.hash.match(/^#\/(\w+)/) ?? [])[1];
  const key = ROUTES[name] ? name : 'dashboard';
  const link = (k) => h('a', { href: '#/' + k, class: k === key ? 'on' : null }, ROUTES[k][0]);
  const rest = Object.keys(ROUTES).filter((k) => !MAIN.includes(k));
  nav.replaceChildren(...MAIN.map(link), h('details', { class: 'more' }, h('summary', { class: rest.includes(key) ? 'on' : null }, rest.includes(key) ? ROUTES[key][0] : '더 보기'), h('div', { class: 'menu' }, rest.map(link))));
  badge.hidden = !S.sample;
  try { view.replaceChildren(ROUTES[key][1](render)); } catch (e) { view.replaceChildren(h('section', { class: 'down' }, '화면 오류: ' + e.message)); }
}
addEventListener('hashchange', render);
subscribe(render);
render();

// 헤더 오른쪽: CSV 업로드 · 동기화(설정으로) · 데이터 삭제
const pick = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
pick.onchange = async () => { await addCsv(pick.files); pick.value = ''; };
document.getElementById('actions').replaceChildren(pick,
  h('button', { class: 'sub', onclick: () => pick.click() }, 'CSV 업로드'),
  h('button', { class: 'sub', title: '동기화는 설정에서', onclick: () => { location.hash = '#/settings'; } }, '동기화'),
  h('button', { class: 'sub danger', onclick: () => { if (confirm('불러온 데이터를 모두 지울까요? (저장된 키는 유지됩니다)')) clearData(); } }, '삭제'));
