// 읽기 좋게: 글은 그대로 두고 보기만 바꾸는 자동 색칠 + 연관성이 끊기는 곳에 빈 줄 넣기
//
// 1) autoMarks(글) → [{ s, e, cls }]  (저장하지 않고 화면에서만 칠한다)
//    a-head : 제목처럼 보이는 줄 (# 제목, 1. 짧은 제목, 제1장, [제목], ■ 제목, 앞이 비고 짧게 끝나는 줄)
//    a-term : 줄 맨 앞 "용어:" 의 용어
//    a-def  : 괄호 "(…)" (넣은 뜻·말씀, 덧붙인 말) — 회색
//    a-ref  : 성경 구절 표기 (요한복음 3:16)
// 2) spacingEdits(글) → 빈 줄을 넣을 위치 목록 (뒤에서부터 넣으면 된다)
//    제목 앞, 글 모양이 바뀌는 곳(목록 ↔ 글 ↔ '용어: 뜻' 목록), 앞뒤 문장에 겹치는 낱말이 없는 곳.
//    빈 줄이 3개 이상 이어지면 1개로 줄인다.

const BULLET = /^\s*(?:[-*•▪]|\d+[.)]|[☐☑▾▸]|\|)\s+/;
const SENTENCE_END = /(?:[.!?…。]|[다요죠음함됨임]\.?)$/;

/** 줄 단위로 나누기: [{ text, start }] */
function lines(text) {
  const out = [];
  let start = 0;
  for (const t of text.split('\n')) {
    out.push({ text: t, start });
    start += t.length + 1;
  }
  return out;
}

const blank = (t) => !t.trim();
const indented = (t) => /^\s{2,}\S/.test(t);

/** 제목처럼 보이는 줄인지 (앞뒤 줄을 같이 본다) */
export function isHeadingLine(t, prev = '', next = '') {
  const s = t.trim();
  if (!s || s.length > 30) return false;
  if (/^#{1,3}\s+\S/.test(s)) return true;
  if (/^(?:제\s?\d+\s?[장절편부과강]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?|[IVX]+\.)\s*\S/.test(s)) return true;
  if (/^\[[^\]]{1,24}\]$/.test(s) || /^【[^】]{1,24}】$/.test(s)) return true;
  if (/^[■□●◆◇▶★☆◎]\s*\S/.test(s)) return true;
  if (/[:：(]|https?:/.test(s)) return false;
  // "1. 수요와 공급" 처럼 번호 + 짧은 말, 문장으로 끝나지 않고 다음 줄이 이어질 때
  if (/^\d+[.)]\s+\S/.test(s) && s.length <= 20 && !SENTENCE_END.test(s) && next.trim() && !BULLET.test(next)) return true;
  // 앞이 비어 있고(또는 맨 앞) 짧고 문장으로 끝나지 않으며 다음 줄이 이어지는 줄
  if (BULLET.test(t) || indented(t)) return false;
  return blank(prev) && !!next.trim() && s.length <= 18 && !SENTENCE_END.test(s) && !/[,.]$/.test(s);
}

const REF = /[가-힣]{1,8}\s?\d{1,3}\s?:\s?\d{1,3}(?:\s?[-~]\s?\d{1,3})?(?:\s?,\s?\d{1,3})*/g;

/** 자동 색칠 구간 */
export function autoMarks(text) {
  const out = [];
  const ls = lines(text);
  ls.forEach((ln, i) => {
    const t = ln.text;
    if (!t.trim()) return;
    if (isHeadingLine(t, ls[i - 1]?.text, ls[i + 1]?.text)) {
      const lead = t.length - t.trimStart().length;
      out.push({ s: ln.start + lead, e: ln.start + t.trimEnd().length, cls: 'a-head' });
      return;
    }
    const lineMarks = [];
    // 줄 맨 앞 "용어:" (시각·구절·주소는 빼고)
    const m = /^(\s*(?:[-*•▪]\s+|\d+[.)]\s+|[☐☑]\s*)?)([^:：()\n]{1,20}?)\s*[:：](?!\/\/)/.exec(t);
    if (m && /[가-힣A-Za-z]$/.test(m[2].trim()) && m[2].trim().split(/\s+/).length <= 3) {
      const s = ln.start + m[1].length;
      lineMarks.push({ s, e: s + m[2].trimEnd().length, cls: 'a-term' });
    }
    // 성경 구절
    for (const r of t.matchAll(REF)) {
      const s = ln.start + r.index;
      if (!lineMarks.some((x) => s < x.e && s + r[0].length > x.s)) lineMarks.push({ s, e: s + r[0].length, cls: 'a-ref' });
    }
    // 괄호 "(…)" 는 짧아도 모두 회색: 넣은 뜻·말씀, "- (낙서)현지문화 파괴" 같은 덧붙인 말
    for (const p of t.matchAll(/\([^()\n]+\)|（[^（）\n]+）/g)) {
      const s = ln.start + p.index;
      if (!lineMarks.some((x) => s < x.e && s + p[0].length > x.s)) lineMarks.push({ s, e: s + p[0].length, cls: 'a-def' });
    }
    out.push(...lineMarks.sort((a, b) => a.s - b.s));
  });
  return out;
}

/* ───────── 빈 줄 넣기 ───────── */

// 낱말 끝의 조사·어미를 떼고 앞 두 글자로 비교 ("수요곡선은" ↔ "수요곡선이")
const PARTICLE = /(?:에서는|에서|으로|에게|까지|부터|처럼|보다|이라|라고|하고|이고|이며|하는|되는|했다|한다|이다|은|는|이|가|을|를|의|에|도|로|와|과|만|요)$/;
function keywords(t) {
  const set = new Set();
  for (const raw of t.replace(/\([^()]*\)/g, ' ').split(/[^가-힣A-Za-z0-9]+/)) {
    const w = raw.replace(PARTICLE, '');
    if (w.length >= 2) set.add(w.slice(0, 2).toLowerCase());
  }
  return set;
}

/** 줄의 모양: 'list' | 'term' | 'text' */
function kind(t) {
  if (BULLET.test(t)) return 'list';
  if (/^\s*[^:：()\n]{1,20}?\s*[:：]\s*\S/.test(t) && !/^\s*https?:/.test(t)) return 'term';
  return 'text';
}

/**
 * 빈 줄을 넣거나 줄일 곳: [{ at, del, ins }]  at부터 del 글자를 ins로 바꾼다.
 * 뒤에서부터 순서대로 적용하면 앞 위치가 어긋나지 않는다.
 */
export function spacingEdits(text) {
  const ls = lines(text);
  const edits = [];
  for (let i = 1; i < ls.length; i++) {
    const cur = ls[i].text;
    const prev = ls[i - 1].text;
    if (blank(cur) || blank(prev) || indented(cur)) continue;
    let gap = false;
    if (isHeadingLine(cur, '', ls[i + 1]?.text) && !isHeadingLine(prev, ls[i - 2]?.text, cur)) gap = true;
    else if (/^\s*#{1,3}\s/.test(cur)) gap = true;
    else if (isHeadingLine(prev, ls[i - 2]?.text, cur)) gap = false; // 제목 바로 아래는 붙인다
    else {
      const a = kind(prev);
      const b = kind(cur);
      if (a !== b && !indented(prev)) gap = true;
      else if (a === 'text' && b === 'text' && SENTENCE_END.test(prev.trim()) && prev.trim().length >= 12 && cur.trim().length >= 12) {
        const pk = keywords(prev);
        const ck = keywords(cur);
        gap = pk.size > 0 && ck.size > 0 && ![...ck].some((k) => pk.has(k));
      }
    }
    if (gap) edits.push({ at: ls[i].start, del: 0, ins: '\n' });
  }
  // 빈 줄 3개 이상 → 1개
  for (const m of text.matchAll(/\n[ \t]*\n(?:[ \t]*\n)+/g)) edits.push({ at: m.index, del: m[0].length, ins: '\n\n' });
  return edits.sort((x, y) => y.at - x.at);
}
