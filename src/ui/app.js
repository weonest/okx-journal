import { h } from './dom.js';
import { S, subscribe } from './store.js';
import { settingsView } from './settings.js';
import { dataView } from './data.js';
import { dashboardView } from './dashboard.js';
import { tradesView } from './trades.js';
import { ordersView } from './orders.js';
import { positionsView } from './positions.js';

const stub = (n) => () => h('section', {}, `${n}단계에서 구현합니다.`);
const ROUTES = {
  dashboard: ['대시보드', dashboardView], trades: ['거래', tradesView], orders: ['주문', ordersView], positions: ['포지션', positionsView],
  journal: ['일지', stub(11)], data: ['데이터 점검', dataView], settings: ['설정', settingsView],
};
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const badge = document.getElementById('badge');

function render() {
  const name = (location.hash.match(/^#\/(\w+)/) ?? [])[1];
  const key = ROUTES[name] ? name : 'dashboard';
  nav.replaceChildren(...Object.entries(ROUTES).map(([k, [label]]) => h('a', { href: '#/' + k, class: k === key ? 'on' : null }, label)));
  badge.hidden = !S.sample;
  try { view.replaceChildren(ROUTES[key][1](render)); } catch (e) { view.replaceChildren(h('section', { class: 'down' }, '화면 오류: ' + e.message)); }
}
addEventListener('hashchange', render);
subscribe(render);
render();
