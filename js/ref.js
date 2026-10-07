// 성경 구절 표기 인식 · 본문 찾기
// 인식하는 형식:  요한복음1:12 · 요 1:12 · 요 3:16-18 · 롬 8:28~30 · 요 3:16,18
//                 창 1:1-2:3 · 요한복음 1장 12절 · 시편 23편 1-6절
import { BOOKS } from './books.js';

const ALIAS = new Map();
BOOKS.forEach((names, i) => names.forEach((n) => ALIAS.set(n, i)));

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

const AT_END = new RegExp(`${SRC}$`);
const WHOLE = new RegExp(`^\\s*${SRC}\\s*$`);
const MERGED = /^\((\d+)절에 포함되어 있음\)$/;

function toRef(m) {
  const book = ALIAS.get(m[2]);
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
  return { book, parts, label: `${BOOKS[book][0]} ${spec}`, raw: m[0].slice(m[1].length) };
}

/** text 끝에 붙어 있는 구절 표기를 찾는다. 예: "오늘 말씀은 요 3:16" → 요 3:16 */
export function refAtEnd(text) {
  const m = AT_END.exec(text);
  return m ? { ...toRef(m), index: m.index + m[1].length } : null;
}

/** 입력 전체가 하나의 구절 표기인지 (말씀 검색창용) */
export function parseRef(text) {
  const m = WHOLE.exec(text);
  return m ? toRef(m) : null;
}

/** line 안에서 col 위치(커서)를 포함하는 구절 표기 */
export function refAround(line, col) {
  for (const m of line.matchAll(new RegExp(SRC, 'g'))) {
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    if (col >= start && col <= end) return { ...toRef(m), start, end };
  }
  return null;
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
