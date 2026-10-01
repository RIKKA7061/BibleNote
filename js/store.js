// 메모·설정 저장 (기기 브라우저의 localStorage)
const NOTES_KEY = 'biblenote.notes.v1';
const SETTINGS_KEY = 'biblenote.settings.v1';

// auto: 구절 쓰면 말씀 넣기 · numbers: 여러 절 번호 · phrase: 문구로 말씀 제안 · phraseAuto: 줄 전체가 말씀이면 바로 바꾸기
const DEFAULT_SETTINGS = { auto: true, numbers: true, phrase: true, phraseAuto: true };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadNotes = () => read(NOTES_KEY, []);
export const saveNotes = (notes) => write(NOTES_KEY, notes);
export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) });
export const saveSettings = (s) => write(SETTINGS_KEY, s);

/** 브라우저가 저장공간을 임의로 비우지 않도록 요청 */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
