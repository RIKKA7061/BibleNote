// Google 로그인 + 동기화 (Firebase Auth · Firestore)
// Firebase SDK는 로그인할 때만 불러온다 → 로그인 안 했거나 오프라인이어도 앱은 그대로 동작.
//
// 저장 위치
//   users/{uid}/notes/{id}  메모      { title, body, created, updated, deleted }
//   users/{uid}/todos/{id}  할일      { text, done, doneAt, day, routine, carried, created, updated, deleted }
//   users/{uid}/meta/todo   할일 설정·기록 { resetAt, routines{}, history{}, days{} }  (항목별로 합쳐서 저장)
// 충돌 처리: updated(마지막 수정 시각)가 더 최근인 쪽이 이긴다.
import { firebaseConfig, googleClientId } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const SESSION = 'biblenote.sync.v1'; // 로그인한 계정 이메일 → 있으면 앱을 열 때 바로 SDK를 불러온다
const OAUTH_STATE = 'biblenote.oauth.v1';
const DAY = 86400000;

// 아이폰(사파리·홈 화면 앱)은 Firebase 팝업 로그인이 막힌다 (다른 사이트 저장공간 차단, 홈 화면 앱은 팝업이 결과를 못 돌려줌).
// 그래서 아이폰에서는 구글 로그인 페이지로 직접 갔다가 이 앱 주소로 돌아오는 방식을 쓴다.
const REDIRECT_LOGIN = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || new URLSearchParams(location.search).has('redirect-login');

// 서버에 저장할 필드 (firestore.rules 와 같아야 한다) + 삭제 표시를 서버에서 지울 때까지의 기간
const COLLECTIONS = {
  notes: {
    fields: (n) => ({ title: n.title, body: n.body, created: n.created, updated: n.updated, deleted: !!n.deleted }),
    purgeDays: 30,
  },
  todos: {
    fields: (t) => ({
      text: t.text,
      done: !!t.done,
      doneAt: t.doneAt || 0,
      day: t.day,
      routine: t.routine || '',
      carried: t.carried || 0,
      created: t.created,
      updated: t.updated,
      deleted: !!t.deleted,
    }),
    purgeDays: 7,
  },
};

let fb = null;
let loading = null;
let user = null;
let stops = [];
let status = 'off'; // off | loading | syncing | synced | offline | error
let h = null; // { collections: { notes: { get, apply }, todos: {...} }, meta: { merge, apply }, onState }
const streams = new Map(); // 실시간 연결별 상태 { server, pending }

let readyDone = () => {};
let ready = Promise.resolve();
function resetReady() {
  ready = new Promise((r) => { readyDone = r; });
}

const session = {
  get: () => { try { return localStorage.getItem(SESSION) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(SESSION, v) : localStorage.removeItem(SESSION); } catch { /* 무시 */ } },
};
const savedEmail = () => (session.get().includes('@') ? session.get() : '');

function setStatus(s) {
  status = s;
  h?.onState({ status, email: user?.email ?? savedEmail() });
}

function onError(err) {
  console.warn('sync', err);
  setStatus('error');
}

let redirectToken = null; // 구글 로그인 페이지에서 돌아오며 받은 토큰

function load() {
  loading ??= Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]).then(async ([{ initializeApp }, A, F]) => {
    const app = initializeApp(firebaseConfig);
    fb = { auth: A.getAuth(app), db: F.getFirestore(app), A, F };
    if (redirectToken) {
      const token = redirectToken;
      redirectToken = null;
      try {
        await A.signInWithCredential(fb.auth, A.GoogleAuthProvider.credential(null, token));
      } catch (err) {
        console.warn('sync', err);
        h?.notify?.('로그인하지 못했어요. 다시 시도해 주세요');
      }
    }
    A.onAuthStateChanged(fb.auth, onUser);
    return fb;
  }).catch((err) => {
    loading = null; // 오프라인이면 나중에 다시 시도
    throw err;
  });
  return loading;
}

function startLoad() {
  setStatus('loading');
  load().catch(() => {
    setStatus('offline');
    readyDone();
  });
}

/** 구글 로그인 페이지에서 돌아왔으면 주소 뒤(#access_token=…)에서 토큰을 꺼내고 주소를 깨끗이 지운다 */
function takeRedirectResult() {
  const hash = location.hash;
  if (!/[#&](access_token|error)=/.test(hash)) return;
  const p = new URLSearchParams(hash.slice(1));
  history.replaceState(history.state, '', location.pathname + location.search);
  let expected = '';
  try {
    expected = localStorage.getItem(OAUTH_STATE) || '';
    localStorage.removeItem(OAUTH_STATE);
  } catch { /* 무시 */ }
  if (p.get('access_token') && expected && p.get('state') === expected) {
    redirectToken = p.get('access_token');
    session.set('1');
  } else {
    session.set('');
    if (p.get('error') !== 'access_denied') h.notify?.('로그인하지 못했어요. 다시 시도해 주세요');
  }
}

function redirectToGoogle() {
  const state = crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`.replace('.', '');
  try {
    localStorage.setItem(OAUTH_STATE, state);
  } catch { /* 무시 */ }
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ''), // 콘솔에 등록한 주소와 같아야 한다
    response_type: 'token',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export function initSync(handlers) {
  h = handlers;
  takeRedirectResult();
  if (session.get()) {
    resetReady();
    startLoad();
  }
  window.addEventListener('online', () => {
    if (session.get() && !fb) startLoad();
  });
}

/** 로그인 상태면 서버 내용을 처음 받아올 때까지 기다린다 (최대 timeout) */
export function whenSynced(timeout = 5000) {
  return Promise.race([ready, new Promise((r) => setTimeout(r, timeout))]);
}

function refreshStatus() {
  const all = [...streams.values()];
  if (all.some((s) => !s.server)) setStatus(navigator.onLine ? 'syncing' : 'offline');
  else setStatus(all.some((s) => s.pending) ? 'syncing' : 'synced');
}

const isBlank = (x) => !x.deleted && !['title', 'body', 'text'].some((k) => (x[k] || '').trim());

function listenCollection(uid, name, onFirst) {
  let reconciled = false;
  const { collection, onSnapshot, doc, deleteDoc } = fb.F;
  return onSnapshot(
    collection(fb.db, 'users', uid, name),
    { includeMetadataChanges: true },
    (snap) => {
      streams.set(name, { server: !snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      // 캐시에서 온 결과는 서버 상태를 모르므로 비교하지 않는다 (오래된 것으로 덮어쓰기 방지)
      if (!snap.metadata.fromCache) {
        const remote = new Map();
        for (const d of snap.docs) {
          const r = d.data();
          if (typeof r.updated === 'number') remote.set(d.id, r);
        }
        h.collections[name].apply(remote);
        if (!reconciled) {
          // 처음 연결될 때: 이 기기에만 있거나 이 기기 것이 더 최신인 것을 올린다
          reconciled = true;
          for (const item of h.collections[name].get()) {
            const r = remote.get(item.id);
            if ((!r || item.updated > r.updated) && !isBlank(item)) push(name, item);
          }
          // 오래된 삭제 표시는 서버에서 아주 지운다 (매번 읽는 양을 줄이려고)
          const cutoff = Date.now() - COLLECTIONS[name].purgeDays * DAY;
          for (const [id, r] of remote) {
            if (r.deleted && r.updated < cutoff) deleteDoc(doc(fb.db, 'users', uid, name, id)).catch(() => {});
          }
          onFirst();
        }
      }
      refreshStatus();
    },
    onError,
  );
}

const metaRef = () => fb.F.doc(fb.db, 'users', user.uid, 'meta', 'todo');

function listenMeta(onFirst) {
  let reconciled = false;
  return fb.F.onSnapshot(
    metaRef(),
    { includeMetadataChanges: true },
    (snap) => {
      streams.set('meta', { server: !snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      if (!snap.metadata.fromCache) {
        const remote = snap.exists() ? snap.data() : {};
        if (!reconciled) {
          // 처음 연결될 때: 이 기기 기록과 서버 기록을 합쳐서 양쪽을 맞춘다
          reconciled = true;
          const merged = h.meta.merge(remote);
          fb.F.setDoc(metaRef(), merged, { merge: true }).catch(onError);
          h.meta.apply(merged);
          onFirst();
        } else {
          h.meta.apply(remote);
        }
      }
      refreshStatus();
    },
    onError,
  );
}

function onUser(u) {
  user = u;
  for (const stop of stops) stop();
  stops = [];
  streams.clear();
  if (!u) {
    session.set('');
    setStatus('off');
    readyDone();
    return;
  }
  session.set(u.email || '1');
  setStatus('syncing');

  const names = [...Object.keys(h.collections), 'meta'];
  const waiting = new Set(names);
  const first = (name) => {
    waiting.delete(name);
    if (!waiting.size) readyDone();
  };
  for (const name of Object.keys(h.collections)) stops.push(listenCollection(u.uid, name, () => first(name)));
  stops.push(listenMeta(() => first('meta')));
}

/** 메모·할일 하나를 서버에 저장 (오프라인이면 연결될 때 보내진다) */
export function push(name, item) {
  if (!user || !fb) return;
  fb.F.setDoc(fb.F.doc(fb.db, 'users', user.uid, name, item.id), COLLECTIONS[name].fields(item)).catch(onError);
}

/** 할일 설정·기록 일부만 저장. deletions: [['history', key], ...] 는 서버에서 지운다 */
export function pushMeta(partial, deletions = []) {
  if (!user || !fb) return;
  const data = JSON.parse(JSON.stringify(partial));
  for (const [field, key] of deletions) (data[field] ??= {})[key] = fb.F.deleteField();
  fb.F.setDoc(metaRef(), data, { merge: true }).catch(onError);
}

export async function signIn() {
  if (REDIRECT_LOGIN) {
    setStatus('loading');
    redirectToGoogle(); // 페이지를 떠났다가 로그인 후 돌아온다
    return;
  }
  setStatus('loading');
  try {
    await load();
  } catch {
    setStatus('offline');
    throw new Error('offline');
  }
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = fb.A;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  resetReady();
  try {
    await signInWithPopup(fb.auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      session.set('1'); // 돌아왔을 때 SDK를 불러와 로그인을 마무리하도록
      await signInWithRedirect(fb.auth, provider);
      return;
    }
    setStatus(user ? 'synced' : 'off');
    readyDone();
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') throw err;
  }
}

export async function signOut() {
  if (fb) await fb.A.signOut(fb.auth);
}
