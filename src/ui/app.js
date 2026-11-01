import { h, icon } from './dom.js';
import { S, subscribe, addCsv, toggleSample, restore } from './store.js';
import { settingsView } from './settings.js';
import { dataView } from './data.js';
import { dashboardView, calendarView } from './dashboard.js';
import { periodsView } from './periods.js';
import { tradesView } from './trades.js';
import { ordersView } from './orders.js';
import { journalView } from './journal.js';
import { marketPanel } from './market.js';
import { positionsView } from './positions.js';
import { startCloud } from './cloud.js'; // 로그인 응답(#access_token)을 첫 렌더 전에 처리

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
  nav.querySelector('a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); // 좁은 화면에서 선택 탭이 보이게
  badge.hidden = !S.sample;
  syncSampleBtn();
  try { view.replaceChildren(ROUTES[key][1](render)); } catch (e) { view.replaceChildren(h('section', { class: 'down' }, '화면 오류: ' + e.message)); }
  // 뷰가 먼저 선택 거래를 정한 뒤 시세 패널을 맞춘다
  market.hidden = !MAIN.includes(key);
  if (!market.hidden) { const el = marketPanel(render); if (market.firstChild !== el) market.replaceChildren(el); }
}
addEventListener('hashchange', render);

// 헤더 오른쪽: 동기화(설정) · CSV 업로드 · 예시 데이터 · 사용자 메뉴(나머지 화면)
const pick = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
pick.onchange = async () => { await addCsv(pick.files); pick.value = ''; };
const REST = ['journal', 'orders', 'positions', 'data', 'settings'];
const userMenu = h('details', { class: 'user' }, h('summary', {}, icon('user', 18)), h('div', { class: 'menu' }, REST.map((k) => h('a', { href: '#/' + k, onclick: () => userMenu.removeAttribute('open') }, ROUTES[k][0]))));
const sampleLabel = h('span', {}, '예시 데이터');
const sampleBtn = h('button', { class: 'pill ghost', onclick: async () => { await toggleSample(); if (!MAIN.includes((location.hash.match(/^#\/(\w+)/) ?? [])[1])) location.hash = '#/dashboard'; } }, icon('flask', 17), sampleLabel);
function syncSampleBtn() {
  sampleBtn.classList.toggle('active', S.sample);
  sampleLabel.textContent = S.sample ? '예시 끄기' : '예시 데이터';
  sampleBtn.title = S.sample ? '예시 데이터를 끄고 원래 데이터로 돌아갑니다' : '합성 예시 데이터를 불러옵니다(다시 누르면 끕니다)';
}
document.getElementById('actions').replaceChildren(pick,
  h('button', { class: 'round', title: '동기화(설정으로 이동)', onclick: () => { location.hash = '#/settings'; } }, icon('refresh', 18)),
  h('button', { class: 'pill', onclick: () => pick.click() }, icon('upload', 17), 'CSV 파일 업로드'),
  sampleBtn,
  userMenu);

subscribe(render);
render();
restore().finally(startCloud); // 저장된 데이터·복기 복원 뒤 클라우드 동기화 시작
