// 문구로 말씀 찾기 (역추적) — 실제 검색은 search-worker.js 가 한다.

// 제안을 보여줄 기준 / 줄바꿈 때 바로 바꿀 기준 (실제 문구들로 맞춘 값)
const SUGGEST_SCORE = 0.6;
const SUGGEST_OBJ = 6;
const AUTO_SCORE = 0.85;
const AUTO_MARGIN = 0.1;
const AUTO_OBJ = 8;

let worker = null;
let seq = 0;
const pending = new Map();

function search(words, opts) {
  if (!worker) {
    worker = new Worker('js/search-worker.js');
    worker.onmessage = (e) => {
      pending.get(e.data.id)?.(e.data.results);
      pending.delete(e.data.id);
    };
  }
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    worker.postMessage({ id, words, ...opts });
  });
}

/** 한글 단어와 위치 */
export function tokenize(text) {
  return [...text.matchAll(/[가-힣]+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}

/** 커서 앞에서 쓰고 있는 문구에 맞는 절 (없으면 null). 앞쪽 단어 k개는 말씀이 아닐 수 있다. */
export async function suggestFor(words) {
  const [best] = await search(words, { maxTrail: 1, limit: 1 });
  return best && best.score >= SUGGEST_SCORE && best.obj >= SUGGEST_OBJ ? best : null;
}

/** 줄 전체가 확실히 한 절이면 그 절 (없으면 null) */
export async function wholeLineMatch(words) {
  if (words.length < 3) return null;
  const [best, second] = await search(words, { maxTrail: 1, fixedStart: true, limit: 2 });
  if (!best || best.score < AUTO_SCORE || best.obj < AUTO_OBJ) return null;
  if (second && second.score > best.score - AUTO_MARGIN) return null; // 비슷한 절이 여럿이면 사람이 고르게
  return best;
}

/** 말씀 찾기 창: 단어로 검색 */
export function searchPhrase(words) {
  return search(words, { minMatched: words.length > 1 ? 2 : 1, limit: 8 });
}
