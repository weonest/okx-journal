// 기기 간 복기 동기화: 내 드라이브의 "OKX Journal" 폴더(drive.file: 이 앱이 만든 파일만). 예전 숨김 폴더(appDataFolder) 데이터는 첫 동기화 때 옮긴다.
// 외부 스크립트 없이 OAuth 리다이렉트(토큰 방식)로 로그인한다.
// 토큰은 키와 같은 규칙으로 저장한다(기본 sessionStorage, "이 기기에 기억"이면 localStorage). 화면·로그에 출력하지 않는다.
import { h, fmtTs } from './dom.js';
import { S, save, load, isRemembering, setReviewHook, replaceReviews, kvGet, kvPut, kvDel, setDataHook, dataSnapshot, replaceData } from './store.js';
import { createDrive, mergeReviews, forCloud, pendingImages, imageName, mergeData, hasData, ROOT_NAME, IMG_DIR, REVIEWS_FILE, DATA_FILE, DriveAuthError } from '../core/drive.js';
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APPDATA = 'https://www.googleapis.com/auth/drive.appdata'; // 예전 숨김 폴더: 이미 허용된 경우에만 옮겨 온다
const ON = 'okx.gdrive'; // 연결을 켠 기기 표시(비밀 아님)
const safe = (f) => { try { return f(); } catch { return null; } };

export const C = { state: 'off', msg: '', lastSync: Number(load('gLast')) || null, folderId: load('gFolder') || null };
const subs = new Set();
export const onCloud = (f) => (subs.add(f), () => subs.delete(f));
const set = (state, msg = '') => { C.state = state; C.msg = msg; subs.forEach((f) => f()); };

export const redirectUri = () => location.origin + location.pathname;
export const clientId = () => load('gcid') || GOOGLE_CLIENT_ID;
export const setClientId = (v) => save('gcid', v.trim(), true);
export const isOn = () => safe(() => localStorage.getItem(ON) === '1') === true;

const tok = () => safe(() => JSON.parse(load('gtok')));
function token() {
  const j = tok();
  return j && j.exp > Date.now() ? j.t : null;
}
/** 로그인 때 실제로 받은 권한(scope 없으면 예전 토큰 → 모름) */
const granted = (s) => (tok()?.scope ?? '').split(' ').includes(s);
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
  save('gtok', JSON.stringify({ t: p.get('access_token'), exp, scope: p.get('scope') ?? '' }), isRemembering());
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
let running = null, again = false, dirty = false, lastRemote = null, timer = null, dirs = null, dataDirty = false, lastRemoteData = null;
export function sync() {
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; if (again) { again = false; sync(); } });
  return running;
}
async function folders() {
  if (dirs) return dirs;
  const root = await drive.ensureFolder('root', ROOT_NAME, 'root');
  dirs = { root, img: await drive.ensureFolder('images', IMG_DIR, root) };
  if (C.folderId !== root) { C.folderId = root; save('gFolder', root, true); }
  return dirs;
}
const META = {
  reviews: (root) => ({ name: REVIEWS_FILE, parents: [root], mimeType: 'application/json', appProperties: { okxj: 'reviews' } }),
  data: (root) => ({ name: DATA_FILE, parents: [root], mimeType: 'application/json', appProperties: { okxj: 'data' } }),
};

/** 새 폴더에 아직 reviews.json이 없을 때 1회: 예전 숨김 폴더의 복기를 가져오고, 이미지는 이 기기에 받아 둔 뒤 새 폴더로 다시 올리게 한다. */
async function fromLegacy(local) {
  let old = {};
  if (!granted(APPDATA)) return local;
  try { const f = await drive.findAppData(REVIEWS_FILE); if (f) old = (await drive.getJson(f.id)).reviews ?? {}; } catch (e) { if (e instanceof DriveAuthError) throw e; }
  const { merged } = mergeReviews(local, old);
  for (const r of Object.values(merged)) for (const im of r.images ?? []) {
    if (!im.fileId) continue;
    if (!(await kvGet('img:' + im.id))) { const src = await download(im.fileId); if (!src) continue; await kvPut('img:' + im.id, src); }
    im.fileId = null; // 새 폴더로 다시 올린다
  }
  return merged;
}

async function run() {
  if (S.sample || !isOn()) return;
  if (!token()) { set('expired', '연결이 만료되었습니다. 다시 연결을 누르세요(변경분은 이 기기에 남아 있다가 연결되면 올라갑니다).'); return; }
  if (!granted(SCOPE)) { set('expired', '드라이브 폴더 권한이 없습니다. "다시 연결"을 누르고 구글 화면에서 권한을 모두 허용하세요.'); return; }
  set('syncing');
  try {
    const d = await folders();
    const msgs = [await syncReviews(d), await syncData(d)].filter(Boolean);
    C.lastSync = Date.now(); save('gLast', String(C.lastSync), true);
    set('ok', msgs.join(' · '));
  } catch (e) {
    dirs = null; // 폴더를 휴지통에 넣은 경우 등: 다음에 다시 찾는다
    if (e instanceof DriveAuthError) set('expired', e.scope ? '드라이브 폴더 권한이 없습니다. "다시 연결"을 누르고 구글 화면에서 권한을 모두 허용하세요.' : '연결이 만료되었습니다. 다시 연결을 누르세요.');
    else set('error', e.message);
  }
}

/** 복기: 거래별 병합(최근 수정 우선) → 새 이미지 올리기 → 바뀌었으면 올리기 */
async function syncReviews(d) {
  const f = await drive.findTagged('reviews');
  if (f && !dirty && f.modifiedTime === lastRemote) return ''; // 원격도 로컬도 그대로
  dirty = false;
  try {
    const local = f ? S.reviews : await fromLegacy(S.reviews);
    const remote = f ? (await drive.getJson(f.id)).reviews ?? {} : {};
    const { merged, pulled, pushed } = mergeReviews(local, remote);
    let uploaded = 0;
    for (const { tradeId, img } of pendingImages(merged)) {
      const src = await kvGet('img:' + img.id);
      if (!src) continue;
      const blob = await (await fetch(src)).blob();
      img.fileId = await drive.putBlob({ name: imageName(tradeId, img), parents: [d.img], appProperties: { okxj: 'image' } }, blob, blob.type || 'image/jpeg');
      uploaded++;
    }
    if (!f || pushed || uploaded) await drive.putJson(f?.id ?? null, META.reviews(d.root), { kind: 'okx-journal-reviews', updatedAt: Date.now(), reviews: forCloud(merged) });
    lastRemote = (await drive.findTagged('reviews'))?.modifiedTime ?? null;
    replaceReviews(merged);
    return pulled || pushed || uploaded ? `복기 받음 ${pulled} · 보냄 ${pushed}${uploaded ? ` · 이미지 ${uploaded}` : ''}` : '';
  } catch (e) { dirty = true; throw e; }
}

/** 거래 데이터(OKX 동기화·CSV): 기본키로 누적 병합 → 바뀐 쪽 반영 */
async function syncData(d) {
  const f = await drive.findTagged('data');
  if (f && !dataDirty && f.modifiedTime === lastRemoteData) return '';
  dataDirty = false;
  try {
    const local = dataSnapshot();
    if (!f && !hasData(local)) return '';
    const remote = f ? await drive.getJson(f.id) : null;
    const { data, push, pull } = mergeData(local, remote);
    if (!f || push) await drive.putJson(f?.id ?? null, META.data(d.root), { kind: 'okx-journal-data', updatedAt: Date.now(), ...data }, false);
    lastRemoteData = (await drive.findTagged('data'))?.modifiedTime ?? null;
    if (pull) replaceData(data);
    return pull || push ? `거래 데이터 ${pull ? '받음' : ''}${pull && push ? '·' : ''}${push ? '보냄' : ''}` : '';
  } catch (e) { dataDirty = true; throw e; }
}

async function download(fileId) {
  try {
    const blob = await drive.getBlob(fileId);
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  } catch { return null; }
}

/** 이미지 표시용 src: 이 기기 캐시 → 없으면 Drive에서 받아 캐시. 못 구하면 null. */
export async function imageSrc(im) {
  if (im.src) return im.src;
  const c = await kvGet('img:' + im.id);
  if (c) return c;
  if (!im.fileId || !token()) return null;
  const src = await download(im.fileId);
  if (src) await kvPut('img:' + im.id, src);
  return src;
}
export function forgetImage(im) {
  kvDel('img:' + im.id);
  if (im.fileId && token()) drive.del(im.fileId).catch(() => {});
}

/** 앱 시작 시 1회: 저장 직후 3초 뒤 올리기, 화면으로 돌아오면·열려 있는 동안 1분마다 확인. */
export function startCloud() {
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 3000); };
  setReviewHook(() => { dirty = true; soon(); });
  setDataHook(() => { dataDirty = true; soon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60_000);
  if (isOn()) sync(); else set('off');
}

const LABEL = { off: '연결 안 됨', syncing: '동기화 중…', ok: '동기화됨', expired: '다시 연결 필요', error: '오류' };
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
    h('div', { class: 'mute' }, '복기(일지·댓글·이미지)와 OKX에서 받은 거래 데이터를 내 드라이브의 "OKX Journal" 폴더에 저장해 PC·휴대폰에서 같이 봅니다. 한 기기에서 OKX 동기화를 하면 다른 기기는 키 없이 열어도 됩니다. 이 앱은 자기가 만든 파일만 볼 수 있습니다.'),
    C.folderId ? h('a', { href: 'https://drive.google.com/drive/folders/' + C.folderId, target: '_blank', rel: 'noopener', style: 'color:var(--acc)' }, '드라이브에서 폴더 열기') : null,
    h('label', {}, 'Google OAuth 클라이언트 ID (공개 식별자, 비밀 아님)'), cid,
    h('div', { class: 'row', style: 'margin-top:8px' }, cloudBadge(),
      isOn() ? h('button', { class: 'sub', onclick: () => sync() }, '지금 동기화') : null,
      isOn() ? h('button', { class: 'sub', onclick: logout }, '연결 해제') : h('button', { onclick: () => { setClientId(cid.value); try { login(); } catch (e) { alert(e.message); } } }, 'Google 계정 연결')),
    msg,
    h('details', {}, h('summary', { class: 'mute' }, '처음 1회 준비 (약 10분)'),
      h('ol', { class: 'small' },
        h('li', {}, 'console.cloud.google.com → 새 프로젝트 → "API 및 서비스 > 라이브러리"에서 Google Drive API 사용 설정'),
        h('li', {}, 'OAuth 동의 화면: 외부 → 앱 이름 입력 → 테스트 사용자에 내 Gmail 추가 → 범위에 .../auth/drive.file (예전 숨김 폴더를 쓰던 경우 .../auth/drive.appdata도)'),
        h('li', {}, '사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션'),
        h('li', {}, ['승인된 JavaScript 원본: ', h('code', {}, location.origin)]),
        h('li', {}, ['승인된 리디렉션 URI: ', h('code', {}, redirectUri())]),
        h('li', {}, '만든 클라이언트 ID를 위 칸에 붙여넣고 "Google 계정 연결" (다른 기기에서도 같은 ID로 연결)'))));
}
