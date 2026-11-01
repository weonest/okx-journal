// 기기 간 복기 동기화: Google Drive appDataFolder. 외부 스크립트 없이 OAuth 리다이렉트(토큰 방식)로 로그인한다.
// 토큰은 키와 같은 규칙으로 저장한다(기본 sessionStorage, "이 기기에 기억"이면 localStorage). 화면·로그에 출력하지 않는다.
import { h, fmtTs } from './dom.js';
import { S, save, load, isRemembering, setReviewHook, replaceReviews, kvGet, kvPut, kvDel } from './store.js';
import { createDrive, mergeReviews, forCloud, pendingImages, REVIEWS_FILE, DriveAuthError } from '../core/drive.js';
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const ON = 'okx.gdrive'; // 연결을 켠 기기 표시(비밀 아님)
const safe = (f) => { try { return f(); } catch { return null; } };

export const C = { state: 'off', msg: '', lastSync: Number(load('gLast')) || null };
const subs = new Set();
export const onCloud = (f) => (subs.add(f), () => subs.delete(f));
const set = (state, msg = '') => { C.state = state; C.msg = msg; subs.forEach((f) => f()); };

export const redirectUri = () => location.origin + location.pathname;
export const clientId = () => load('gcid') || GOOGLE_CLIENT_ID;
export const setClientId = (v) => save('gcid', v.trim(), true);
export const isOn = () => safe(() => localStorage.getItem(ON) === '1') === true;

function token() {
  const j = safe(() => JSON.parse(load('gtok')));
  return j && j.exp > Date.now() ? j.t : null;
}
const drive = createDrive((...a) => fetch(...a), token);

// 로그인 응답(#access_token=...)은 앱이 화면을 그리기 전에 처리하고 원래 화면 주소로 되돌린다.
(function handleCallback() {
  if (!/[#&](access_token|error)=/.test(location.hash)) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const want = safe(() => sessionStorage.getItem('okx.gstate'));
  const back = safe(() => sessionStorage.getItem('okx.greturn')) || '#/settings';
  safe(() => { sessionStorage.removeItem('okx.gstate'); sessionStorage.removeItem('okx.greturn'); });
  history.replaceState(null, '', location.pathname + location.search + back);
  if (p.get('error')) { C.state = 'error'; C.msg = 'Google 로그인 취소 또는 실패: ' + p.get('error'); return; }
  if (!want || p.get('state') !== want) { C.state = 'error'; C.msg = '로그인 응답 검증 실패(state 불일치)'; return; }
  const exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 - 60_000;
  save('gtok', JSON.stringify({ t: p.get('access_token'), exp }), isRemembering());
  safe(() => localStorage.setItem(ON, '1'));
})();

export function login() {
  const id = clientId();
  if (!id) throw new Error('Google OAuth 클라이언트 ID를 먼저 입력하세요');
  const state = crypto.randomUUID();
  sessionStorage.setItem('okx.gstate', state);
  sessionStorage.setItem('okx.greturn', location.hash || '#/settings');
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}

export function logout() {
  const t = token();
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
  safe(() => { sessionStorage.removeItem('okx.gtok'); localStorage.removeItem('okx.gtok'); localStorage.removeItem(ON); });
  set('off');
}

// --- 동기화: 받기 → 거래별 병합(최근 수정 우선) → 새 이미지 올리기 → 바뀌었으면 올리기 ---
let running = null, again = false, dirty = false, lastRemote = null, timer = null;
export function sync() {
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; if (again) { again = false; sync(); } });
  return running;
}
async function run() {
  if (S.sample || !isOn()) return;
  if (!token()) { set('expired', '연결이 만료되었습니다. 다시 연결을 누르세요(변경분은 이 기기에 남아 있다가 연결되면 올라갑니다).'); return; }
  set('syncing');
  try {
    const f = await drive.find(REVIEWS_FILE);
    if (f && !dirty && f.modifiedTime === lastRemote) { set('ok'); return; } // 원격도 로컬도 그대로
    dirty = false;
    const remote = f ? (await drive.getJson(f.id)).reviews ?? {} : {};
    const { merged, pulled, pushed } = mergeReviews(S.reviews, remote);
    let uploaded = 0;
    for (const { img } of pendingImages(merged)) {
      const src = await kvGet('img:' + img.id);
      if (!src) continue;
      const blob = await (await fetch(src)).blob();
      img.fileId = await drive.putBlob(`img-${img.id}`, blob, blob.type || 'image/jpeg');
      uploaded++;
    }
    if (!f || pushed || uploaded) await drive.putJson(f?.id ?? null, REVIEWS_FILE, { kind: 'okx-journal-reviews', updatedAt: Date.now(), reviews: forCloud(merged) });
    lastRemote = (await drive.find(REVIEWS_FILE))?.modifiedTime ?? null;
    replaceReviews(merged);
    C.lastSync = Date.now(); save('gLast', String(C.lastSync), true);
    set('ok', pulled || pushed || uploaded ? `받음 ${pulled} · 보냄 ${pushed}${uploaded ? ` · 이미지 ${uploaded}` : ''}` : '');
  } catch (e) {
    dirty = true;
    if (e instanceof DriveAuthError) set('expired', '연결이 만료되었습니다. 다시 연결을 누르세요.');
    else set('error', e.message);
  }
}

/** 이미지 표시용 src: 이 기기 캐시 → 없으면 Drive에서 받아 캐시. 못 구하면 null. */
export async function imageSrc(im) {
  if (im.src) return im.src;
  const c = await kvGet('img:' + im.id);
  if (c) return c;
  if (!im.fileId || !token()) return null;
  try {
    const blob = await drive.getBlob(im.fileId);
    const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    await kvPut('img:' + im.id, src);
    return src;
  } catch { return null; }
}
export function forgetImage(im) {
  kvDel('img:' + im.id);
  if (im.fileId && token()) drive.del(im.fileId).catch(() => {});
}

/** 앱 시작 시 1회: 저장 직후 3초 뒤 올리기, 화면으로 돌아오면·열려 있는 동안 1분마다 확인. */
export function startCloud() {
  setReviewHook(() => { dirty = true; clearTimeout(timer); timer = setTimeout(sync, 3000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60_000);
  if (isOn()) sync(); else set('off');
}

const LABEL = { off: '연결 안 됨', syncing: '동기화 중…', ok: '동기화됨', expired: '연결 만료', error: '오류' };
/** 짧은 상태 표시(복기 페이지·설정 공용). */
export function cloudBadge() {
  const el = h('span', { class: 'cloud-st' });
  const draw = () => {
    el.className = 'cloud-st ' + C.state;
    el.replaceChildren(`Google Drive: ${LABEL[C.state] ?? C.state}`, C.state === 'ok' && C.lastSync ? ` · ${fmtTs(C.lastSync)}` : '',
      ...(C.state === 'expired' || (C.state === 'off' && clientId()) ? [h('button', { class: 'sub small', onclick: () => { try { login(); } catch (e) { alert(e.message); } } }, C.state === 'off' ? '연결' : '다시 연결')] : []));
  };
  draw();
  const off = onCloud(() => (el.isConnected ? draw() : off()));
  return el;
}

/** 설정 탭 섹션 */
export function cloudSection() {
  const cid = h('input', { type: 'text', value: clientId(), placeholder: '1234-abc.apps.googleusercontent.com', autocomplete: 'off', style: 'width:100%' });
  cid.onchange = () => setClientId(cid.value);
  const msg = h('div', { class: 'mute small' });
  const draw = () => { msg.textContent = C.msg; };
  draw(); const off = onCloud(() => (msg.isConnected ? draw() : off()));
  return h('section', {}, h('h2', {}, '기기 간 동기화 (Google Drive)'),
    h('div', { class: 'mute' }, '복기(일지·댓글·이미지)를 내 구글 드라이브의 앱 전용 숨김 폴더에 저장해 PC·휴대폰에서 같이 봅니다. 거래 데이터는 기기마다 OKX에서 받습니다.'),
    h('label', {}, 'Google OAuth 클라이언트 ID (공개 식별자, 비밀 아님)'), cid,
    h('div', { class: 'row', style: 'margin-top:8px' }, cloudBadge(),
      isOn() ? h('button', { class: 'sub', onclick: () => sync() }, '지금 동기화') : null,
      isOn() ? h('button', { class: 'sub', onclick: logout }, '연결 해제') : h('button', { onclick: () => { setClientId(cid.value); try { login(); } catch (e) { alert(e.message); } } }, 'Google 계정 연결')),
    msg,
    h('details', {}, h('summary', { class: 'mute' }, '처음 1회 준비 (약 10분)'),
      h('ol', { class: 'small' },
        h('li', {}, 'console.cloud.google.com → 새 프로젝트 → "API 및 서비스 > 라이브러리"에서 Google Drive API 사용 설정'),
        h('li', {}, 'OAuth 동의 화면: 외부 → 앱 이름 입력 → 테스트 사용자에 내 Gmail 추가 → 범위에 .../auth/drive.appdata'),
        h('li', {}, '사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션'),
        h('li', {}, ['승인된 JavaScript 원본: ', h('code', {}, location.origin)]),
        h('li', {}, ['승인된 리디렉션 URI: ', h('code', {}, redirectUri())]),
        h('li', {}, '만든 클라이언트 ID를 위 칸에 붙여넣고 "Google 계정 연결" (다른 기기에서도 같은 ID로 연결)'))));
}
