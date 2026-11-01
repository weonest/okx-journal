// 거래별 복기 페이지(노션식). 거래 값은 읽기 전용, 복기 칸은 편집 후 바로 저장한다.
// 오버레이는 앱 렌더와 별개 DOM이라 저장 후 화면이 다시 그려져도 입력 포커스가 유지된다.
import { h, icon, fmtNum, fmtTs, fmtDur, fmtPct, cls, KST } from './dom.js';
import { S, reviewOf, saveReview, deleteReview } from './store.js';
import { REVIEW_FIELDS, parseTags, leverageOf, roeOf, mockTrade } from '../core/review.js';
import { renderBody, journalForTrade } from './journal.js';
import { imageSrc, forgetImage, cloudBadge } from './cloud.js';
import { kvPut } from './store.js';

const MAX_IMG = 1600; // 긴 변(px). 브라우저 저장 공간을 아끼려고 줄여서 저장한다
let overlay = null;

const px = (v) => (v == null ? '-' : fmtNum(v, Math.abs(v) < 10 ? 4 : 2));
const prop = (ic, label, value, title) => h('div', { class: 'rv-p', title: title || null }, h('span', { class: 'rv-k' }, icon(ic, 15), label), h('div', { class: 'rv-v' }, value));
const tip = (m) => `source: ${m.source}${m.note ? '\nnote: ' + m.note : ''}`;

export function closeReview() { closeLightbox(); overlay?.remove(); overlay = null; removeEventListener('keydown', onKey); }
const onKey = (e) => {
  if (e.key !== 'Escape' || e.target.closest?.('textarea, input')) return;
  if (lightbox) closeLightbox(); else closeReview(); // 이미지 뷰어가 열려 있으면 그것부터 닫는다
};

// 이미지 크게 보기: data: 주소는 브라우저가 새 탭 열기를 막으므로 앱 안에서 띄운다
let lightbox = null;
function closeLightbox() { lightbox?.remove(); lightbox = null; }
function viewImage(src, name) {
  closeLightbox();
  lightbox = h('div', { class: 'lb', role: 'dialog', 'aria-label': '이미지 보기', onclick: (e) => { if (!e.target.closest('a')) closeLightbox(); } },
    h('img', { src, alt: name ?? '' }),
    h('div', { class: 'lb-bar' }, h('span', { class: 'mute small' }, name ?? ''), h('a', { href: src, download: name || 'image.jpg', class: 'sub small' }, '저장'), h('button', { class: 'ib', title: '닫기(Esc)' }, '×')));
  document.body.append(lightbox);
}

export function openReview(tradeId) {
  const t = [...(S.result?.trades ?? []), ...S.mocks].find((x) => x.id === tradeId);
  if (!t) return;
  closeReview();
  let r = reviewOf(tradeId);
  const save = (patch) => { r = { ...r, ...patch }; saveReview(tradeId, r); };

  const cur = () => (t.mock ? mockTrade(tradeId, r) : t); // 모의 매매는 입력할 때마다 값이 바뀐다
  const lev = leverageOf(t, S.result?.data?.Order);
  const roeBox = h('div', { class: 'rv-v' });
  const drawRoe = () => {
    const m = roeOf(cur(), r);
    roeBox.replaceChildren(m.value == null ? h('span', { class: 'mute', title: tip(m) }, '- ' + m.note)
      : h('span', { class: 'rv-roe ' + cls(m.value), title: tip(m) }, (m.value > 0 ? '+' : '') + fmtPct(m.value), h('i', { style: `width:${Math.round(Math.min(1, Math.abs(m.value)) * 140)}px` })));
  };
  drawRoe();

  // 편집 칸: 바뀔 때(blur·Enter) 저장
  const field = (f) => {
    if (f.type === 'grade') {
      return h('select', { class: 'rv-in', onchange: (e) => save({ grade: e.target.value || null }) },
        ['', 'A', 'B', 'C', 'D'].map((g) => h('option', { value: g, selected: (r.grade ?? '') === g ? true : null }, g || '-')));
    }
    const val = f.type === 'tags' ? r[f.key].join(', ') : r[f.key] ?? '';
    const el = h('input', { class: 'rv-in', type: f.type === 'number' ? 'number' : 'text', value: val, placeholder: f.type === 'tags' ? '비어 있음 · 쉼표로 구분' : '비어 있음',
      inputmode: f.type === 'number' ? 'decimal' : null, step: 'any' });
    el.onchange = () => {
      const v = el.value.trim();
      if (f.type === 'tags') save({ [f.key]: parseTags(v) });
      else if (f.type === 'number') save({ [f.key]: v === '' || !Number.isFinite(Number(v)) ? null : Number(v) });
      else save({ [f.key]: v });
      if (f.key === 'margin') drawRoe();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
    return el;
  };
  const icons = { reasons: 'lines', strategies: 'chart', mood: 'pulse', ruleScore: 'percent', feedback: 'award', todo: 'target', mistakes: 'alert', grade: 'award', margin: 'hash' };
  const labelOf = (f) => (f.key === 'margin' ? `마진${t.ccy ? ' (' + t.ccy + ')' : ''}` : f.label);
  const editProps = REVIEW_FIELDS.map((f) => prop(icons[f.key], labelOf(f), field(f)));

  // 읽기 전용 거래 값
  // 모의 매매: 거래 값도 직접 입력(계산으로 채우지 않는다). 시각 입력은 KST.
  const title = h('h1', { class: 'rv-title' }, t.instId.replace('-SWAP', ''));
  const toLocal = (ts) => (ts == null ? '' : new Date(ts + KST).toISOString().slice(0, 16));
  const mk = (key, type = 'number') => {
    const v = r.mock[key];
    const el = h('input', { class: 'rv-in', type: type === 'dt' ? 'datetime-local' : type, value: type === 'dt' ? toLocal(v) : v ?? '', placeholder: '비어 있음', step: 'any', inputmode: type === 'number' ? 'decimal' : null });
    el.onchange = () => {
      const x = el.value.trim();
      const val = type === 'dt' ? (x ? Date.parse(x + ':00+09:00') : null) : type === 'number' ? (x === '' || !Number.isFinite(Number(x)) ? null : Number(x)) : key === 'instId' ? x.toUpperCase() : x;
      save({ mock: { ...r.mock, [key]: val } });
      if (key === 'instId') el.value = val; // 대문자로 맞춘 값을 그대로 보여 준다
      title.textContent = (r.mock.instId || '-').replace('-SWAP', ''); drawRoe();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
    return el;
  };
  const mockSide = () => h('select', { class: 'rv-in', onchange: (e) => save({ mock: { ...r.mock, side: e.target.value } }) },
    [['long', 'LONG'], ['short', 'SHORT']].map(([v, l]) => h('option', { value: v, selected: r.mock.side === v ? true : null }, l)));
  const main = t.mock ? [
    prop('flask', '구분', h('span', { class: 'chip mock' }, '모의 매매'), '실제로 체결하지 않은 가상 거래입니다. 대시보드·통계에는 넣지 않습니다.'),
    prop('lines', '종목', mk('instId', 'text')),
    prop('target', 'SIDE', mockSide()),
    prop('calendar', '매매일 (KST)', mk('openTs', 'dt')),
    prop('calendar', '청산일 (KST)', mk('closeTs', 'dt')),
    prop('hash', '최대 수량', mk('size')),
    prop('hash', '평균 진입가', mk('entryPx')),
    prop('hash', '평균 청산가', mk('exitPx')),
    prop('arrow', '순 손익', mk('net')),
    prop('hash', '통화', mk('ccy', 'text')),
    h('div', { class: 'rv-p' }, h('span', { class: 'rv-k' }, icon('percent', 15), 'ROE'), roeBox),
    prop('hash', '사용 레버리지', mk('lever')),
  ] : [
    prop('calendar', '매매일', fmtTs(t.openTs) + ' (KST)'),
    prop('target', 'SIDE', h('span', { class: 'tag ' + t.side }, t.side.toUpperCase())),
    prop('hash', '최대 수량', fmtNum(t.maxSize, 6)),
    prop('hash', '평균 진입가', px(t.avgEntryPx)),
    prop('hash', '평균 청산가', t.status === 'CLOSED' ? px(t.avgExitPx) : '-'),
    prop('arrow', '순 손익', t.ccy ? h('strong', { class: cls(t.net) }, (t.net > 0 ? '+' : '') + fmtNum(t.net) + ' ' + t.ccy) : '통화 여럿(합산 안 함)'),
    h('div', { class: 'rv-p' }, h('span', { class: 'rv-k' }, icon('percent', 15), 'ROE'), roeBox),
    prop('hash', '사용 레버리지', lev.value == null ? h('span', { class: 'mute' }, '- ' + lev.note) : `${lev.value}배`, tip(lev)),
  ];
  const more = t.mock ? [] : [
    prop('calendar', '청산일', t.closeTs != null ? fmtTs(t.closeTs) + ' (KST)' : '- 미청산'),
    prop('hash', '보유 시간', t.closeTs != null ? fmtDur(t.closeTs - t.openTs) : '-'),
    prop('hash', '수수료', t.ccy ? fmtNum(t.fee, 4) + ' ' + t.ccy : '-'),
    t.interest ? prop('hash', '이자', fmtNum(t.interest, 4)) : null,
    t.funding ? prop('hash', '펀딩', fmtNum(t.funding, 4)) : null,
    prop('lines', '상품군', t.instType + (t.mgnMode ? ' · ' + t.mgnMode : '')),
    prop('target', '상태', t.status + (t.closeReason && t.closeReason !== 'TRADE' ? ' · ' + t.closeReason : '')),
  ];
  const moreBox = h('div', { hidden: true }, more);
  const moreBtn = t.mock ? null : h('button', { class: 'rv-more', onclick: () => { moreBox.hidden = !moreBox.hidden; moreBtn.textContent = moreBox.hidden ? '⌄ 속성 더 보기' : '⌃ 속성 접기'; } }, '⌄ 속성 더 보기');

  // 체결 내역
  const ex = t.execs ?? [];
  const execTbl = ex.length ? h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, ['시각(KST)', '구분', '수량', '가격', '실현손익', '수수료'].map((x) => h('th', {}, x)))),
    h('tbody', {}, ex.map((e) => h('tr', {}, h('td', {}, fmtTs(e.ts)),
      h('td', {}, h('span', { class: 'tag ' + (e.side === 'buy' ? 'long' : 'short') }, e.side === 'buy' ? 'B 매수' : 'S 매도'), ' ', e.kind === 'in' ? '진입' : '청산'),
      h('td', {}, fmtNum(e.sz, 6)), h('td', {}, px(e.px)), h('td', { class: cls(e.pnl) }, e.pnl == null ? '-' : fmtNum(e.pnl, 4)), h('td', {}, e.fee == null ? '-' : fmtNum(e.fee, 4))))))) : h('div', { class: 'mute' }, '-: 체결 기록 없음');

  // 댓글
  const cList = h('div', {});
  const drawComments = () => cList.replaceChildren(...r.comments.map((c, i) => h('div', { class: 'rv-c' }, h('span', { class: 'rv-av' }, 'U'),
    h('div', { class: 'grow' }, h('div', { class: 'mute small' }, fmtTs(c.ts)), h('div', {}, c.text)),
    h('button', { class: 'ib', title: '삭제', onclick: () => { save({ comments: r.comments.filter((_, j) => j !== i) }); drawComments(); } }, '×'))));
  drawComments();
  const cIn = h('input', { class: 'rv-in', placeholder: '댓글 추가 (Enter)' });
  cIn.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && cIn.value.trim()) { save({ comments: [...r.comments, { ts: Date.now(), text: cIn.value.trim() }] }); cIn.value = ''; drawComments(); } };

  // 이미지: 업로드·붙여넣기·끌어다 놓기
  const gal = h('div', { class: 'rv-gal' });
  const drawImgs = () => gal.replaceChildren(...r.images.map((im) => {
    const img = h('img', { alt: im.name ?? '' }), fig = h('figure', { class: 'loading' }, img,
      h('button', { class: 'ib', title: '삭제', onclick: () => { forgetImage(im); save({ images: r.images.filter((x) => x !== im) }); drawImgs(); } }, '×'));
    imageSrc(im).then((src) => { fig.classList.remove('loading'); if (src) { img.src = src; img.onclick = () => viewImage(src, im.name); } else fig.append(h('span', { class: 'mute small' }, '이 기기에 없음(Drive 연결 후 표시)')); });
    return fig;
  }));
  drawImgs();
  const imsg = h('span', { class: 'mute small' });
  const addFiles = async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    try {
      const add = await Promise.all(imgs.map(async (f) => {
        const { src, name } = await shrink(f), id = crypto.randomUUID();
        if (S.sample) return { id, name, fileId: null, src }; // 예시 데이터는 저장하지 않으므로 그대로 둔다
        await kvPut('img:' + id, src);
        return { id, name, fileId: null };
      }));
      save({ images: [...r.images, ...add] }); drawImgs(); imsg.textContent = ''; } catch (e) { imsg.textContent = '이미지 오류: ' + e.message; }
  };
  const ipick = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => { await addFiles(ipick.files); ipick.value = ''; } });
  const drop = h('div', { class: 'rv-drop' }, h('button', { class: 'sub acc', onclick: () => ipick.click() }, icon('upload', 15), ' 이미지 업로드'),
    h('span', { class: 'mute' }, '이미지 복사 붙여넣기(Ctrl+V) 또는 끌어다 놓기'), ipick, imsg);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('on'); addFiles(e.dataTransfer.files); };

  // 본문(마크다운 일부: #, -, [ ])
  const ta = h('textarea', { class: 'rv-body', placeholder: '## 복기 메모\n- 진입 이유\n- 잘한 점 / 아쉬운 점\n[ ] 다음에 할 일' });
  ta.value = r.body;
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  let timer = null;
  ta.oninput = () => { fit(); clearTimeout(timer); timer = setTimeout(() => save({ body: ta.value }), 600); };
  ta.onblur = () => { clearTimeout(timer); if (ta.value !== r.body) save({ body: ta.value }); };
  const pv = h('div', { class: 'jbody', hidden: true });
  const pvBtn = h('button', { class: 'sub small', onclick: () => { const on = pv.hidden; pv.hidden = !on; ta.hidden = on; if (on) pv.replaceChildren(...renderBody(ta.value.split('\n').filter((l) => l.trim()))); else fit(); pvBtn.textContent = on ? '편집' : '미리보기'; } }, '미리보기');

  const page = h('div', { class: 'rv-page', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'between rv-top' }, h('span', { class: 'mute small' }, '세션 상세 목록 / ' + (t.mock ? '모의 매매' : t.instId)),
      h('div', { class: 'row' }, t.mock ? h('button', { class: 'sub small down', onclick: () => { if (confirm('이 모의 매매와 복기를 삭제할까요? (다른 기기에서도 삭제됩니다)')) { deleteReview(tradeId); closeReview(); } } }, '삭제') : null,
        h('button', { class: 'ib', title: '닫기(Esc)', onclick: closeReview }, '×'))),
    title,
    h('div', { class: 'rv-props' }, main, editProps, moreBox), moreBtn,
    t.mock ? null : [h('h3', { class: 'rv-h' }, `체결 ${ex.length}건`), h('div', { class: 'mute small' }, '포지션이 0에서 열려 0으로 닫힐 때까지를 거래 1건으로 묶고, 그 안의 분할 진입·청산을 체결로 보여줍니다.'), execTbl],
    h('h3', { class: 'rv-h' }, '댓글'), cList, h('div', { class: 'rv-c' }, h('span', { class: 'rv-av' }, 'U'), cIn),
    drop, gal,
    h('div', { class: 'between' }, h('h3', { class: 'rv-h' }, '본문'), pvBtn), ta, pv,
    journalForTrade(t.id),
    h('div', { class: 'mute small rv-foot' }, (S.sample ? '예시 데이터: 이 복기는 저장되지 않습니다. ' : '자동 저장됩니다. ') + (r.updatedAt ? '마지막 저장 ' + fmtTs(r.updatedAt) + ' ' : ''), S.sample ? null : cloudBadge()));
  page.onpaste = (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } };
  overlay = h('div', { class: 'rv-ov', onclick: (e) => { if (e.target === overlay) closeReview(); } }, page);
  document.body.append(overlay);
  addEventListener('keydown', onKey);
  requestAnimationFrame(fit);
}

/** 이미지를 긴 변 MAX_IMG 이하 JPEG로 줄여 data URL로 만든다(GIF·작은 PNG는 그대로). */
function shrink(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => {
      const src = fr.result;
      const img = new Image();
      img.onerror = () => rej(new Error('읽을 수 없는 이미지'));
      img.onload = () => {
        const k = Math.min(1, MAX_IMG / Math.max(img.width, img.height));
        if (k === 1 && (file.type === 'image/gif' || file.size < 300_000)) return res({ src, name: file.name });
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res({ src: c.toDataURL('image/jpeg', 0.85), name: file.name });
      };
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}
