// Google 로그인 + 메모 동기화 (Firebase Auth · Firestore)
// Firebase SDK는 로그인할 때만 불러온다 → 로그인 안 했거나 오프라인이어도 앱은 그대로 동작.
// 저장 위치: users/{uid}/notes/{noteId} = { title, body, created, updated, deleted }
// 충돌 처리: updated(마지막 수정 시각)가 더 최근인 쪽이 이긴다.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const SESSION = 'biblenote.sync.v1'; // 로그인한 계정 이메일 → 있으면 앱을 열 때 바로 SDK를 불러온다

let fb = null;
let loading = null;
let user = null;
let stopListening = null;
let status = 'off'; // off | loading | syncing | synced | offline | error
let h = null; // { getNotes, applyRemote, onState }

const session = {
  get: () => { try { return localStorage.getItem(SESSION) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(SESSION, v) : localStorage.removeItem(SESSION); } catch { /* 무시 */ } },
};
const savedEmail = () => (session.get().includes('@') ? session.get() : '');

function setStatus(s) {
  status = s;
  h?.onState({ status, email: user?.email ?? savedEmail() });
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
  load().catch(() => setStatus('offline'));
}

export function initSync(handlers) {
  h = handlers;
  if (session.get()) startLoad();
  window.addEventListener('online', () => {
    if (session.get() && !fb) startLoad();
  });
}

const noteRef = (id) => fb.F.doc(fb.db, 'users', user.uid, 'notes', id);
const isEmpty = (n) => !n.deleted && !n.title.trim() && !n.body.trim();

function onUser(u) {
  user = u;
  stopListening?.();
  stopListening = null;
  if (!u) {
    session.set('');
    setStatus('off');
    return;
  }
  session.set(u.email || '1');
  setStatus('syncing');

  let reconciled = false;
  const { collection, onSnapshot } = fb.F;
  stopListening = onSnapshot(
    collection(fb.db, 'users', u.uid, 'notes'),
    { includeMetadataChanges: true },
    (snap) => {
      // 캐시에서 온 결과는 서버 상태를 모르므로 비교하지 않는다 (오래된 메모로 덮어쓰기 방지)
      if (snap.metadata.fromCache) {
        if (!navigator.onLine) setStatus('offline');
        return;
      }
      const remote = new Map();
      for (const d of snap.docs) {
        const r = d.data();
        if (typeof r.updated === 'number') remote.set(d.id, r);
      }
      h.applyRemote(remote);
      if (!reconciled) {
        // 처음 연결될 때: 이 기기에만 있거나 이 기기 것이 더 최신인 메모를 올린다
        reconciled = true;
        for (const n of h.getNotes()) {
          const r = remote.get(n.id);
          if ((!r || n.updated > r.updated) && !isEmpty(n)) pushNote(n);
        }
      }
      setStatus(snap.metadata.hasPendingWrites ? 'syncing' : 'synced');
    },
    (err) => {
      console.warn('sync', err);
      setStatus('error');
    },
  );
}

/** 메모 하나를 서버에 저장 (오프라인이면 연결될 때 보내진다) */
export function pushNote(n) {
  if (!user || !fb) return;
  if (status === 'synced') setStatus('syncing');
  fb.F.setDoc(noteRef(n.id), {
    title: n.title,
    body: n.body,
    created: n.created,
    updated: n.updated,
    deleted: !!n.deleted,
  }).catch((err) => {
    console.warn('sync', err);
    setStatus('error');
  });
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
  try {
    await signInWithPopup(fb.auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      session.set('1'); // 돌아왔을 때 SDK를 불러와 로그인을 마무리하도록
      await signInWithRedirect(fb.auth, provider);
      return;
    }
    setStatus(user ? 'synced' : 'off');
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') throw err;
  }
}

export async function signOut() {
  if (fb) await fb.A.signOut(fb.auth);
}
