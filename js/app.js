import { BOOKS } from './books.js';
import { refAtEnd, refAround, parseRef, lookup, formatVerses, lastRef, shortRefAround, contextRef } from './ref.js';
import { loadNotes, saveNotes, loadSettings, saveSettings, requestPersist, newId } from './store.js';
import { initSync, push, signIn, signOut } from './sync.js';
import { tokenize, suggestFor, wholeLineMatch, searchPhrase } from './phrase.js';
import { termsIn, termsInNote, meaningOf } from './glossary.js';
import {
  initSubjects, allSubjects, getSubject, createSubject, updateSubject, deleteSubject, lookupTerm, setTerm, removeTerm,
  listTerms, termCount, importTerms, termBefore, isLabel, cleanDef, subjectSync, exportSubjects, importSubjects,
} from './subjects.js';
import { defineTerm, sourceLabel, errorMessage } from './ai.js';
import { parseLine, parseBlocks, continueAfter, shortcutAt, flippedMarker, BLOCK_TYPES, INDENT, todoCount, hasStructure } from './blocks.js';
import * as ink from './ink.js';
import { applyMark, shiftMarks, renderMarks, scrollMarks } from './marks.js';
import { initBibleTab, showBibleTab, godpiaUrl } from './bible-tab.js';
import { initScoreTab } from './score-tab.js';

const $ = (id) => document.getElementById(id);
const el = {
  listView: $('list-view'),
  bibleView: $('bible-view'),
  scoreView: $('score-view'),
  editorView: $('editor-view'),
  tabbar: $('tabbar'),
  tabs: document.querySelectorAll('.tab'),
  backdrop: $('backdrop'),
  backdropInner: $('backdrop-inner'),
  fmtBar: $('fmt-bar'),
  noteTarget: $('note-target'),
  noteTargetList: $('note-target-list'),
  list: $('note-list'),
  empty: $('empty'),
  emptySubject: $('empty-subject'),
  subjectTabs: $('subject-tabs'),
  finderLabel: $('finder-label'),
  subjectSheet: $('subject-sheet'),
  termDialog: $('term-dialog'),
  noResult: $('no-result'),
  search: $('search'),
  title: $('title'),
  body: $('body'),
  meta: $('meta'),
  chip: $('chip'),
  status: $('bible-status'),
  openFinder: $('tool-main'), // 블록 버튼 + 말씀 찾기(용어 사전) 버튼 묶음
  view: $('note-view'),
  viewToggle: $('view-toggle'),
  blockBar: $('block-bar'),
  noteMenu: $('note-menu'),
  suggest: $('suggest'),
  suggestRef: $('suggest-ref'),
  suggestText: $('suggest-text'),
  suggestGo: $('suggest-go'),
  finder: $('finder'),
  finderInput: $('finder-input'),
  finderPreview: $('finder-preview'),
  finderInsert: $('finder-insert'),
  settings: $('settings'),
  glossCount: $('gloss-count'),
  gloss: $('gloss'),
  glossList: $('gloss-list'),
  glossNote: $('gloss-note'),
  penToggle: $('pen-toggle'),
  penBar: $('pen-bar'),
  toast: $('toast'),
  toastMsg: $('toast-msg'),
  toastAction: $('toast-action'),
};

// 삭제한 메모는 다른 기기에도 삭제가 전달되도록 내용을 비운 채 deleted 표시만 남긴다
let notes = loadNotes();
let settings = loadSettings();
let current = null;
let marks = []; // 지금 연 메모의 글자 서식 (marks.js)

const visibleNotes = () => notes.filter((n) => !n.deleted);

// 예전 버전의 Claude API 키는 더 쓰지 않는다 (Eleven AI는 키가 필요 없음) → 기기에서 지운다
try {
  localStorage.removeItem('biblenote.aikey.v1');
} catch { /* 무시 */ }

/* AI 노트 주제 탭: '' = 말씀, 그 밖에는 사용자가 만든 탭 id */
const tabOf = (n) => (getSubject(n?.tab) ? n.tab : '');
const noteSubject = () => getSubject(current?.tab);
const isBibleNote = () => !noteSubject();
if (!getSubject(settings.subject)) settings.subject = '';

/* ───────── 성경 본문 ───────── */

let bible = null;
let biblePromise = null;

function loadBible() {
  if (!biblePromise) {
    el.status.textContent = '성경 불러오는 중…';
    biblePromise = fetch('data/krv.json')
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then((data) => {
        bible = data;
        el.status.textContent = '';
        updateChip();
        showBibleTab();
        return data;
      })
      .catch((err) => {
        biblePromise = null;
        el.status.textContent = '성경을 불러오지 못했어요';
        throw err;
      });
  }
  return biblePromise;
}

const verseText = (verses) => formatVerses(verses, settings);
const verseInfo = ({ b, c, v }) => ({ label: `${BOOKS[b][0]} ${c}:${v}`, text: bible[b][c - 1][v - 1] });
const EXPANDED = /^[ \t ]*\(/; // 구절 바로 뒤에 이미 "(" 가 있으면 넣은 것으로 본다

/* ───────── 목록 ───────── */

function fmtDate(t, withTime = false) {
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return withTime ? `오늘 ${time}` : time;
  const date = d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  return withTime ? `${date} ${time}` : date;
}

// 목록 정렬 (고정한 노트는 늘 맨 위)
const SORTS = {
  updated: ['최근 수정순', (a, b) => b.updated - a.updated],
  created: ['만든 순', (a, b) => b.created - a.created],
  title: ['제목 순', (a, b) => (a.title.trim() || '￿').localeCompare(b.title.trim() || '￿', 'ko') || b.updated - a.updated],
};
if (!SORTS[settings.sort]) settings.sort = 'updated';

const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/></svg>';

function renderList() {
  renderSubjectTabs();
  const q = el.search.value.trim().toLowerCase();
  const visible = visibleNotes().filter((n) => tabOf(n) === settings.subject);
  const order = SORTS[settings.sort][1];
  const sorted = visible.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || order(a, b));
  const shown = q ? sorted.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : sorted;
  const sortBtn = $('sort-btn');
  sortBtn.querySelector('span').textContent = SORTS[settings.sort][0];
  sortBtn.hidden = visible.length < 2;

  el.list.replaceChildren(...shown.map((n) => {
    const li = document.createElement('li');
    const card = document.createElement('button');
    card.className = 'note-card';
    const title = document.createElement('div');
    title.className = 'note-title' + (n.title.trim() ? '' : ' untitled');
    title.textContent = n.title.trim() || '제목 없음';
    if (n.pinned) {
      const pin = document.createElement('span');
      pin.className = 'pin';
      pin.setAttribute('aria-label', '고정됨');
      pin.innerHTML = PIN_SVG;
      title.prepend(pin);
    }
    const preview = document.createElement('div');
    preview.className = 'note-preview';
    preview.textContent = n.body.replace(/\s+/g, ' ').trim();
    const date = document.createElement('div');
    date.className = 'note-date';
    const todo = todoCount(n.body);
    date.textContent = fmtDate(n.updated) + (todo.total ? ` · 할 일 ${todo.done}/${todo.total}` : '');
    card.append(title, ...(preview.textContent ? [preview] : []), date);
    card.addEventListener('click', () => openNote(n.id, true));
    li.append(card);
    return li;
  }));
  const subj = getSubject(settings.subject);
  el.empty.hidden = visible.length > 0 || !!subj;
  el.emptySubject.hidden = visible.length > 0 || !subj;
  $('subject-hint').hidden = !subj || !visible.length; // 노트가 없을 때는 아래 빈 화면에 같은 설명이 있다
  if (subj) $('empty-subject-name').textContent = `‘${subj.name}’`;
  el.noResult.hidden = !(visible.length && !shown.length);
}

$('sort-btn').addEventListener('click', () => {
  const keys = Object.keys(SORTS);
  settings.sort = keys[(keys.indexOf(settings.sort) + 1) % keys.length];
  saveSettings(settings);
  renderList();
  toast(`${SORTS[settings.sort][0]}으로 정렬했어요`);
});

function renderSubjectTabs() {
  const chip = (label, selected, onClick, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `subject-chip ${cls}`.trim();
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(selected));
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const pick = (id) => {
    if (settings.subject === id) {
      if (id) openSubjectSheet(getSubject(id)); // 고른 탭을 한 번 더 누르면 설정
      return;
    }
    settings.subject = id;
    saveSettings(settings);
    el.search.value = '';
    renderList();
  };
  const chips = [chip('말씀', !settings.subject, () => pick(''))];
  for (const subj of allSubjects()) chips.push(chip(subj.name, settings.subject === subj.id, () => pick(subj.id)));
  chips.push(chip('＋ 탭 만들기', false, () => openSubjectSheet(null), 'add'));
  const cur = getSubject(settings.subject);
  if (cur) {
    const gear = chip('', false, () => openSubjectSheet(cur), 'gear');
    gear.removeAttribute('role');
    gear.setAttribute('aria-label', `${cur.name} 탭 설정`);
    gear.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>설정';
    chips.push(gear);
  }
  el.subjectTabs.replaceChildren(...chips);
}

/* ───────── 화면 전환 (안드로이드 뒤로가기 지원) ───────── */

const VIEWS = { notes: el.listView, bible: el.bibleView, score: el.scoreView };
let tab = VIEWS[settings.tab] ? settings.tab : 'notes';

/** 아래 탭: 메모 / 성경 / 악보 */
function showTab(name) {
  tab = name;
  if (settings.tab !== name) {
    settings.tab = name;
    saveSettings(settings);
  }
  for (const [key, view] of Object.entries(VIEWS)) view.hidden = key !== name;
  for (const b of el.tabs) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (name === 'bible') showBibleTab();
}

function showEditor(show) {
  el.editorView.hidden = !show;
  el.tabbar.hidden = show;
  if (show) {
    for (const view of Object.values(VIEWS)) view.hidden = true;
  } else {
    setPen(false);
    showTab(tab);
  }
  hideChip();
  hideSuggest();
}

function openNote(id, addHistory) {
  const note = notes.find((n) => n.id === id && !n.deleted);
  if (!note) return closeEditor();
  current = note;
  if (addHistory) history.pushState({ note: id }, '');
  el.title.value = note.title;
  el.body.value = note.body;
  lastLen = note.body.length;
  prevBody = note.body;
  overlayDirty = false;
  el.body.scrollTop = 0;
  updateMeta();
  showEditor(true);
  ink.setStrokes(note.ink);
  marks = note.marks ?? [];
  drawMarks();
  updateGloss();
  el.finderLabel.textContent = isBibleNote() ? '말씀 찾기' : '용어 사전';
  el.body.placeholder = isBibleNote()
    ? '내용을 입력하세요\n\n예) 요한복음 1:12 쓰고 한 칸 띄우기'
    : '내용을 입력하세요\n\n탭에서는 노트에 상품수지:처럼 용어 뒤에 콜론(:)을 치면\n뜻이 괄호 안에 자동으로 들어가요.';
  // 토글·할 일이 있는 노트는 정리된 모습으로 연다 (펜 필기가 있으면 필기가 보이는 편집 화면)
  setView(settings.blocks && hasStructure(note.body) && !note.ink?.length);
}

function createNote() {
  const now = Date.now();
  const note = { id: newId(), title: '', body: '', tab: settings.subject, created: now, updated: now };
  notes.push(note);
  openNote(note.id, true);
  el.title.focus();
}

function closeEditor() {
  flushSave();
  if (current && !current.title.trim() && !current.body.trim()) {
    // 한 번도 저장 안 된 빈 메모는 그냥 버리고, 내용을 다 지운 메모는 삭제로 처리
    if (current.updated === current.created) {
      notes = notes.filter((n) => n !== current);
      saveNotes(notes);
    } else {
      deleteNote(current);
    }
  }
  current = null;
  showEditor(false);
  renderList();
}

function deleteNote(note) {
  Object.assign(note, { title: '', body: '', ink: [], marks: [], pinned: false, deleted: true, updated: Date.now() });
  saveNotes(notes);
  push('notes', note);
}

function goBack() {
  if (history.state?.note) history.back();
  else closeEditor();
}

window.addEventListener('popstate', (e) => {
  if (e.state?.note) openNote(e.state.note, false);
  else closeEditor();
});

/* ───────── 저장 ───────── */

let saveTimer = 0;
let persistAsked = false;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!current) return;
  const title = el.title.value;
  const body = el.body.value;
  if (title === current.title && body === current.body && !overlayDirty) return;
  overlayDirty = false;
  Object.assign(current, { title, body, updated: Date.now() });
  if (!saveNotes(notes)) toast('저장 공간이 부족해 저장하지 못했어요');
  if (title.trim() || body.trim()) push('notes', current);
  updateMeta();
  if (!persistAsked) {
    persistAsked = true;
    requestPersist();
  }
}

function updateMeta() {
  el.meta.textContent = current
    ? `${fmtDate(current.updated, true)} · ${noteSubject()?.name ?? '말씀 · 개역한글'}${current.pinned ? ' · 고정됨' : ''}`
    : '';
}

document.addEventListener('visibilitychange', () => document.hidden && flushSave());
window.addEventListener('pagehide', flushSave);

/* ───────── 본문 편집 · 말씀 자동 넣기 ───────── */

let lastLen = 0;
let busy = false;
let composingGrew = false;
let prevBody = ''; // 필기를 글자 위치에 맞춰 옮기려고 바뀌기 전 글을 기억
let overlayDirty = false;

function bodyChanged() {
  const now = el.body.value;
  if (now === prevBody) return;
  ink.textChanged(prevBody, now);
  const moved = shiftMarks(marks, prevBody, now);
  if (moved !== marks) {
    marks = moved;
    if (current) current.marks = marks;
  }
  prevBody = now;
  drawMarks();
  updateGlossSoon();
}

function drawMarks() {
  renderMarks(el.body, el.backdrop, el.backdropInner, marks);
}

el.body.addEventListener('scroll', () => scrollMarks(el.body, el.backdropInner));
new ResizeObserver(() => {
  if (!el.editorView.hidden) drawMarks();
}).observe(el.body);

/** 입력창의 [start,end)를 text로 바꾼다. 가능하면 execCommand로 해서 실행취소(Ctrl+Z)가 되게 한다. */
function replaceText(start, end, text) {
  const ta = el.body;
  busy = true;
  try {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand(text ? 'insertText' : 'delete', false, text);
    } catch { /* 지원 안 하는 브라우저 */ }
    if (!ok) ta.setRangeText(text, start, end, 'end');
  } finally {
    busy = false;
  }
  lastLen = ta.value.length;
  bodyChanged();
  scheduleSave();
}

function setCaret(pos) {
  el.body.setSelectionRange(pos, pos);
}

/** 방금 띄어쓰기/줄바꿈을 쳤고 그 앞이 구절 표기면 " (말씀)"을 넣는다 */
function autoExpand() {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (!bible || !settings.auto || !isBibleNote() || pos !== ta.selectionEnd || pos < 2) return;
  const v = ta.value;
  if (!/[ \n ]/.test(v[pos - 1])) return;
  const lineStart = v.lastIndexOf('\n', pos - 2) + 1;
  const ref = refAtEnd(v.slice(lineStart, pos - 1));
  if (!ref || EXPANDED.test(v.slice(pos))) return;
  const verses = lookup(bible, ref);
  if (!verses) return;

  // "요1:14 " → "요한복음1:14 (말씀) " : 책 이름을 정식 이름으로 바꾸고(설정) 뒤에 말씀을 붙인다
  const start = lineStart + ref.index;
  const at = pos - 1;
  const insert = `${headOf(ref)} (${verseText(verses)})`;
  replaceText(start, at, insert);
  setCaret(start + insert.length + 1);
  toast(`${ref.label} 말씀을 넣었어요`, '되돌리기', () => {
    if (el.body.value.slice(start, start + insert.length) === insert) {
      replaceText(start, start + insert.length, ref.raw);
      setCaret(start + ref.raw.length + 1);
      updateChip();
    }
  });
}

/** 구절 표기: 설정에 따라 정식 책 이름으로 (요1:14 → 요한복음1:14) */
const headOf = (ref) => (settings.fullName ? ref.full : ref.raw);

/* 기호 자동 변환 (노션처럼): -> → , <- ← , <-> ↔ , => ⇒ , != ≠ , >= ≥ , <= ≤
   바뀐 직후 지우기(백스페이스)를 누르면 원래 글자로 돌아간다. */
const SYMBOLS = [['←>', '↔'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['!=', '≠'], ['>=', '≥'], ['<=', '≤']];
let lastSymbol = null; // { at, from }

function autoSymbol(e) {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (!settings.symbols || e.inputType !== 'insertText' || pos !== ta.selectionEnd) return;
  for (const [from, to] of SYMBOLS) {
    if (pos >= from.length && ta.value.slice(pos - from.length, pos) === from) {
      replaceText(pos - from.length, pos, to);
      lastSymbol = { at: pos - from.length, from: from === '←>' ? '<->' : from };
      return;
    }
  }
}

function undoSymbol(e) {
  const s = lastSymbol;
  lastSymbol = null;
  if (!s || e.inputType !== 'deleteContentBackward' || el.body.selectionStart !== s.at) return false;
  replaceText(s.at, s.at, s.from);
  return true;
}

el.body.addEventListener('input', (e) => {
  if (busy) return;
  const grew = el.body.value.length > lastLen;
  lastLen = el.body.value.length;
  bodyChanged();
  scheduleSave();
  schedulePhrase();
  checkSlash();
  updateGhostSoon();
  if (undoSymbol(e)) return;
  if (grew && !e.isComposing) autoSymbol(e);
  if (e.isComposing) {
    composingGrew ||= grew;
    return;
  }
  if (grew) {
    autoExpand();
    autoTerm();
    const typed = el.body.value[el.body.selectionStart - 1];
    if (typed === '\n') autoPhraseLine();
    if (settings.blocks && e.inputType !== 'insertFromPaste') {
      if (typed === '\n') continueBlock();
      else if (typed === ' ' || typed === ' ') blockShortcut();
      else if (typed === '/') openSlash();
    }
  }
  updateChip();
});

/* ───────── 노션처럼 정리하기 (편집 화면) ─────────
   엔터: 목록·할 일·토글 안쪽을 이어 쓰고, 빈 항목에서 한 번 더 엔터를 치면 끝낸다
   줄 맨 앞 "> " → 토글, "[] " → 할 일, "\" " → 인용 / 머리말 바로 뒤에서 지우기 → 머리말만 지움
   줄 맨 앞 "/" 또는 ＋ 버튼 → 블록 메뉴 / Tab, Shift+Tab → 들여쓰기 */

function continueBlock() {
  const ta = el.body;
  const pos = ta.selectionStart;
  const v = ta.value;
  if (pos !== ta.selectionEnd || v[pos - 1] !== '\n') return;
  const prevStart = v.lastIndexOf('\n', pos - 2) + 1;
  const prev = v.slice(prevStart, pos - 1);
  const r = continueAfter(prev);
  if (!r) return;
  if (r.line != null) {
    let lineEnd = v.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = v.length;
    if (v.slice(pos, lineEnd).trim()) return; // 줄 중간에서 엔터를 친 경우는 그대로
    replaceText(prevStart, pos, r.line); // 빈 항목: 머리말을 지우거나 한 칸 내어쓰고, 방금 만든 줄은 없앤다
    setCaret(prevStart + r.line.length);
    return;
  }
  replaceText(pos, pos, r.insert);
  if (r.openToggle) {
    const at = prevStart + parseLine(prev).indentStr.length; // 접힌 토글에 내용을 쓰면 편다
    replaceText(at, at + 1, '▾');
  }
  setCaret(pos + r.insert.length);
}

function blockShortcut() {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  const s = shortcutAt(v.slice(lineStart, pos));
  if (!s) return;
  const at = lineStart + s.at;
  replaceText(at, at + s.len, s.to);
  setCaret(at + s.to.length);
}

const outdentOnce = (ind) => ind.replace(/(?: {1,2}|\t|　)$/, '');

el.body.addEventListener('beforeinput', (e) => {
  if (busy || !settings.blocks || e.inputType !== 'deleteContentBackward' || e.isComposing) return;
  const ta = el.body;
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  const before = v.slice(lineStart, pos);
  if (!before) return;
  const p = parseLine(before);
  if (p.markerLen && p.indentStr.length + p.markerLen === before.length) {
    // "☐ |" 에서 지우기 → 머리말만 지워서 보통 글로 (노션처럼)
    e.preventDefault();
    const at = lineStart + p.indentStr.length;
    replaceText(at, pos, '');
    setCaret(at);
  } else if (!p.markerLen && p.indentStr && p.indentStr.length === before.length) {
    // 들여쓰기만 있는 곳에서 지우기 → 한 단계 내어쓰기
    e.preventDefault();
    const out = outdentOnce(p.indentStr);
    replaceText(lineStart, pos, out);
    setCaret(lineStart + out.length);
  }
});

/** 선택한 줄들(또는 커서가 있는 줄)을 들여쓰기(dir=1) / 내어쓰기(dir=-1) */
function indentLines(dir) {
  const ta = el.body;
  const v = ta.value;
  const { selectionStart: s, selectionEnd: e } = ta;
  const a = v.lastIndexOf('\n', s - 1) + 1;
  let b = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
  if (b < 0) b = v.length;
  const lines = v.slice(a, b).split('\n');
  const out = lines.map((l) => (dir > 0 ? INDENT + l : l.replace(/^(?: {1,2}|\t|　)/, '')));
  const text = out.join('\n');
  if (text === v.slice(a, b)) return;
  replaceText(a, b, text);
  if (s === e) setCaret(Math.max(a, s + out[0].length - lines[0].length));
  else ta.setSelectionRange(a, a + text.length);
}

el.body.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !settings.blocks || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (ghost && !e.shiftKey && el.body.selectionStart === ghost.at) return; // 회색 미리보기가 있으면 Tab = 넣기
  e.preventDefault();
  indentLines(e.shiftKey ? -1 : 1);
});

/* 블록 메뉴: 줄 맨 앞에서 "/"를 치면 그 "/"를 바꾸고, ＋ 버튼으로 열면 지금 줄의 종류를 바꾼다 */
let blockMode = null; // { slashAt } | { line: true }

function renderBlockBar() {
  const items = BLOCK_TYPES.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'block-btn';
    const icon = document.createElement('i');
    icon.textContent = t.icon;
    b.append(icon, t.label);
    b.addEventListener('click', () => applyBlock(t));
    return b;
  });
  const tool = (label, title, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'block-btn';
    b.textContent = label;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', run);
    return b;
  };
  items.push(
    tool('⇥', '들여쓰기 (토글 안으로)', () => indentLines(1)),
    tool('⇤', '내어쓰기', () => indentLines(-1)),
    tool('✕', '닫기', hideBlockBar),
  );
  for (const b of items) {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // 키보드가 내려가지 않게
    b.addEventListener('mousedown', (e) => e.preventDefault());
  }
  el.blockBar.replaceChildren(...items);
}
renderBlockBar();

function showBlockBar(mode) {
  hideSuggest();
  blockMode = mode;
  el.blockBar.hidden = false;
  el.blockBar.scrollLeft = 0;
  el.openFinder.hidden = true;
  el.fmtBar.hidden = true;
}

function hideBlockBar() {
  if (!blockMode) return;
  blockMode = null;
  el.blockBar.hidden = true;
  updateFmtBar();
}

function openSlash() {
  const ta = el.body;
  const pos = ta.selectionStart;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  if (/^[ \t　]*\/$/.test(v.slice(lineStart, pos))) showBlockBar({ slashAt: pos - 1 });
}

/** "/" 뒤에 다른 글을 쓰거나 커서를 옮기면 메뉴를 닫는다 */
function checkSlash() {
  if (blockMode?.slashAt == null) return;
  const at = blockMode.slashAt;
  if (el.body.value[at] !== '/' || el.body.selectionStart !== at + 1) hideBlockBar();
}

function applyBlock(t) {
  const ta = el.body;
  const v = ta.value;
  if (blockMode?.slashAt != null) {
    const at = blockMode.slashAt;
    hideBlockBar();
    if (v[at] !== '/') return;
    const ins = t.id === 'divider' ? '---\n' : t.marker;
    replaceText(at, at + 1, ins);
    setCaret(at + ins.length);
    return;
  }
  hideBlockBar();
  const pos = ta.selectionStart;
  const ls = v.lastIndexOf('\n', pos - 1) + 1;
  let le = v.indexOf('\n', pos);
  if (le < 0) le = v.length;
  if (t.id === 'divider') {
    const ins = v.slice(ls, le).trim() ? '\n---\n' : '---\n';
    const at = v.slice(ls, le).trim() ? le : ls;
    replaceText(at, at + (at === ls ? le - ls : 0), ins);
    setCaret(at + ins.length);
    return;
  }
  const p = parseLine(v.slice(ls, le));
  const a = ls + p.indentStr.length;
  const b = a + (p.kind === 'divider' ? le - a : p.markerLen);
  replaceText(a, b, t.marker);
  setCaret(Math.max(a + t.marker.length, pos - (b - a) + t.marker.length));
}

$('block-btn').addEventListener('pointerdown', (e) => e.preventDefault());
$('block-btn').addEventListener('click', () => {
  if (blockMode) return hideBlockBar();
  if (document.activeElement !== el.body) el.body.focus();
  showBlockBar({ line: true });
});

// 일부 안드로이드 키보드는 띄어쓰기를 조합(composition) 중에 넣는다 → 조합이 끝난 뒤 한 번 더 확인
el.body.addEventListener('compositionend', () => {
  schedulePhrase();
  if (!composingGrew) return;
  composingGrew = false;
  setTimeout(() => {
    autoExpand();
    autoTerm();
    updateChip();
  });
});

el.title.addEventListener('input', scheduleSave);
el.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    el.body.focus();
    setCaret(0);
  }
});

/* ───────── "용어:" → 뜻 자동으로 넣기 ─────────
   말씀 탭: 성경 단어 풀이 사전 ("독생자:")
   사용자 탭: 그 탭의 용어 사전 → 없으면 AI가 탭의 규칙·참고 자료를 따라 써서 사전에 저장 → AI가 없으면 "뜻 추가" 카드 */

const termAutoOn = () => (isBibleNote() ? settings.auto : noteSubject().auto !== false);
const lookupDef = (term) => (isBibleNote() ? meaningOf(term) : lookupTerm(noteSubject(), term));

function autoTerm() {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (!current || pos !== ta.selectionEnd || ta.value[pos - 1] !== ':' || !termAutoOn()) return;
  const v = ta.value;
  const colon = pos - 1;
  const lineStart = v.lastIndexOf('\n', colon - 1) + 1;
  if (EXPANDED.test(v.slice(pos))) return; // 이미 뜻이 붙어 있다
  const found = termBefore(v.slice(lineStart, colon), (t) => !!lookupDef(t));
  if (!found) return;
  const def = lookupDef(found.term);
  if (def) return insertDef(colon, found.term, def);
  const subj = noteSubject();
  if (!subj || isLabel(found.term)) return; // "참고:", "날짜:" 같은 머리말은 건드리지 않는다
  if (settings.aiOn) aiDefine(colon, found.term, subj);
  else offerTerm(colon, found.term, subj);
}

/** 콜론(colon 위치) 뒤에 " (뜻)"을 넣고 되돌리기를 띄운다 */
function insertDef(colon, term, def, msg = '') {
  const insert = ` (${cleanDef(def)})`;
  const at = colon + 1;
  // 뜻 추가 창 등에서 돌아왔으면 넣은 글 바로 뒤에서 이어 쓰게
  const caret = document.activeElement === el.body ? el.body.selectionStart : at;
  replaceText(at, at, insert);
  setCaret(caret >= at ? caret + insert.length : caret);
  toast(msg || `‘${term}’ 뜻을 넣었어요`, '되돌리기', () => {
    if (el.body.value.slice(at, at + insert.length) !== insert) return;
    const now = el.body.selectionStart;
    replaceText(at, at + insert.length, '');
    setCaret(now >= at + insert.length ? now - insert.length : at);
  });
}

/** AI가 뜻을 쓰는 사이 글이 바뀌었으면 "용어:"를 다시 찾는다 */
function findColon(term, near) {
  const v = el.body.value;
  const key = `${term}:`;
  let best = -1;
  for (let i = v.indexOf(key); i >= 0; i = v.indexOf(key, i + 1)) {
    const colon = i + term.length;
    if (!EXPANDED.test(v.slice(colon + 1)) && (best < 0 || Math.abs(colon - near) < Math.abs(best - near))) best = colon;
  }
  return best;
}

/** Eleven AI에 넘길 것: 탭 이름, 참고 자료, 이 탭의 노트들 */
const aiInput = (subj, term) => ({
  term,
  subject: subj.name,
  rules: subj.rules ?? '',
  notes: visibleNotes().filter((n) => n.tab === subj.id).map((n) => (n === current ? el.body.value : n.body)),
});
const srcOf = (hit) => (hit.from === 'wiki' ? 'wiki' : 'notes');

let aiSeq = 0;
async function aiDefine(colon, term, subj) {
  const my = ++aiSeq;
  const note = current;
  showSuggest({ kind: 'ai', label: `‘${term}’`, text: 'Eleven AI가 뜻을 찾는 중…', action: '취소', run: () => { aiSeq++; hideSuggest(); } });
  el.suggest.classList.add('busy');
  let hit = null;
  try {
    hit = await defineTerm(aiInput(subj, term));
  } catch (err) {
    console.warn('ai', err);
    if (my !== aiSeq) return;
    el.suggest.classList.remove('busy');
    hideSuggest();
    if (current === note) offerTerm(colon, term, subj, errorMessage(err));
    return;
  }
  if (my !== aiSeq) return; // 취소했거나 다른 용어를 더 쳤다
  el.suggest.classList.remove('busy');
  if (!hit) {
    hideSuggest();
    if (current === note) offerTerm(colon, term, subj, '찾지 못했어요. 직접 적어 두면 다음부터 자동으로 들어가요');
    return;
  }
  const def = cleanDef(hit.def);
  setTerm(subj, term, def, srcOf(hit)); // 다음부터는 사전에서 바로
  if (current !== note) return hideSuggest();
  const at = findColon(term, colon);
  const after = at >= 0 ? el.body.value.slice(at + 1, (el.body.value.indexOf('\n', at) + 1 || el.body.value.length + 1) - 1) : '';
  if (at >= 0 && !after.trim()) {
    hideSuggest();
    insertDef(at, term, def, `‘${term}’ 뜻을 넣었어요 · ${sourceLabel(hit)}`);
  } else {
    // 그새 콜론 뒤에 직접 쓰기 시작했으면 끼워 넣지 않고 카드로만 보여 준다
    showSuggest({
      kind: 'term',
      label: `‘${term}’ 뜻 (${sourceLabel(hit)})`,
      text: def,
      action: '넣기',
      run: () => {
        const c = findColon(term, colon);
        hideSuggest();
        if (c >= 0) insertDef(c, term, def);
      },
    });
  }
}

/** 사전에 없는 용어: "뜻 추가" 카드 */
function offerTerm(colon, term, subj, why = '') {
  showSuggest({
    kind: 'term',
    label: `‘${term}’ 뜻이 사전에 없어요`,
    text: why || (settings.aiOn ? '직접 적어 두면 다음부터 자동으로 들어가요' : '직접 적거나, 설정에서 Eleven AI를 켜면 찾아 줘요'),
    action: '뜻 추가',
    run: () => {
      hideSuggest();
      openTermDialog(subj, term, '', (def) => {
        const c = findColon(term, colon);
        if (current && c >= 0) insertDef(c, term, def);
      });
    },
  });
}

/* ───────── 회색 미리보기: 사전에 있는 용어를 쓰면 콜론 없이도 뜻을 회색으로 ─────────
   "환율" 까지 쓰면 바로 뒤에 회색으로 ": (뜻)" → 누르거나 ":"를 치면(PC는 Tab·→) 넣는다.
   줄 끝에 쓰고 있을 때만, 그 탭의 용어 사전에 있는 말만 (인터넷으로 찾지 않는다) */

const ghostEl = $('ghost');
let ghost = null; // { at, term, def }
let ghostMirror = null;

function findGhost() {
  const ta = el.body;
  if (!current || isBibleNote() || viewMode || ink.isPenMode() || document.activeElement !== ta || !termAutoOn()) return null;
  const pos = ta.selectionStart;
  const v = ta.value;
  if (pos !== ta.selectionEnd || (pos < v.length && v[pos] !== '\n')) return null;
  const line = v.slice(v.lastIndexOf('\n', pos - 1) + 1, pos);
  if (!/[가-힣A-Za-z]$/.test(line)) return null;
  const found = termBefore(line, (t) => !!lookupDef(t));
  const def = found?.known && lookupDef(found.term);
  return def ? { at: pos, term: found.term, def: cleanDef(def) } : null;
}

/** 입력창 속 글자 위치 → 화면 좌표 (입력창과 똑같이 줄바꿈되는 보이지 않는 복사본으로 잰다) */
function caretXY(pos) {
  const ta = el.body;
  if (!ghostMirror) {
    ghostMirror = document.createElement('div');
    ghostMirror.className = 'ink-mirror';
    ghostMirror.setAttribute('aria-hidden', 'true');
    ta.parentElement.append(ghostMirror);
  }
  const cs = getComputedStyle(ta);
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordBreak', 'overflowWrap', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop']) {
    ghostMirror.style[p] = cs[p];
  }
  ghostMirror.style.width = `${ta.clientWidth}px`;
  const mark = document.createElement('span');
  mark.textContent = '​';
  ghostMirror.replaceChildren(document.createTextNode(ta.value.slice(0, pos)), mark);
  return { x: mark.offsetLeft, y: mark.offsetTop, lh: parseFloat(cs.lineHeight) || 30, padR: parseFloat(cs.paddingRight) || 0 };
}

function updateGhost() {
  ghost = findGhost();
  if (!ghost) {
    ghostEl.hidden = true;
    return;
  }
  const ta = el.body;
  const { x, y, lh, padR } = caretXY(ghost.at);
  const room = ta.clientWidth - padR - x;
  const wrap = room < 90; // 줄 끝에 자리가 없으면 다음 줄 처음에
  const top = (wrap ? y + lh : y) - ta.scrollTop + ta.offsetTop;
  if (top < ta.offsetTop - 2 || top > ta.offsetTop + ta.clientHeight - lh) {
    ghostEl.hidden = true; // 화면 밖
    return;
  }
  ghostEl.textContent = `: (${ghost.def})`;
  ghostEl.style.left = `${ta.offsetLeft + (wrap ? parseFloat(getComputedStyle(ta).paddingLeft) || 0 : x)}px`;
  ghostEl.style.top = `${top}px`;
  ghostEl.style.maxWidth = `${wrap ? ta.clientWidth - padR : room}px`;
  ghostEl.setAttribute('aria-label', `‘${ghost.term}’ 뜻 넣기: ${ghost.def}`);
  ghostEl.hidden = false;
}

let ghostTimer = 0;
function updateGhostSoon() {
  clearTimeout(ghostTimer);
  ghostTimer = setTimeout(updateGhost, 120);
}

function hideGhost() {
  clearTimeout(ghostTimer);
  ghost = null;
  ghostEl.hidden = true;
}

function acceptGhost() {
  const g = findGhost();
  hideGhost();
  if (!g) return false;
  replaceText(g.at, g.at, ':');
  insertDef(g.at, g.term, g.def);
  return true;
}

ghostEl.addEventListener('pointerdown', (e) => e.preventDefault()); // 키보드가 내려가지 않게
ghostEl.addEventListener('mousedown', (e) => e.preventDefault());
ghostEl.addEventListener('click', acceptGhost);
el.body.addEventListener('scroll', () => ghost && updateGhost());
el.body.addEventListener('keydown', (e) => {
  if (!ghost || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if ((e.key === 'Tab' || e.key === 'ArrowRight') && el.body.selectionStart === ghost.at && acceptGhost()) {
    e.preventDefault();
    e.stopImmediatePropagation(); // 들여쓰기(Tab)는 하지 않는다
  }
});

/* ───────── 구절을 누르면 뜨는 "말씀 넣기" 버튼 ───────── */

let chipTarget = null;

function findChipTarget() {
  const ta = el.body;
  if (!bible || !isBibleNote() || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) return null;
  const pos = ta.selectionStart;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = v.indexOf('\n', pos);
  if (lineEnd < 0) lineEnd = v.length;
  const line = v.slice(lineStart, lineEnd);
  const ref = refAround(line, pos - lineStart);
  if (!ref || EXPANDED.test(line.slice(ref.end))) return null;
  const verses = lookup(bible, ref);
  return verses ? { start: lineStart + ref.start, at: lineStart + ref.end, ref, label: ref.label, verses } : null;
}

function hideChip() {
  chipTarget = null;
  el.chip.hidden = true;
  el.status.hidden = !!suggestion;
}

/** 커서가 "3절"(책·장 없이 쓴 절) 위에 있으면, 앞에 나온 구절의 책·장으로 어느 말씀인지 찾는다 */
function findContextTarget() {
  const ta = el.body;
  if (!bible || !settings.context || !isBibleNote() || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) return null;
  const pos = ta.selectionStart;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = v.indexOf('\n', pos);
  if (lineEnd < 0) lineEnd = v.length;
  const line = v.slice(lineStart, lineEnd);
  const short = shortRefAround(line, pos - lineStart);
  if (!short || EXPANDED.test(line.slice(short.end))) return null;
  const from = lineStart + short.start;
  const prev = lastRef(v.slice(Math.max(0, from - 5000), from));
  if (!prev) return null;
  const ref = contextRef(short, prev);
  const verses = lookup(bible, ref);
  return verses ? { at: lineStart + short.end, label: ref.label, verses } : null;
}

function updateContextCard() {
  const t = findContextTarget();
  if (!t) {
    if (suggestion?.kind === 'context') hideSuggest();
    return;
  }
  if (suggestion?.kind === 'context' && suggestion.at === t.at && suggestion.label === t.label) return;
  const text = verseText(t.verses);
  showSuggest({
    kind: 'context',
    label: t.label,
    text,
    at: t.at,
    action: '넣기',
    run: () => {
      if (findContextTarget()?.at !== t.at) return hideSuggest();
      const insert = ` (${text})`;
      replaceText(t.at, t.at, insert);
      setCaret(t.at + insert.length);
      hideSuggest();
    },
  });
}

function updateChip() {
  refreshChip();
  updateFmtBar();
}

function refreshChip() {
  const t = findChipTarget();
  if (!t) {
    hideChip();
    updateContextCard();
    return;
  }
  if (suggestion && suggestion.kind !== 'phrase' && suggestion.kind !== 'context') return; // 용어 카드가 떠 있으면 그대로
  hideSuggest(); // 구절 표기("요 3:16")가 있으면 그쪽이 우선
  const same = chipTarget && !el.chip.hidden && chipTarget.label === t.label;
  chipTarget = t;
  el.chip.textContent = `${t.label} 말씀 넣기`;
  el.chip.hidden = false;
  el.status.hidden = true;
  if (!same) {
    el.chip.style.animation = 'none';
    void el.chip.offsetWidth;
    el.chip.style.animation = '';
  }
}

let chipTimer = 0;
function updateChipSoon() {
  clearTimeout(chipTimer);
  chipTimer = setTimeout(updateChip, 30);
}

document.addEventListener('selectionchange', () => {
  if (document.activeElement !== el.body) return;
  updateChipSoon();
  schedulePhrase();
  checkSlash();
  updateGhostSoon();
});
el.body.addEventListener('click', updateChipSoon);
el.body.addEventListener('focus', updateChipSoon);
el.body.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement === el.body) return;
  hideChip();
  hideSuggest();
  hideBlockBar();
  hideGhost();
  updateFmtBar();
}, 150));

// 버튼을 눌러도 키보드가 내려가지 않게
for (const b of [el.chip, el.suggest, el.toastAction]) b.addEventListener('pointerdown', (e) => e.preventDefault());

el.chip.addEventListener('click', () => {
  const t = findChipTarget() || chipTarget;
  if (!t || el.body.value.slice(t.start, t.at) !== t.ref.raw) return;
  const insert = `${headOf(t.ref)} (${verseText(t.verses)})`;
  replaceText(t.start, t.at, insert);
  setCaret(t.start + insert.length);
  hideChip();
});

/* ───────── 문구로 말씀 찾기 (역추적) ─────────
   "하나님께서 세상을 사랑하사"처럼 말씀 문구를 쓰면 → 아래에 "요한복음 3:16 · 바꾸기" 제안.
   줄 전체가 확실히 한 절이면 줄을 바꿀 때 바로 "요한복음 3:16 (말씀)"으로 바꾼다. */

const PHRASE_MAX_WORDS = 12;
let suggestion = null; // { start, end, phrase, label, text }
let phraseTimer = 0;
const declined = new Set(); // 되돌리기 한 문구 → 다시 제안하거나 자동으로 바꾸지 않는다

/** 커서 앞, 같은 줄에서 마지막 괄호 뒤로 쓴 단어들 (넣어 둔 말씀 본문은 빼고) */
function wordsBeforeCaret() {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return null;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  const before = v.slice(lineStart, pos);
  const open = before.lastIndexOf('(');
  const close = before.lastIndexOf(')');
  if (open > close) return null; // 괄호 안을 고치는 중
  const from = lineStart + Math.max(open, close) + 1;
  return tokenize(v.slice(from, pos))
    .slice(-PHRASE_MAX_WORDS)
    .map((t) => ({ ...t, start: t.start + from, end: t.end + from }));
}

function schedulePhrase() {
  clearTimeout(phraseTimer);
  phraseTimer = setTimeout(runPhrase, 350);
}

async function runPhrase() {
  if (!isBibleNote()) return;
  if (suggestion && suggestion.kind !== 'phrase') return; // "3절"·용어 카드가 우선
  const ready = settings.phrase && bible && !chipTarget && document.activeElement === el.body;
  const tokens = ready ? wordsBeforeCaret() : null;
  if (!tokens || tokens.length < 2) return hideSuggest();
  const snapshot = el.body.value;
  const best = await suggestFor(tokens.map((t) => t.word));
  // 찾는 사이에 글이 바뀌었으면 버린다 (곧 다시 찾음)
  if (el.body.value !== snapshot || chipTarget || (suggestion && suggestion.kind !== 'phrase') || document.activeElement !== el.body) return;
  if (!best) return hideSuggest();
  const start = tokens[best.k].start;
  const end = tokens[tokens.length - 1].end;
  const phrase = snapshot.slice(start, end);
  if (declined.has(phrase)) return hideSuggest();
  showPhraseCard({ start, end, phrase, ...verseInfo(best) });
}

function showPhraseCard(s) {
  showSuggest({ ...s, kind: 'phrase', action: '바꾸기', run: () => applyPhrase(s) });
}

/** 툴바 카드: { kind, label, text, action('바꾸기'|'넣기'), run } */
function showSuggest(s) {
  hideBlockBar();
  suggestion = s;
  el.suggestRef.textContent = s.label;
  el.suggestText.textContent = s.text;
  el.suggestGo.textContent = s.action;
  el.suggest.hidden = false;
  el.openFinder.hidden = true;
  el.status.hidden = true;
}

function hideSuggest() {
  if (!suggestion) return;
  suggestion = null;
  el.suggest.hidden = true;
  el.openFinder.hidden = !!blockMode || ink.isPenMode();
  el.status.hidden = !el.chip.hidden;
}

/** 문구를 "요한복음 3:16 (말씀)"으로 바꾸고, 되돌리기를 띄운다 */
function applyPhrase(s) {
  const ta = el.body;
  if (ta.value.slice(s.start, s.end) !== s.phrase) return hideSuggest();
  const caret = ta.selectionStart;
  const insert = `${s.label} (${s.text})`;
  const delta = insert.length - s.phrase.length;
  replaceText(s.start, s.end, insert);
  setCaret(caret >= s.end ? caret + delta : s.start + insert.length);
  hideSuggest();
  toast(`${s.label} 말씀으로 바꿨어요`, '되돌리기', () => {
    if (el.body.value.slice(s.start, s.start + insert.length) !== insert) return;
    declined.add(s.phrase);
    const now = el.body.selectionStart;
    replaceText(s.start, s.start + insert.length, s.phrase);
    setCaret(now >= s.start + insert.length ? now - delta : s.start + s.phrase.length);
  });
}

el.suggest.addEventListener('click', () => suggestion?.run());

/** 방금 줄을 바꿨는데 그 줄 전체가 확실히 한 절이면 바로 바꾼다 */
async function autoPhraseLine() {
  if (!bible || !settings.phrase || !settings.phraseAuto || !isBibleNote()) return;
  const ta = el.body;
  const nl = ta.selectionStart - 1;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', nl - 1) + 1;
  const line = v.slice(lineStart, nl);
  if (/[()]/.test(line)) return; // 이미 말씀이 들어간 줄
  const tokens = tokenize(line);
  if (tokens.length < 3 || tokens.length > PHRASE_MAX_WORDS) return;
  const note = current;
  const best = await wholeLineMatch(tokens.map((t) => t.word));
  if (!best || current !== note || ta.value.slice(lineStart, nl + 1) !== `${line}\n`) return;
  // 줄 앞의 번호·기호("1. ")는 남기고 단어 부분만 바꾼다
  const start = lineStart + tokens[0].start;
  const end = lineStart + tokens[tokens.length - 1].end;
  const phrase = ta.value.slice(start, end);
  if (!declined.has(phrase)) applyPhrase({ start, end, phrase, ...verseInfo(best) });
}

/* ───────── 말씀 찾기 ───────── */

let finderCaret = 0;
let finderResult = null;
let finderPicks = []; // 문구로 찾은 절들 [{ label, text }]
let finderSeq = 0;

function finderHint(text) {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = text;
  el.finderPreview.replaceChildren(hint);
}

/** 구절 표기가 아니면 문구로 찾아 목록을 보여준다 */
async function renderFinderPhrase(words) {
  const my = ++finderSeq;
  finderHint('찾는 중…');
  const results = (await searchPhrase(words)).filter((r) => r.score >= 0.4);
  if (my !== finderSeq) return;
  finderPicks = results.map(verseInfo);
  el.finderInsert.disabled = !finderPicks.length; // 누르면 맨 위 절을 넣는다
  if (!finderPicks.length) return finderHint('비슷한 말씀을 찾지 못했어요');
  const list = document.createElement('div');
  list.className = 'picks';
  for (const p of finderPicks) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick';
    const ref = document.createElement('b');
    ref.textContent = p.label;
    const text = document.createElement('span');
    text.textContent = p.text;
    b.append(ref, text);
    b.addEventListener('click', () => insertAtFinderCaret(`${p.label} (${p.text})`));
    list.append(b);
  }
  el.finderPreview.replaceChildren(list);
}

function renderFinder() {
  const q = el.finderInput.value;
  const box = el.finderPreview;
  finderResult = null;
  finderPicks = [];
  finderSeq++;
  box.replaceChildren();
  if (q.trim()) {
    const ref = parseRef(q);
    const verses = ref && bible ? lookup(bible, ref) : null;
    const words = tokenize(q).map((t) => t.word);
    if (!ref && bible && words.length && words.join('').length >= 2) {
      renderFinderPhrase(words);
    } else if (verses) {
      finderResult = { ref, verses };
      const head = document.createElement('div');
      head.className = 'ref';
      head.textContent = ref.label;
      box.append(head);
      const multiChapter = verses.some((v) => v.c !== verses[0].c);
      for (const v of verses) {
        const p = document.createElement('p');
        if (verses.length > 1) {
          const sup = document.createElement('sup');
          sup.textContent = multiChapter ? `${v.c}:${v.v}` : v.v;
          p.append(sup);
        }
        p.append(v.text);
        box.append(p);
      }
      const terms = termsIn(verses.map((v) => v.text).join(' '));
      if (terms.length) {
        const div = document.createElement('div');
        div.className = 'terms';
        for (const t of terms) {
          const line = document.createElement('p');
          const b = document.createElement('b');
          b.textContent = t.term;
          line.append(b, ` — ${t.meaning}`);
          div.append(line);
        }
        box.append(div);
      }
    } else {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = !bible ? '성경을 불러오는 중이에요…'
        : ref ? '해당 장·절이 없어요'
        : '구절(예: 요 3:16)이나 말씀 문구(예: 세상을 사랑하사)를 입력하세요';
      box.append(hint);
    }
  }
  el.finderInsert.disabled = !finderResult;
}

function openFinder() {
  finderCaret = el.body.selectionEnd;
  el.finderInput.value = '';
  renderFinder();
  el.finder.showModal();
  el.finderInput.focus();
  loadBible().then(renderFinder, () => {});
}

function insertAtFinderCaret(text) {
  const v = el.body.value;
  const at = Math.min(finderCaret, v.length);
  const full = (at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '') + text;
  el.finder.close();
  replaceText(at, at, full);
  setCaret(at + full.length);
  updateChip();
}

function insertFromFinder() {
  if (finderResult) insertAtFinderCaret(`${headOf(finderResult.ref)} (${verseText(finderResult.verses)})`);
  else if (finderPicks.length) insertAtFinderCaret(`${finderPicks[0].label} (${finderPicks[0].text})`);
}

let finderTimer = 0;
el.finderInput.addEventListener('input', () => {
  clearTimeout(finderTimer);
  finderTimer = setTimeout(() => {
    finderTimer = 0;
    renderFinder();
  }, 200);
});
el.finderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (finderTimer) {
      clearTimeout(finderTimer);
      finderTimer = 0;
      renderFinder();
    }
    insertFromFinder();
  }
});
el.finderInsert.addEventListener('click', insertFromFinder);
$('open-finder').addEventListener('click', () => (isBibleNote() ? openFinder() : openSubjectSheet(noteSubject(), { insert: true })));

/* ───────── 글자 서식: 글자를 선택하면 아래에 버튼 ───────── */

const FORMATS = { bold: { b: 1 }, red: { c: 'red' }, blue: { c: 'blue' }, hl: { h: 1 }, clear: null };

function updateFmtBar() {
  const ta = el.body;
  const on = !ink.isPenMode() && !blockMode && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd;
  el.fmtBar.hidden = !on;
  el.openFinder.hidden = on || !!suggestion || !!blockMode || ink.isPenMode();
}

for (const b of document.querySelectorAll('[data-fmt]')) {
  // 버튼을 눌러도 선택이 풀리거나 키보드가 내려가지 않게
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    const { selectionStart: start, selectionEnd: end } = el.body;
    if (!current || end <= start) return;
    marks = applyMark(marks, start, end, FORMATS[b.dataset.fmt]);
    current.marks = marks;
    overlayDirty = true;
    scheduleSave();
    drawMarks();
    el.body.focus();
  });
}

/* ───────── 성경 탭에서 고른 말씀을 메모에 넣기 ───────── */

function appendToNote(id, text) {
  const now = Date.now();
  let note = notes.find((n) => n.id === id && !n.deleted);
  if (!note) {
    note = { id: newId(), title: '', body: '', tab: '', created: now, updated: now };
    notes.push(note);
  }
  note.body = note.body ? `${note.body.replace(/\s+$/, '')}\n${text}\n` : `${text}\n`;
  note.updated = now + 1;
  saveNotes(notes);
  push('notes', note);
  openNote(note.id, true);
  el.body.scrollTop = el.body.scrollHeight;
  toast('말씀을 메모에 넣었어요');
}

/** 어느 메모에 넣을지 고르는 창 */
function pickNote(text, done) {
  const choose = (id) => {
    el.noteTarget.close();
    appendToNote(id, text);
    done();
  };
  const row = (title, sub, id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick';
    const head = document.createElement('b');
    head.textContent = title;
    b.append(head);
    if (sub) {
      const span = document.createElement('span');
      span.textContent = sub;
      b.append(span);
    }
    b.addEventListener('click', () => choose(id));
    return b;
  };
  const recent = visibleNotes().sort((a, b) => b.updated - a.updated).slice(0, 5);
  el.noteTargetList.replaceChildren(
    row('＋ 새 메모', '', null),
    ...recent.map((n) => row(n.title.trim() || '제목 없음', n.body.replace(/\s+/g, ' ').trim().slice(0, 40), n.id)),
  );
  el.noteTarget.showModal();
}

/* ───────── 주제 탭 설정 (이름 · 규칙과 참고 자료 · 용어 사전) ───────── */

let sheetSubject = null; // 고치고 있는 탭 (null = 새로 만드는 중)
let sheetInsert = false; // 편집 화면에서 열었으면 용어를 누르면 노트에 넣는다
let sheetCaret = 0;

function openSubjectSheet(subj, { insert = false } = {}) {
  sheetSubject = subj;
  sheetInsert = insert && !!subj;
  sheetCaret = el.body.selectionEnd;
  const creating = !subj;
  $('subject-title').textContent = creating ? '새 탭 만들기' : `${subj.name} 탭`;
  $('subject-name').value = subj?.name ?? '';
  $('subject-rules').value = subj?.rules ?? '';
  $('subject-auto').checked = subj ? subj.auto !== false : true;
  $('dict-search').value = '';
  $('dict-bulk').value = '';
  $('subject-create').hidden = !creating;
  $('subject-delete').hidden = creating;
  renderSubjectAi();
  renderDict();
  el.subjectSheet.showModal();
  if (creating) $('subject-name').focus();
}

function renderSubjectAi() {
  $('subject-ai').textContent = settings.aiOn
    ? 'Eleven AI: 사전에 없는 용어는 위 참고 자료와 이 탭의 노트에서 먼저 찾고, 없으면 위키백과에서 찾아 한 문장으로 넣어요. 찾은 뜻은 사전에 저장돼요.'
    : 'Eleven AI 꺼짐: 사전에 있는 용어만 들어가요. 설정에서 켤 수 있어요.';
}

const SRC_TAG = { ai: 'AI', wiki: '위키백과', notes: '자료' };

function renderDict() {
  const subj = sheetSubject;
  const box = $('dict-list');
  $('dict-count').textContent = subj ? `${termCount(subj)}개` : '';
  if (!subj) return box.replaceChildren();
  const items = listTerms(subj, $('dict-search').value);
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'dict-empty';
    p.textContent = termCount(subj) ? '찾는 용어가 없어요' : '아직 용어가 없어요. 노트를 쓰다가 채워지거나, 아래에서 추가할 수 있어요.';
    return box.replaceChildren(p);
  }
  box.replaceChildren(...items.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dict-item';
    const head = document.createElement('b');
    head.textContent = e.t;
    if (SRC_TAG[e.src]) {
      const tag = document.createElement('small');
      tag.textContent = SRC_TAG[e.src];
      head.append(tag);
    }
    const body = document.createElement('span');
    body.textContent = e.d;
    b.append(head, body);
    b.addEventListener('click', () => {
      if (sheetInsert) {
        el.subjectSheet.close();
        const v = el.body.value;
        const at = Math.min(sheetCaret, v.length);
        const text = `${at > 0 && !/\s/.test(v[at - 1]) ? ' ' : ''}${e.t}: (${e.d})`;
        replaceText(at, at, text);
        setCaret(at + text.length);
      } else {
        openTermDialog(subj, e.t, e.d, renderDict);
      }
    });
    return b;
  }));
}

let sheetTimer = 0;
function saveSheetSoon() {
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(saveSheet, 500);
}
function saveSheet() {
  clearTimeout(sheetTimer);
  const subj = sheetSubject;
  if (!subj) return;
  const name = $('subject-name').value.trim();
  const rules = $('subject-rules').value;
  const auto = $('subject-auto').checked;
  if ((name && name !== subj.name) || rules !== subj.rules || auto !== (subj.auto !== false)) {
    updateSubject(subj, { name: name || subj.name, rules, auto });
    $('subject-title').textContent = `${subj.name} 탭`;
    renderList();
    if (current) updateMeta();
  }
}
for (const id of ['subject-name', 'subject-rules']) $(id).addEventListener('input', saveSheetSoon);
$('subject-auto').addEventListener('change', saveSheet);
el.subjectSheet.addEventListener('close', saveSheet);

$('subject-create').addEventListener('click', () => {
  const name = $('subject-name').value.trim();
  if (!name) {
    $('subject-name').focus();
    return toast('탭 이름을 적어 주세요');
  }
  const subj = createSubject(name, newId());
  updateSubject(subj, { rules: $('subject-rules').value, auto: $('subject-auto').checked });
  settings.subject = subj.id;
  saveSettings(settings);
  sheetSubject = subj;
  $('subject-create').hidden = true;
  $('subject-delete').hidden = false;
  $('subject-title').textContent = `${subj.name} 탭`;
  renderDict();
  renderList();
  toast(`‘${name}’ 탭을 만들었어요. 규칙·참고 자료와 용어를 적어 두세요`);
});

$('subject-delete').addEventListener('click', () => {
  const subj = sheetSubject;
  if (!subj) return;
  const mine = visibleNotes().filter((n) => n.tab === subj.id);
  const msg = `‘${subj.name}’ 탭을 지울까요?${mine.length ? `\n이 탭의 노트 ${mine.length}개는 ‘말씀’ 탭으로 옮겨져요.` : ''}\n용어 사전도 함께 지워져요.`;
  if (!confirm(msg)) return;
  const now = Date.now();
  for (const n of mine) {
    Object.assign(n, { tab: '', updated: now });
    push('notes', n);
  }
  saveNotes(notes);
  deleteSubject(subj);
  sheetSubject = null;
  el.subjectSheet.close();
  if (settings.subject === subj.id) {
    settings.subject = '';
    saveSettings(settings);
  }
  renderList();
});

$('dict-search').addEventListener('input', renderDict);
$('dict-add').addEventListener('click', () => {
  if (!sheetSubject) return toast('먼저 탭 이름을 적고 탭을 만들어 주세요');
  openTermDialog(sheetSubject, '', '', renderDict);
});
$('dict-import').addEventListener('click', () => {
  if (!sheetSubject) return toast('먼저 탭 이름을 적고 탭을 만들어 주세요');
  const n = importTerms(sheetSubject, $('dict-bulk').value);
  if (!n) return toast("'용어: 뜻' 모양의 줄을 찾지 못했어요");
  $('dict-bulk').value = '';
  renderDict();
  toast(`용어 ${n}개를 사전에 넣었어요`);
});

/* 용어 하나 추가 · 고치기 */
let termCtx = null; // { subj, original, done }

function openTermDialog(subj, term, def, done) {
  termCtx = { subj, original: term, done };
  $('term-dialog-title').textContent = term && def ? '용어 고치기' : '용어 추가';
  $('term-word').value = term;
  $('term-def').value = def;
  $('term-remove').hidden = !(term && def);
  $('term-ai').hidden = !settings.aiOn;
  el.termDialog.showModal();
  (term ? $('term-def') : $('term-word')).focus();
}

$('term-save').addEventListener('click', () => {
  const { subj, original, done } = termCtx;
  const term = $('term-word').value.trim();
  const def = $('term-def').value.trim();
  if (!term || !def) return toast('용어와 뜻을 모두 적어 주세요');
  if (original && original !== term) removeTerm(subj, original);
  setTerm(subj, term, def, 'me');
  el.termDialog.close();
  done?.(cleanDef(def));
  if (el.subjectSheet.open) renderDict();
});

$('term-remove').addEventListener('click', () => {
  const { subj, original } = termCtx;
  removeTerm(subj, original);
  el.termDialog.close();
  if (el.subjectSheet.open) renderDict();
});

$('term-ai').addEventListener('click', async () => {
  const { subj } = termCtx;
  const term = $('term-word').value.trim();
  if (!term) return toast('용어를 먼저 적어 주세요');
  const btn = $('term-ai');
  btn.disabled = true;
  btn.textContent = '찾는 중…';
  try {
    const hit = await defineTerm(aiInput(subj, term));
    if (hit) {
      $('term-def').value = cleanDef(hit.def);
      toast(`${sourceLabel(hit)}에서 찾았어요. 고쳐서 저장해도 돼요`);
    } else {
      toast('찾지 못했어요. 직접 적어 주세요');
    }
  } catch (err) {
    console.warn('ai', err);
    toast(errorMessage(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Eleven AI로 찾기';
  }
});

/* ───────── 어려운 단어 풀이 ───────── */

function updateGloss() {
  const n = current && isBibleNote() ? termsInNote(el.body.value).length : 0;
  el.glossCount.hidden = !n;
  el.glossCount.textContent = n > 99 ? '99+' : String(n);
}

let glossTimer = 0;
function updateGlossSoon() {
  clearTimeout(glossTimer);
  glossTimer = setTimeout(updateGloss, 400);
}

$('open-gloss').addEventListener('click', () => showTerms(termsInNote(el.body.value), '이 메모에 넣은 말씀'));

function showTerms(terms, where) {
  el.glossNote.textContent = terms.length
    ? `${where}에서 ${terms.length}개를 찾았어요`
    : `${where}에서는 풀이할 어려운 단어를 찾지 못했어요`;
  el.glossList.replaceChildren(...terms.map((t) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = t.term;
    const dd = document.createElement('dd');
    dd.textContent = t.meaning;
    d.append(dt, dd);
    return d;
  }));
  el.gloss.showModal();
}

/* ───────── 펜 필기 ───────── */

ink.initInk({
  textarea: el.body,
  canvas: $('ink'),
  onChange: (strokes) => {
    if (!current) return;
    current.ink = strokes;
    overlayDirty = true;
    scheduleSave();
  },
});

let penTool = 'k';
function setPen(on) {
  if (ink.isPenMode() === on) return;
  ink.setPenMode(on);
  el.penToggle.setAttribute('aria-pressed', String(on));
  el.penBar.hidden = !on;
  el.openFinder.hidden = on;
  el.status.hidden = on;
  if (on) {
    hideChip();
    hideSuggest();
    el.status.hidden = true;
    selectTool(penTool);
  }
  updateFmtBar();
}

function selectTool(t) {
  penTool = t;
  ink.setTool(t);
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
}

el.penToggle.addEventListener('click', () => {
  if (viewMode) setView(false); // 필기는 편집 화면 위에 그린다
  setPen(!ink.isPenMode());
});
$('pen-done').addEventListener('click', () => setPen(false));
$('pen-undo').addEventListener('click', () => ink.undo());
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => selectTool(b.dataset.tool));

/* ───────── 설정 · 백업 ───────── */

const TOGGLES = {
  'set-auto': 'auto',
  'set-fullname': 'fullName',
  'set-numbers': 'numbers',
  'set-context': 'context',
  'set-phrase': 'phrase',
  'set-phrase-auto': 'phraseAuto',
  'set-symbols': 'symbols',
  'set-godpia': 'godpiaAuto',
  'set-ai': 'aiOn',
  'set-blocks': 'blocks',
};

// 글자 크기 (메모 본문)
const FONT_SIZES = { s: 15, m: 17, l: 20, xl: 24 };
function applyFontSize() {
  document.documentElement.style.setProperty('--note-size', `${FONT_SIZES[settings.fontSize] ?? 17}px`);
  ink.redraw(); // 글자 크기가 바뀌면 필기도 바뀐 줄 위치에 맞춰 다시 그린다
  drawMarks();
  for (const b of document.querySelectorAll('[data-font]')) b.setAttribute('aria-pressed', String(b.dataset.font === settings.fontSize));
}
for (const b of document.querySelectorAll('[data-font]')) {
  b.addEventListener('click', () => {
    settings.fontSize = b.dataset.font;
    saveSettings(settings);
    applyFontSize();
  });
}
applyFontSize();

function openSettings() {
  for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = settings[key];
  el.settings.showModal();
}

for (const [id, key] of Object.entries(TOGGLES)) {
  $(id).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    saveSettings(settings);
  });
}

$('abbr').append(...BOOKS.map(([name, short]) => {
  const d = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = short;
  d.append(b, name);
  return d;
}));

$('export').addEventListener('click', () => {
  flushSave();
  const data = { app: 'Eleven AI 노트', version: 2, exported: new Date().toISOString(), notes: visibleNotes(), subjects: exportSubjects() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const d = new Date();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Eleven-AI-노트-백업-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.notes).filter(
      (n) => n && typeof n.id === 'string' && typeof n.body === 'string' && !n.deleted,
    );
    let added = 0;
    for (const n of incoming) {
      const note = {
        id: n.id,
        title: String(n.title ?? ''),
        body: n.body,
        ink: parseOverlay(n.ink).ink,
        marks: Array.isArray(n.marks) ? n.marks : [],
        tab: typeof n.tab === 'string' ? n.tab : '',
        pinned: !!n.pinned,
        created: Number(n.created) || Date.now(),
        updated: Number(n.updated) || Date.now(),
      };
      const i = notes.findIndex((x) => x.id === note.id);
      if (i < 0) {
        notes.push(note);
      } else if (note.updated > notes[i].updated) {
        notes[i] = note;
      } else {
        continue;
      }
      added++;
      push('notes', note);
    }
    const tabs = Array.isArray(data) ? 0 : importSubjects(data.subjects);
    saveNotes(notes);
    renderList();
    toast(added || tabs ? `노트 ${added}개${tabs ? `, 탭 ${tabs}개` : ''}를 불러왔어요` : '새로 불러올 노트가 없어요');
  } catch {
    toast('백업 파일을 읽지 못했어요');
  }
});

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}
for (const dlg of document.querySelectorAll('dialog.sheet')) {
  // 바깥(어두운 부분)을 누르면 닫기
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
}

/* ───────── 노트 메뉴: 고정 · 다른 탭으로 옮기기 · 공유 · 삭제 ───────── */

function openNoteMenu() {
  if (!current) return;
  flushSave();
  $('menu-pin').querySelector('span').textContent = current.pinned ? '고정 풀기' : '목록 맨 위에 고정';
  const tabs = [{ id: '', name: '말씀' }, ...allSubjects()];
  $('menu-tabs').replaceChildren(...tabs.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'subject-chip';
    b.textContent = t.name;
    b.setAttribute('aria-pressed', String(tabOf(current) === t.id));
    b.addEventListener('click', () => moveNote(t));
    return b;
  }));
  el.noteMenu.showModal();
}

/** 지금 노트를 다른 주제 탭으로 */
function moveNote(t) {
  el.noteMenu.close();
  if (!current || tabOf(current) === t.id) return;
  Object.assign(current, { tab: t.id, updated: Date.now() });
  saveNotes(notes);
  push('notes', current);
  updateMeta();
  updateGloss();
  el.finderLabel.textContent = isBibleNote() ? '말씀 찾기' : '용어 사전';
  // 목록으로 돌아가면 옮긴 탭이 보이게
  settings.subject = t.id;
  saveSettings(settings);
  toast(`‘${t.name}’ 탭으로 옮겼어요`);
}

$('more').addEventListener('click', openNoteMenu);

$('menu-pin').addEventListener('click', () => {
  el.noteMenu.close();
  if (!current) return;
  current.pinned = !current.pinned;
  current.updated = Date.now();
  saveNotes(notes);
  push('notes', current);
  updateMeta();
  toast(current.pinned ? '목록 맨 위에 고정했어요' : '고정을 풀었어요');
});

$('menu-share').addEventListener('click', async () => {
  el.noteMenu.close();
  flushSave();
  const title = el.title.value.trim();
  const text = [title, el.body.value].filter(Boolean).join('\n\n');
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ title: title || 'Eleven AI 노트', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('노트를 복사했어요');
    }
  } catch { /* 공유 취소 */ }
});

$('menu-delete').addEventListener('click', () => {
  el.noteMenu.close();
  if (!current || !confirm('이 노트를 삭제할까요?')) return;
  clearTimeout(saveTimer);
  deleteNote(current);
  current = null;
  goBack();
});

/* ───────── 정리해서 보기 (노션처럼: 토글 접기·펴기, 할 일 체크) ───────── */

let viewMode = false;

function setView(on) {
  if (on) {
    flushSave();
    setPen(false);
    hideChip();
    hideSuggest();
    hideBlockBar();
    hideGhost();
    if (document.activeElement === el.body) el.body.blur();
  }
  viewMode = on;
  el.editorView.classList.toggle('viewing', on);
  el.view.hidden = !on;
  el.viewToggle.setAttribute('aria-pressed', String(on));
  el.viewToggle.setAttribute('aria-label', on ? '편집하기' : '정리해서 보기');
  if (on) renderView();
  else el.view.replaceChildren();
}

el.viewToggle.addEventListener('click', () => setView(!viewMode));
$('view-edit').addEventListener('click', () => editAt(el.body.value.length));

/** 보기 화면에서 글을 바꿀 때 (입력창은 숨어 있으니 값을 바로 바꾼다) */
function setBody(text) {
  el.body.value = text;
  lastLen = text.length;
  bodyChanged();
  scheduleSave();
  renderView();
}

function renderView() {
  if (!viewMode) return;
  const text = el.body.value;
  const nodes = parseBlocks(text);
  const out = [];
  if (current?.ink?.length) out.push(viewHint('펜 필기는 편집 화면에서 보여요'));
  const heads = nodes.flatMap(function flat(n) { return [n, ...n.children.flatMap(flat)]; })
    .filter((n) => /^h[123]$/.test(n.line.kind) && n.line.content.trim());
  if (heads.length >= 2) {
    const nav = document.createElement('nav');
    nav.className = 'outline';
    nav.setAttribute('aria-label', '목차');
    for (const h of heads) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `outline-${h.line.kind}`;
      b.textContent = h.line.content.trim();
      b.dataset.goto = h.line.start;
      nav.append(b);
    }
    out.push(nav);
  }
  if (!nodes.length) out.push(viewHint('아직 내용이 없어요. 눌러서 쓰기'));
  out.push(...nodes.map(renderBlock));
  el.view.replaceChildren(...out);
  updateViewBar(text);
}

function viewHint(text) {
  const p = document.createElement('p');
  p.className = 'view-hint';
  p.textContent = text;
  return p;
}

function renderBlock({ line, children }) {
  const blk = document.createElement('div');
  blk.className = `blk blk-${line.kind}${line.done ? ' done' : ''}${line.open ? ' open' : ''}`;
  blk.dataset.at = line.start;
  blk.dataset.end = line.end;
  if (line.kind === 'divider') {
    blk.append(document.createElement('hr'));
  } else {
    const row = document.createElement('div');
    row.className = 'blk-row';
    if (line.kind === 'toggle' || line.kind === 'todo') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = line.kind === 'toggle' ? 'blk-arrow' : 'blk-check';
      btn.dataset.flip = line.start;
      if (line.kind === 'toggle') {
        btn.setAttribute('aria-expanded', String(line.open));
        btn.setAttribute('aria-label', line.open ? '접기' : '펼치기');
      } else {
        btn.setAttribute('role', 'checkbox');
        btn.setAttribute('aria-checked', String(line.done));
        btn.setAttribute('aria-label', '할 일');
      }
      row.append(btn);
    } else if (line.kind === 'bullet' || line.kind === 'num') {
      const mark = document.createElement('span');
      mark.className = 'blk-mark';
      mark.textContent = line.kind === 'num' ? `${line.num}${line.delim}` : '•';
      row.append(mark);
    }
    const textBox = document.createElement('div');
    textBox.className = 'blk-text';
    textBox.append(...inlineText(line.start + line.indentStr.length + line.markerLen, line.end));
    row.append(textBox);
    blk.append(row);
  }
  if (children.length || (line.kind === 'toggle' && line.open)) {
    const kids = document.createElement('div');
    kids.className = 'blk-kids';
    if (line.kind === 'toggle' && !line.open) kids.hidden = true;
    if (children.length) {
      kids.append(...children.map(renderBlock));
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'blk-add';
      add.textContent = '빈 토글 · 눌러서 안에 쓰기';
      add.dataset.child = line.start;
      kids.append(add);
    }
    blk.append(kids);
  }
  return blk;
}

/** 글자 [s, e)를 서식(굵게·색)대로 나눈 조각들. 조각마다 글 속 위치(data-s)를 달아 누른 곳을 찾는다 */
function inlineText(s, e) {
  const v = el.body.value;
  const out = [];
  const seg = (a, b, m) => {
    const span = document.createElement('span');
    span.dataset.s = a;
    span.textContent = v.slice(a, b);
    if (m) span.className = [m.b ? 'm-bold' : '', m.c ? `m-${m.c}` : '', m.h ? 'm-hl' : ''].join(' ').trim();
    out.push(span);
  };
  let pos = s;
  for (const m of marks) {
    const a = Math.max(m.s, s);
    const b = Math.min(m.e, e);
    if (b <= a) continue;
    if (a > pos) seg(pos, a);
    seg(a, b, m);
    pos = b;
  }
  if (pos < e) seg(pos, e);
  return out;
}

function updateViewBar(text) {
  const toggles = (text.match(/^[ \t　]*[▸▾] /gm) ?? []).length;
  $('view-expand').hidden = !toggles;
  $('view-collapse').hidden = !toggles;
  const todo = todoCount(text);
  $('view-todo').textContent = todo.total ? `할 일 ${todo.done}/${todo.total}` : '';
}

/** 토글 ▸↔▾, 할 일 ☐↔☑ (start = 그 줄의 처음) */
function flipLine(start) {
  const v = el.body.value;
  let end = v.indexOf('\n', start);
  if (end < 0) end = v.length;
  const p = parseLine(v.slice(start, end));
  const to = flippedMarker(p);
  if (!to) return;
  const a = start + p.indentStr.length;
  setBody(v.slice(0, a) + to + v.slice(a + p.markerLen));
}

/** 빈 토글 안에 쓰기: 토글 줄 끝에 들여 쓴 새 줄을 만들고 편집 화면으로 */
function addChild(start) {
  const v = el.body.value;
  let end = v.indexOf('\n', start);
  if (end < 0) end = v.length;
  const ins = `\n${parseLine(v.slice(start, end)).indentStr}${INDENT}`;
  setView(false);
  el.body.focus();
  replaceText(end, end, ins);
  setCaret(end + ins.length);
}

/** 편집 화면으로 바꾸고 pos에 커서를 둔다 */
function editAt(pos) {
  setView(false);
  const p = Math.max(0, Math.min(pos, el.body.value.length));
  el.body.setSelectionRange(p, p);
  el.body.focus();
  // 커서가 보이도록: 그 줄 위치까지 스크롤
  const before = el.body.value.slice(0, p).split('\n').length - 1;
  const lh = parseFloat(getComputedStyle(el.body).lineHeight) || 30;
  const y = before * lh;
  if (y < el.body.scrollTop || y > el.body.scrollTop + el.body.clientHeight - lh) el.body.scrollTop = Math.max(0, y - el.body.clientHeight / 3);
  updateChipSoon();
}

function posFromPoint(x, y) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    node = p?.offsetNode;
    offset = p?.offset ?? 0;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    offset = r?.startOffset ?? 0;
  }
  const span = node?.nodeType === 3 ? node.parentElement : null;
  return span?.dataset.s != null ? Number(span.dataset.s) + offset : null;
}

el.view.addEventListener('click', (e) => {
  const flip = e.target.closest('[data-flip]');
  if (flip) return flipLine(Number(flip.dataset.flip));
  const child = e.target.closest('[data-child]');
  if (child) return addChild(Number(child.dataset.child));
  const go = e.target.closest('[data-goto]');
  if (go) {
    el.view.querySelector(`.blk[data-at="${go.dataset.goto}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (getSelection()?.toString()) return; // 글자를 골라 복사하는 중
  // 글을 누르면 그 자리에서 편집 (글이 없는 곳이면 그 줄 끝, 그것도 아니면 맨 끝)
  const pos = posFromPoint(e.clientX, e.clientY);
  const blk = e.target.closest('.blk');
  editAt(pos ?? (blk ? Number(blk.dataset.end) : el.body.value.length));
});

$('view-expand').addEventListener('click', () => setBody(el.body.value.replace(/^([ \t　]*)▸ /gm, '$1▾ ')));
$('view-collapse').addEventListener('click', () => setBody(el.body.value.replace(/^([ \t　]*)▾ /gm, '$1▸ ')));

/* ───────── Google 로그인 · 동기화 ───────── */

const SYNC_TEXT = {
  off: '로그인하면 휴대폰·PC 어디서나 같은 노트·탭·용어 사전을 볼 수 있어요',
  loading: '연결하는 중…',
  syncing: '동기화 중…',
  synced: '동기화됨',
  offline: '오프라인 · 인터넷에 연결되면 동기화돼요',
  error: '동기화 오류 · 잠시 후 다시 시도해요',
};
let syncState = { status: 'off', email: '' };

function renderSync() {
  const { status, email } = syncState;
  $('acct-title').textContent = email || 'Google 계정으로 동기화';
  $('acct-sub').textContent = SYNC_TEXT[status] ?? '';
  $('acct-btn').textContent = email ? '로그아웃' : 'Google 로그인';
  $('acct-btn').disabled = status === 'loading';
  for (const ind of document.querySelectorAll('.sync-ind')) {
    ind.hidden = !email;
    ind.dataset.status = status;
    ind.setAttribute('aria-label', SYNC_TEXT[status] ?? '동기화');
  }
}

/** 서버에서 받은 메모 중 이 기기 것보다 최신인 것만 반영 */
function applyRemote(remote) {
  let changed = false;
  for (const [id, r] of remote) {
    let n = notes.find((x) => x.id === id);
    if (n && n.updated >= r.updated) continue;
    // 지금 편집 중인데 아직 저장 안 된 입력이 있으면, 곧 이 기기 것이 더 최신으로 저장되므로 건너뛴다
    if (n && n === current && (el.title.value !== n.title || el.body.value !== n.body || overlayDirty)) continue;
    const incoming = {
      title: String(r.title ?? ''),
      body: String(r.body ?? ''),
      ...parseOverlay(r.ink),
      tab: typeof r.tab === 'string' ? r.tab : '',
      pinned: !!r.pinned,
      created: Number(r.created) || r.updated,
      updated: r.updated,
      deleted: !!r.deleted,
    };
    if (n) Object.assign(n, incoming);
    else notes.push((n = { id, ...incoming }));
    changed = true;
    if (n === current) refreshOpenNote();
  }
  if (changed) {
    saveNotes(notes);
    renderList();
  }
}

function refreshOpenNote() {
  if (current.deleted) {
    current = null;
    toast('다른 기기에서 삭제된 메모예요');
    goBack();
    return;
  }
  const pos = el.body.selectionStart;
  el.title.value = current.title;
  el.body.value = current.body;
  lastLen = current.body.length;
  prevBody = current.body;
  if (document.activeElement === el.body) setCaret(Math.min(pos, current.body.length));
  updateMeta();
  ink.setStrokes(current.ink);
  marks = current.marks ?? [];
  drawMarks();
  updateGloss();
  renderView();
}

/** 서버의 ink 필드 → 펜 필기 + 글자 서식 (서식이 없으면 필기 배열만 저장돼 있다) */
function parseOverlay(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return { ink: v, marks: [] };
    if (v && typeof v === 'object') return { ink: Array.isArray(v.s) ? v.s : [], marks: Array.isArray(v.m) ? v.m : [] };
  } catch { /* 깨진 데이터 */ }
  return { ink: [], marks: [] };
}

$('acct-btn').addEventListener('click', async () => {
  if (syncState.email) {
    if (confirm('로그아웃할까요?\n이 기기에 있는 메모는 그대로 남아 있어요.')) await signOut();
    return;
  }
  try {
    await signIn();
  } catch (err) {
    console.warn(err);
    toast(err.message === 'offline' ? '인터넷에 연결된 상태에서 로그인해 주세요' : '로그인하지 못했어요');
  }
});
for (const ind of document.querySelectorAll('.sync-ind')) ind.addEventListener('click', openSettings);

/* ───────── 알림 ───────── */

let toastTimer = 0;

function toast(msg, actionLabel = '', action = null) {
  el.toastMsg.textContent = msg;
  el.toastAction.textContent = actionLabel;
  el.toastAction.onclick = () => {
    hideToast();
    action?.();
  };
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2500);
}

function hideToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove('show');
  toastTimer = setTimeout(() => (el.toast.hidden = true), 200);
}

/* ───────── 아이폰 · 앱 안 브라우저 대응 ───────── */

// 아이폰은 키보드가 올라와도 화면 높이가 그대로라, 편집 화면 아래 버튼이 키보드에 가려진다 → 보이는 높이에 맞춘다
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    if (!el.editorView.hidden && vv.offsetTop) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

// 카카오톡 등 앱 안 브라우저에서는 설치·Google 로그인이 막혀 있다 → 다른 브라우저로 열도록 안내
const ua = navigator.userAgent;
if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua)) {
  $('inapp').hidden = false;
  const open = $('inapp-open');
  if (/KAKAOTALK/i.test(ua)) open.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
  else {
    open.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(location.href);
        toast('주소를 복사했어요. 크롬이나 사파리에 붙여넣어 주세요');
      } catch {
        toast('메뉴(⋮)에서 "다른 브라우저로 열기"를 눌러 주세요');
      }
    });
  }
}

/* ───────── 시작 ───────── */

el.search.addEventListener('input', renderList);
$('new-note').addEventListener('click', createNote);
$('back').addEventListener('click', goBack);
$('open-settings').addEventListener('click', openSettings);
for (const b of el.tabs) {
  b.addEventListener('click', () => {
    showTab(b.dataset.tab);
    if (b.dataset.tab === 'bible' && settings.godpiaAuto) window.open(godpiaUrl(), '_blank', 'noopener');
  });
}
initSubjects({ push: (subj) => push('subjects', subj) });
$('empty-subject-settings').addEventListener('click', () => openSubjectSheet(getSubject(settings.subject)));
initBibleTab({ $, bible: () => bible, settings: () => settings, toast, showTerms, pickNote });
initScoreTab({ $ });

renderSync();
initSync({
  collections: {
    notes: { get: () => notes, apply: applyRemote },
    subjects: {
      get: subjectSync.get,
      apply: (remote) => {
        if (!subjectSync.apply(remote)) return;
        if (!getSubject(settings.subject)) settings.subject = '';
        renderList();
        if (current) updateMeta();
        if (el.subjectSheet.open && sheetSubject) renderDict();
      },
    },
  },
  notify: (msg) => toast(msg),
  onState: (s) => {
    syncState = s;
    renderSync();
  },
});

renderList();
if (history.state?.note && notes.some((n) => n.id === history.state.note)) openNote(history.state.note, false);
else {
  history.replaceState(null, '');
  showTab(tab);
}
loadBible().catch(() => {});

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || location.search.includes('sw'))) {
  // 새 버전이 설치되면 알려준다 (처음 설치 때는 제외)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('새 버전이 준비됐어요', '새로고침', () => location.reload());
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
