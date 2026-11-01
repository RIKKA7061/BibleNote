// 성경 탭: 앱에 들어 있는 개역한글 읽기 · 찾기 · 메모에 넣기, 갓피아(개역개정)로 바로 가기
import { BOOKS } from './books.js';
import { parseRef, lookup, formatVerses } from './ref.js';
import { tokenize, searchPhrase } from './phrase.js';
import { termsIn } from './glossary.js';

// 갓피아 성경 읽기 주소의 책 코드 (BOOKS 와 같은 순서)
const VOLS = ['gen', 'exo', 'lev', 'num', 'deu', 'jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch', '2ch', 'ezr', 'neh', 'est', 'job', 'psa', 'pro', 'ecc', 'sng', 'isa', 'jer', 'lam', 'ezk', 'dan', 'hos', 'jol', 'amo', 'oba', 'jnh', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal', 'mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal', 'eph', 'php', 'col', '1th', '2th', '1ti', '2ti', 'tit', 'phm', 'heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud', 'rev'];
const OT_COUNT = 39;
const POS_KEY = 'biblenote.biblepos.v1';

let ctx = null; // { $, bible(), loadBible, settings, toast, showTerms, pickNote }
let book = 42; // 처음에는 요한복음
let chapter = 1;
let selected = new Set();
let searchSeq = 0;

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (p && BOOKS[p.b]) {
      book = p.b;
      chapter = p.c;
    }
  } catch { /* 처음 */ }
}

function savePos() {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ b: book, c: chapter }));
  } catch { /* 무시 */ }
}

/** 지금 보고 있는 곳의 갓피아(개역개정) 주소 */
export function godpiaUrl(v = 1) {
  return `https://www.godpia.com/read/reading.asp?ver=gae&vol=${VOLS[book]}&chap=${chapter}&sec=${v}`;
}

const el = {};

function render() {
  const bible = ctx.bible();
  el.pick.textContent = `${BOOKS[book][0]} ${chapter}${book === 18 ? '편' : '장'}`;
  el.godpia.href = godpiaUrl();
  if (!bible) {
    el.text.textContent = '성경을 불러오는 중이에요…';
    return;
  }
  const verses = bible[book][chapter - 1];
  el.prev.disabled = book === 0 && chapter === 1;
  el.next.disabled = book === BOOKS.length - 1 && chapter === bible[book].length;
  el.text.replaceChildren(...verses.map((t, i) => {
    const p = document.createElement('p');
    p.className = `verse${selected.has(i + 1) ? ' on' : ''}`;
    p.dataset.v = i + 1;
    const sup = document.createElement('sup');
    sup.textContent = i + 1;
    p.append(sup, t);
    return p;
  }));
  renderActions();
}

/** 고른 절 번호들 → 16-18, 20 */
function specOf(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(', ');
}

/** 고른 절로 메모에 넣을 글 만들기 */
function selection() {
  const nums = [...selected].sort((a, b) => a - b);
  const ref = { book, parts: nums.map((v) => ({ c1: chapter, v1: v, c2: chapter, v2: v })) };
  const verses = lookup(ctx.bible(), ref) || [];
  return { label: `${BOOKS[book][0]} ${chapter}:${specOf(nums)}`, verses, text: formatVerses(verses, ctx.settings()) };
}

function renderActions() {
  el.actions.hidden = !selected.size;
  if (selected.size) el.sel.textContent = selection().label;
}

function go(b, c, v = 0) {
  book = b;
  chapter = c;
  selected = new Set(v ? [v] : []);
  savePos();
  render();
  if (v) el.text.querySelector(`[data-v="${v}"]`)?.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, 0);
}

function step(dir) {
  const bible = ctx.bible();
  if (!bible) return;
  let c = chapter + dir;
  let b = book;
  if (c < 1) {
    b -= 1;
    if (b < 0) return;
    c = bible[b].length;
  } else if (c > bible[b].length) {
    b += 1;
    if (b >= BOOKS.length) return;
    c = 1;
  }
  go(b, c);
}

/* ───────── 책 · 장 고르기 ───────── */

function gridButton(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function pickerBooks() {
  el.pickerTitle.textContent = '책 고르기';
  const section = (title, from, to) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'pick-grid books';
    for (let i = from; i < to; i++) {
      const b = gridButton(BOOKS[i][0], () => pickerChapters(i));
      if (i === book) b.className = 'on';
      grid.append(b);
    }
    return [h, grid];
  };
  el.pickerBody.replaceChildren(...section('구약', 0, OT_COUNT), ...section('신약', OT_COUNT, BOOKS.length));
}

function pickerChapters(b) {
  el.pickerTitle.textContent = BOOKS[b][0];
  const grid = document.createElement('div');
  grid.className = 'pick-grid chapters';
  const count = ctx.bible()?.[b].length ?? 0;
  for (let c = 1; c <= count; c++) {
    const btn = gridButton(String(c), () => {
      el.picker.close();
      go(b, c);
    });
    if (b === book && c === chapter) btn.className = 'on';
    grid.append(btn);
  }
  el.pickerBody.replaceChildren(grid);
}

/* ───────── 찾기: 구절(요 3:16) 또는 문구 ───────── */

async function runSearch() {
  const q = el.search.value;
  const my = ++searchSeq;
  if (!q.trim()) {
    el.results.hidden = true;
    return;
  }
  const bible = ctx.bible();
  if (!bible) return;
  const ref = parseRef(q);
  if (ref) {
    const part = ref.parts[0];
    const ok = lookup(bible, ref);
    el.results.hidden = false;
    if (!ok) {
      el.results.textContent = '해당 장·절이 없어요';
      return;
    }
    el.results.replaceChildren(resultButton(ref.label, ok[0].text, () => {
      go(ref.book, part.c1, part.v1);
      selected = new Set(ok.filter((x) => x.c === part.c1).map((x) => x.v));
      render();
    }));
    return;
  }
  const words = tokenize(q).map((t) => t.word);
  if (words.join('').length < 2) {
    el.results.hidden = true;
    return;
  }
  const found = (await searchPhrase(words)).filter((r) => r.score >= 0.4);
  if (my !== searchSeq) return;
  el.results.hidden = false;
  if (!found.length) {
    el.results.textContent = '비슷한 말씀을 찾지 못했어요';
    return;
  }
  el.results.replaceChildren(...found.map((r) => resultButton(
    `${BOOKS[r.b][0]} ${r.c}:${r.v}`,
    bible[r.b][r.c - 1][r.v - 1],
    () => go(r.b, r.c, r.v),
  )));
}

function resultButton(label, text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  const head = document.createElement('b');
  head.textContent = label;
  const body = document.createElement('span');
  body.textContent = text;
  b.append(head, body);
  b.addEventListener('click', () => {
    el.results.hidden = true;
    el.search.value = '';
    onClick();
  });
  return b;
}

/* ───────── 시작 ───────── */

export function initBibleTab(context) {
  ctx = context;
  const { $ } = ctx;
  Object.assign(el, {
    pick: $('bible-pick'),
    prev: $('bible-prev'),
    next: $('bible-next'),
    text: $('bible-text'),
    godpia: $('godpia-link'),
    search: $('bible-search'),
    results: $('bible-results'),
    actions: $('bible-actions'),
    sel: $('bible-sel'),
    picker: $('bible-picker'),
    pickerTitle: $('picker-title'),
    pickerBody: $('picker-body'),
  });
  loadPos();

  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  el.pick.addEventListener('click', () => {
    pickerBooks();
    el.picker.showModal();
  });
  el.text.addEventListener('click', (e) => {
    const p = e.target.closest('.verse');
    if (!p) return;
    const v = Number(p.dataset.v);
    if (selected.has(v)) selected.delete(v);
    else selected.add(v);
    p.classList.toggle('on', selected.has(v));
    renderActions();
  });

  let timer = 0;
  el.search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 250);
  });

  $('bible-copy').addEventListener('click', async () => {
    const s = selection();
    try {
      await navigator.clipboard.writeText(`${s.label} (${s.text})`);
      ctx.toast('말씀을 복사했어요');
    } catch {
      ctx.toast('복사하지 못했어요');
    }
  });
  $('bible-words').addEventListener('click', () => {
    const s = selection();
    ctx.showTerms(termsIn(s.verses.map((v) => v.text).join(' ')), s.label);
  });
  $('bible-insert').addEventListener('click', () => {
    const s = selection();
    ctx.pickNote(`${s.label} (${s.text})`, () => {
      selected = new Set();
      render();
    });
  });
}

/** 탭을 열 때, 성경을 다 불러왔을 때 */
export function showBibleTab() {
  if (ctx) render();
}
