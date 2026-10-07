// Google 로그인 + 동기화 (Firebase Auth · Firestore)
// Firebase SDK는 로그인할 때만 불러온다 → 로그인 안 했거나 오프라인이어도 앱은 그대로 동작.
//
// 저장 위치
//   users/{uid}/notes/{id}  메모      { title, body, created, updated, deleted }
//   users/{uid}/todos/{id}  할일      { text, done, doneAt, day, routine, carried, created, updated, deleted }
//   users/{uid}/meta/todo   할일 설정·기록 { resetAt, routines{}, history{}, days{} }  (항목별로 합쳐서 저장)
// 충돌 처리: updated(마지막 수정 시각)가 더 최근인 쪽이 이긴다.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const SESSION = 'biblenote.sync.v1'; // 로그인한 계정 이메일 → 있으면 앱을 열 때 바로 SDK를 불러온다
const DAY = 86400000;

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

function load() {
  loading ??= Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]).then(([{ initializeApp }, A, F]) => {
    const app = initializeApp(firebaseConfig);
    fb = { auth: A.getAuth(app), db: F.getFirestore(app), A, F };
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

export function initSync(handlers) {
  h = handlers;
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
