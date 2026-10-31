import { h, fmtTs } from './dom.js';
import { S, setApi, addCsv, clearData, setRemember, isRemembering, loadKeys, saveKeys, clearKeys, load } from './store.js';
import { createClient } from '../core/okx/client.js';
import { syncAll } from '../core/okx/sync.js';
import { applyArchive, getArchive } from '../core/okx/archive.js';

export function settingsView() {
  const saved = loadKeys() ?? {};
  const inp = (id, label, v, type = 'text') => [h('label', { for: id }, label), h('input', { id, type, value: v ?? '', autocomplete: 'off' })];
  const remember = h('input', { type: 'checkbox', id: 'rem', checked: isRemembering() || (load('keys') && localStorage.getItem('okx.keys')) ? true : null });
  remember.onchange = () => { // 켜자마자 저장(동기화를 누르지 않아도), 끄면 저장분 삭제
    setRemember(remember.checked);
    const k = { key: val('k'), secret: val('s'), passphrase: val('p') };
    if (k.key && k.secret && k.passphrase) saveKeys(k, remember.checked);
  };
  const log = h('div', { class: 'log' });
  const say = (s) => { log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
  const val = (id) => document.getElementById(id).value.trim();
  const client = () => {
    const k = { key: val('k'), secret: val('s'), passphrase: val('p') };
    if (!k.key || !k.secret || !k.passphrase) throw new Error('키·시크릿·패스프레이즈를 모두 입력하세요');
    saveKeys(k, document.getElementById('rem').checked);
    return createClient({ ...k, fetch: (...a) => fetch(...a) });
  };
  const run = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { say('오류: ' + e.message); } finally { btn.disabled = false; }
  };

  const syncBtn = h('button', {}, '동기화');
  syncBtn.onclick = run(syncBtn, async () => {
    log.textContent = '';
    const out = await syncAll(client(), { onProgress: (l, n) => say(`${l}: ${n}건`) });
    say(`완료: 주문 ${out.orders.length} · 체결 ${out.fills.length} · 원장 ${out.bills.length} · 포지션이력 ${out.positionHistory.length}`);
    setApi(out);
  });

  const yr = h('input', { id: 'yr', type: 'number', value: new Date().getFullYear(), style: 'width:90px' });
  const qt = h('select', { id: 'qt' }, ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => h('option', {}, q)));
  const link = h('div', {});
  const arch = () => ({ year: yr.value, quarter: qt.value });
  const applyBtn = h('button', { class: 'sub' }, '아카이브 신청');
  applyBtn.onclick = run(applyBtn, async () => {
    if (!confirm('신청은 하루 12회 제한입니다. 1회 신청할까요?')) return;
    const r = await applyArchive(client(), arch());
    say(r.ready ? '이미 파일이 있습니다. 상태 확인을 누르세요' : '신청 완료. 잠시 뒤 상태 확인');
  });
  const statBtn = h('button', { class: 'sub' }, '상태 확인');
  statBtn.onclick = run(statBtn, async () => {
    const r = await getArchive(client(), arch());
    say('상태: ' + (r.state ?? '신청 이력 없음'));
    link.replaceChildren();
    if (r.fileHref) link.append(h('a', { href: r.fileHref, target: '_blank', rel: 'noopener', style: 'color:var(--acc)' }, '파일 열기(받은 뒤 아래에서 업로드)'));
  });

  const drop = h('div', { class: 'drop' }, 'CSV 파일을 끌어다 놓거나 선택하세요 (A~E, 여러 개 가능)');
  const pick = h('input', { type: 'file', accept: '.csv', multiple: true });
  pick.onchange = () => addCsv(pick.files);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addCsv(e.dataTransfer.files); };

  return h('div', {},
    h('section', {}, h('h2', {}, 'API 키 (Read 전용)'),
      inp('k', 'API Key', saved.key, 'password'), inp('s', 'Secret', saved.secret, 'password'), inp('p', 'Passphrase', saved.passphrase, 'password'),
      h('div', { class: 'row' }, remember, h('label', { for: 'rem', style: 'margin:0' }, '이 기기에 기억 (키와 불러온 데이터를 이 브라우저에 저장 · 끄면 이 탭에서만 유지)'),
        h('button', { class: 'sub', onclick: () => { clearKeys(); location.reload(); } }, '키 지우기')),
      h('div', { class: 'row' }, syncBtn, h('span', { class: 'mute' }, '마지막 동기화: ' + fmtTs(S.lastSync) + ' (KST)')),
      log),
    h('section', {}, h('h2', {}, '과거 원장 아카이브'),
      h('div', { class: 'row' }, yr, qt, applyBtn, statBtn), link),
    h('section', {}, h('h2', {}, 'CSV 업로드'), drop, h('div', { class: 'row' }, pick,
      h('button', { class: 'sub', onclick: clearData }, '불러온 데이터 비우기')),
      h('ul', {}, S.csvInfo.map((i) => h('li', { class: i.error ? 'down' : '' },
        `${i.name} → ${i.error ? '오류: ' + i.error : `${i.kind} ${i.records}건` + (i.duplicates ? ` (중복 ${i.duplicates})` : '') + (i.tsMissing ? ` · 시각 없음 ${i.tsMissing}` : '')}`)))));
}
