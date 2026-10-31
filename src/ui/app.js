import { h, icon } from './dom.js';
import { S, subscribe, addCsv, loadSample, restore } from './store.js';
import { settingsView } from './settings.js';
import { dataView } from './data.js';
import { dashboardView, calendarView } from './dashboard.js';
import { periodsView } from './periods.js';
import { tradesView } from './trades.js';
import { ordersView } from './orders.js';
import { journalView } from './journal.js';
import { marketPanel } from './market.js';
import { positionsView } from './positions.js';

const ROUTES = {
  dashboard: ['종합 대시보드', dashboardView], trades: ['세션 상세 목록', tradesView], calendar: ['트레이딩 캘린더', calendarView], periods: ['주기별 손익 정산', periodsView],
  journal: ['매매일지', journalView], orders: ['주문 통계', ordersView], positions: ['포지션', positionsView], data: ['데이터 점검', dataView], settings: ['설정', settingsView],
};
const MAIN = ['dashboard', 'trades', 'calendar', 'periods'];
const view = document.getElementById('view');
const market = document.getElementById('market');
const nav = document.getElementById('nav');
const badge = document.getElementById('badge');

function render() {
  const name = (location.hash.match(/^#\/(\w+)/) ?? [])[1];
  const key = ROUTES[name] ? name : 'dashboard';
  const link = (k) => h('a', { href: '#/' + k, class: k === key ? 'on' : null }, ROUTES[k][0]);
  nav.replaceChildren(...MAIN.map(link));
  badge.hidden = !S.sample;
  try { view.replaceChildren(ROUTES[key][1](render)); } catch (e) { view.replaceChildren(h('section', { class: 'down' }, '화면 오류: ' + e.message)); }
  // 뷰가 먼저 선택 거래를 정한 뒤 시세 패널을 맞춘다
  market.hidden = !MAIN.includes(key);
  if (!market.hidden) { const el = marketPanel(render); if (market.firstChild !== el) market.replaceChildren(el); }
}
addEventListener('hashchange', render);
subscribe(render);
render();
restore(); // 저장된 데이터가 있으면 복원(복원되면 subscribe로 다시 그려진다)

// 헤더 오른쪽: 동기화(설정) · CSV 업로드 · 예시 데이터 · 사용자 메뉴(나머지 화면)
const pick = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
pick.onchange = async () => { await addCsv(pick.files); pick.value = ''; };
const REST = ['journal', 'orders', 'positions', 'data', 'settings'];
const userMenu = h('details', { class: 'user' }, h('summary', {}, icon('user', 18)), h('div', { class: 'menu' }, REST.map((k) => h('a', { href: '#/' + k, onclick: () => userMenu.removeAttribute('open') }, ROUTES[k][0]))));
document.getElementById('actions').replaceChildren(pick,
  h('button', { class: 'round', title: '동기화(설정으로 이동)', onclick: () => { location.hash = '#/settings'; } }, icon('refresh', 18)),
  h('button', { class: 'pill', onclick: () => pick.click() }, icon('upload', 17), 'CSV 파일 업로드'),
  h('button', { class: 'pill ghost', title: '합성 예시 데이터를 불러옵니다(새로고침하면 사라집니다)', onclick: async () => { await loadSample(); if (!MAIN.includes((location.hash.match(/^#\/(\w+)/) ?? [])[1])) location.hash = '#/dashboard'; } }, icon('flask', 17), '예시 데이터'),
  userMenu);
