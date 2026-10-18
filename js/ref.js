// 성경 구절 표기 인식 · 본문 찾기
// 인식하는 형식:  요한복음1:12 · 요 1:12 · 요 3:16-18 · 롬 8:28~30 · 요 3:16,18
//                 창 1:1-2:3 · 요한복음 1장 12절 · 시편 23편 1-6절
//                 책 이름 오타도 확실하면 알아본다: 애레미야 3:22 → 예레미야
import { BOOKS } from './books.js';
import { jamo } from './hangul.js';

const ALIAS = new Map();
BOOKS.forEach((names, i) => names.forEach((n) => ALIAS.set(n, i)));

// 오타 교정 후보: 세 글자 이상인 책 이름 (짧은 이름은 오타로 보기엔 다른 낱말과 너무 쉽게 겹친다)
const FUZZY = [];
BOOKS.forEach((names, i) => names.forEach((n) => {
  if (n.length >= 3 && !/\d/.test(n)) FUZZY.push({ i, n, j: jamo(n) });
}));

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 오타가 있는 책 이름 → 책 번호. 자모 1~2개만 다르고 후보가 하나일 때만 (예: 애레미야 → 예레미야) */
function fuzzyBook(word) {
  if (word.length < 3) return -1;
  const j = jamo(word);
  const limit = word.length >= 4 ? 2 : 1;
  let best = -1;
  let bestD = limit + 1;
  let tie = false;
  for (const f of FUZZY) {
    if (Math.abs(f.n.length - word.length) > 1) continue;
    const d = editDistance(j, f.j, limit);
    if (d < bestD) {
      bestD = d;
      best = f.i;
      tie = false;
    } else if (d === bestD && f.i !== best) {
      tie = true;
    }
  }
  return best >= 0 && !tie ? best : -1;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOOK = `(${[...ALIAS.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})`;
const S = '[ \\t\\u00a0]*';
const N = '\\d{1,3}';
const DASH = `${S}[-~–—]${S}`;
const PART = `${N}(?:${DASH}(?:${N}${S}:${S})?${N})?`;
const COLON = `(${N})${S}:${S}(${PART}(?:${S},${S}${PART})*)`;
const JANG = `(${N})${S}[장편]${S}(${N}(?:${DASH}${N})?)${S}절`;
// 책 이름 바로 앞이 한글·영문·숫자면 안 된다 ("월요일 3:10"의 "요일"을 요한일서로 보지 않게).
// 그 앞 글자를 첫 번째 묶음으로 잡는다 (예전 아이폰은 (?<!…) 문법을 못 읽어서 이렇게 한다).
const SRC = `(^|[^가-힣A-Za-z0-9])${BOOK}${S}(?:${COLON}|${JANG})`;
// 오타 난 책 이름용: 장·절 앞의 한글 낱말을 통째로 잡아서 fuzzyBook 으로 판단
const FUZZY_SRC = `(^|[^가-힣A-Za-z0-9])([가-힣]{3,8})${S}(?:${COLON}|${JANG})`;

const AT_END = [new RegExp(`${SRC}$`), new RegExp(`${FUZZY_SRC}$`)];
const WHOLE = [new RegExp(`^\\s*${SRC}\\s*$`), new RegExp(`^\\s*${FUZZY_SRC}\\s*$`)];
const MERGED = /^\((\d+)절에 포함되어 있음\)$/;

/** 정확한 이름 → 오타 교정 순으로 시도해 맞는 구절 하나 */
function firstRef(regexes, text) {
  for (const re of regexes) {
    const m = re.exec(text);
    const ref = m && toRef(m);
    if (ref) return { m, ref };
  }
  return null;
}

function toRef(m) {
  const book = ALIAS.get(m[2]) ?? fuzzyBook(m[2]);
  if (book === undefined || book < 0) return null;
  const parts = [];
  let spec;
  if (m[3] !== undefined) {
    const ch = +m[3];
    for (const p of m[4].split(',')) {
      const [, v1, c2, v2] = p.trim().match(/^(\d+)(?:\s*[-~–—]\s*(?:(\d+)\s*:\s*)?(\d+))?$/);
      parts.push({ c1: ch, v1: +v1, c2: c2 ? +c2 : ch, v2: v2 ? +v2 : +v1 });
    }
    spec = `${ch}:${m[4].replace(/\s+/g, '').replace(/[~–—]/g, '-').replace(/,/g, ', ')}`;
  } else {
    const ch = +m[5];
    const [, v1, v2] = m[6].match(/^(\d+)(?:\s*[-~–—]\s*(\d+))?$/);
    parts.push({ c1: ch, v1: +v1, c2: ch, v2: v2 ? +v2 : +v1 });
    spec = `${ch}:${v1}${v2 ? '-' + v2 : ''}`;
  }
  const offset = m[0].indexOf(m[2], m[1].length); // 일치한 글 안에서 책 이름이 시작하는 곳
  const raw = m[0].slice(offset).trimEnd();
  // full: 책 이름만 정식 이름으로 바꾼 표기 (요1:14 → 요한복음1:14, 애레미야 3:22 → 예레미야 3:22)
  return { book, parts, label: `${BOOKS[book][0]} ${spec}`, raw, full: BOOKS[book][0] + raw.slice(m[2].length), offset };
}

/** text 끝에 붙어 있는 구절 표기를 찾는다. 예: "오늘 말씀은 요 3:16" → 요 3:16 */
export function refAtEnd(text) {
  const hit = firstRef(AT_END, text);
  return hit && { ...hit.ref, index: hit.m.index + hit.ref.offset };
}

/** 입력 전체가 하나의 구절 표기인지 (말씀 검색창용) */
export function parseRef(text) {
  return firstRef(WHOLE, text)?.ref ?? null;
}

/** line 안에서 col 위치(커서)를 포함하는 구절 표기 */
export function refAround(line, col) {
  for (const src of [SRC, FUZZY_SRC]) {
    for (const m of line.matchAll(new RegExp(src, 'g'))) {
      const ref = toRef(m);
      if (!ref) continue;
      const start = m.index + ref.offset;
      const end = start + ref.raw.length;
      if (col >= start && col <= end) return { ...ref, start, end };
    }
  }
  return null;
}

/** text 안에서 마지막으로 나온 구절 표기 ("3절"처럼 책·장 없이 쓴 절이 어느 말씀인지 알아낼 때) */
export function lastRef(text) {
  let last = null;
  for (const src of [SRC, FUZZY_SRC]) {
    for (const m of text.matchAll(new RegExp(src, 'g'))) {
      const ref = toRef(m);
      if (ref && (!last || m.index > last.index)) last = { ...ref, index: m.index };
    }
  }
  return last;
}

// "3절", "3-5절", "4장 2절"처럼 책 이름 없이 쓴 절
const SHORT = /(^|[^가-힣A-Za-z0-9:~\-–—])(?:(\d{1,3})[ \t]*장[ \t]*)?(\d{1,3})(?:[ \t]*[-~–—][ \t]*(\d{1,3}))?[ \t]*절/g;

/** line 안에서 col 위치를 포함하는 "N절" 표기 → { chapter(없을 수 있음), v1, v2, start, end } */
export function shortRefAround(line, col) {
  for (const m of line.matchAll(SHORT)) {
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    if (col >= start && col <= end) {
      const v1 = +m[3];
      const v2 = m[4] ? +m[4] : v1;
      return { chapter: m[2] ? +m[2] : 0, v1, v2, start, end };
    }
  }
  return null;
}

/** "N절" + 앞에 나온 구절(책·장) → 찾을 수 있는 구절 */
export function contextRef(short, prev) {
  const last = prev.parts[prev.parts.length - 1];
  const c = short.chapter || last.c2;
  const spec = `${c}:${short.v1}${short.v2 !== short.v1 ? `-${short.v2}` : ''}`;
  return { book: prev.book, parts: [{ c1: c, v1: short.v1, c2: c, v2: short.v2 }], label: `${BOOKS[prev.book][0]} ${spec}` };
}

/** 본문 찾기. 없는 장·절이면 null */
export function lookup(bible, ref) {
  const book = bible[ref.book];
  const out = [];
  const seen = new Set();
  for (const { c1, v1, c2, v2 } of ref.parts) {
    if (c2 < c1 || (c2 === c1 && v2 < v1)) return null;
    for (let c = c1; c <= c2; c++) {
      const chap = book[c - 1];
      if (!chap) return null;
      const from = c === c1 ? v1 : 1;
      const to = c === c2 ? v2 : chap.length;
      if (from < 1 || to > chap.length) return null;
      for (let v = from; v <= to; v++) {
        let verse = v;
        let text = chap[v - 1];
        // 개역한글에는 "(18절에 포함되어 있음)"처럼 앞 절과 합쳐진 절이 있다 → 합쳐진 절로 대체
        const merged = MERGED.exec(text);
        if (merged) {
          verse = +merged[1];
          text = chap[verse - 1];
        }
        const key = `${c}:${verse}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ c, v: verse, text });
        }
      }
    }
  }
  return out.length ? out : null;
}

/** 괄호 안에 넣을 본문 문자열 */
export function formatVerses(verses, { numbers = true } = {}) {
  if (verses.length === 1) return verses[0].text;
  const multiChapter = verses.some((v) => v.c !== verses[0].c);
  return verses
    .map((v) => (numbers ? `${multiChapter ? `${v.c}:${v.v}` : v.v} ` : '') + v.text)
    .join(' ');
}
