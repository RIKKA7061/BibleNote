// 문구로 말씀 찾기 (역추적) — 화면이 버벅이지 않도록 별도 스레드(Web Worker)에서 돈다.
//
// 받는 것: { id, words: ['하나님께서', '세상을', '사랑하사'], maxTrail, fixedStart, minMatched, limit }
//   maxTrail  : 끝에서 말씀과 안 맞는 단어를 몇 개까지 봐줄지 (번역마다 끝 단어가 다를 수 있어서)
//   fixedStart: 첫 단어부터 전부 말씀이어야 함 (줄 전체 자동 바꾸기용)
// 주는 것: { id, results: [{ b, c, v, k, score, obj }] }  (점수 높은 순)
//   k     : 몇 번째 단어부터가 말씀인지 (앞쪽 단어는 말씀과 상관없는 내 글일 수 있다)
//   score : 0~1, 문구가 그 절과 얼마나 비슷한지
//   obj   : 순위용 (맞은 단어가 많고 드문 단어일수록 큼)
//
// 방법: 한국어는 단어 끝(조사·어미)이 잘 바뀌므로 단어 앞부분이 얼마나 같은지로 비교한다.
//   하나님께서 ↔ 하나님이, 사랑하사 ↔ 사랑하사. 단어 순서를 지키고, 중간에 빠진 단어(이처럼)는 허용.
//   "하나님"처럼 아주 흔한 단어보다 "사랑하사"처럼 드문 단어가 맞을 때 점수를 더 준다.

const MERGED = /^\(\d+절에 포함되어 있음\)$/;
const MAX_CANDIDATES = 400;

let verses = null; // [{ b, c, v, text }]  text: 한글 단어만 공백으로 이은 것

const ready = fetch('../data/krv.json')
  .then((r) => r.json())
  .then((bible) => {
    verses = [];
    bible.forEach((book, b) => book.forEach((chap, c) => chap.forEach((t, v) => {
      if (!MERGED.test(t)) verses.push({ b, c: c + 1, v: v + 1, text: (t.match(/[가-힣]+/g) || []).join(' ') });
    })));
  });

/** 두 단어가 얼마나 같은지 (앞에서부터 같은 글자 수 기준, 0~1) */
function sim(a, b) {
  if (a === b) return 1;
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a[p] === b[p]) p++;
  if (p === 0 || (p === 1 && n > 1)) return 0;
  return (p / a.length + p / b.length) / 2;
}

// 단어 앞 두 글자 → { w: 가중치, idx: 그 글자가 들어 있는 절 번호들 }
const stemCache = new Map();
function stemInfo(stem) {
  let info = stemCache.get(stem);
  if (!info) {
    const idx = [];
    for (let j = 0; j < verses.length; j++) if (verses[j].text.includes(stem)) idx.push(j);
    info = { w: Math.min(6, Math.log((verses.length + 1) / (idx.length + 1))), idx };
    if (stemCache.size > 300) stemCache.clear();
    stemCache.set(stem, info);
  }
  return info;
}

function search({ words, maxTrail = Infinity, fixedStart = false, minMatched = 2, limit = 5 }) {
  const n = words.length;
  if (!n) return [];

  // 1) 각 단어의 가중치 + 후보 절 고르기 (단어 앞 두 글자가 들어 있는 절)
  const weights = new Array(n);
  const hitW = new Float64Array(verses.length);
  const hitC = new Uint8Array(verses.length);
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    if (words[i].length < 2) {
      weights[i] = 0.5; // 한 글자 단어(곧, 내, 그…)는 거의 의미 없음
      continue;
    }
    const stem = words[i].slice(0, 2);
    const info = stemInfo(stem);
    weights[i] = info.w;
    if (seen.has(stem)) continue;
    seen.add(stem);
    for (const j of info.idx) {
      hitW[j] += info.w;
      hitC[j]++;
    }
  }
  const need = Math.min(minMatched, seen.size);
  if (!need) return [];
  let cand = [];
  for (let j = 0; j < verses.length; j++) if (hitC[j] >= need) cand.push(j);
  if (cand.length > MAX_CANDIDATES) {
    cand.sort((a, b) => hitW[b] - hitW[a]);
    cand = cand.slice(0, MAX_CANDIDATES);
  }

  const tot = new Float64Array(n + 1); // tot[k] = k번째 이후 단어 가중치 합
  for (let i = n - 1; i >= 0; i--) tot[i] = tot[i + 1] + weights[i];

  // 2) 후보마다 단어 순서를 지키는 최선의 짝짓기 (뒤에서부터 계산 → 모든 시작점 k를 한 번에)
  const results = [];
  for (const j of cand) {
    const vw = verses[j].text.split(' ');
    const m = vw.length;
    const W = m + 1;
    const S = new Float64Array(n * m);
    for (let i = 0; i < n; i++) for (let x = 0; x < m; x++) S[i * m + x] = sim(words[i], vw[x]);
    const E = new Float64Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let x = m - 1; x >= 0; x--) {
        let best = Math.max(E[(i + 1) * W + x], E[i * W + x + 1]);
        const s = S[i * m + x];
        if (s >= 0.5) best = Math.max(best, E[(i + 1) * W + x + 1] + weights[i] * s);
        E[i * W + x] = best;
      }
    }

    let k = -1;
    let bestObj = 0;
    for (let s = 0; s <= (fixedStart ? 0 : n - 1); s++) {
      const matched = E[s * W];
      const obj = (matched * matched) / tot[s];
      if (obj > bestObj + 1e-9) {
        bestObj = obj;
        k = s;
      }
    }
    if (k < 0) continue;

    // 어떤 단어끼리 짝지어졌는지 되짚기
    const pairs = [];
    for (let i = k, x = 0; i < n && x < m;) {
      const s = S[i * m + x];
      const here = E[i * W + x];
      if (s >= 0.5 && Math.abs(here - (E[(i + 1) * W + x + 1] + weights[i] * s)) < 1e-9) {
        pairs.push([i, x]);
        i++;
        x++;
      } else if (Math.abs(here - E[(i + 1) * W + x]) < 1e-9) i++;
      else x++;
    }
    const c = pairs.length;
    if (c < minMatched) continue;
    if (n - 1 - pairs[c - 1][0] > maxTrail) continue;

    // 짝지어진 말씀 단어들이 절 안에서 너무 흩어져 있으면 감점
    const span = pairs[c - 1][1] - pairs[0][1] + 1;
    const penalty = Math.min(1, (c + 3) / span);
    const matched = E[k * W];
    // 문구와 길이가 비슷한 절(예: "항상 기뻐하라")을 살짝 우대
    const score = (matched / tot[k]) * penalty + 0.03 * (c / m);
    const { b, c: ch, v } = verses[j];
    results.push({ b, c: ch, v, k, score, obj: matched * score });
  }
  results.sort((a, b) => b.obj - a.obj);
  return results.slice(0, limit);
}

self.onmessage = async (e) => {
  const { id } = e.data;
  try {
    await ready;
    self.postMessage({ id, results: search(e.data) });
  } catch (err) {
    self.postMessage({ id, results: [], error: String(err) });
  }
};
