import { BOOKS } from './books.js';
import { refAtEnd, refAround, parseRef, lookup, formatVerses } from './ref.js';
import { loadNotes, saveNotes, loadSettings, saveSettings, requestPersist, newId } from './store.js';
import { initSync, pushNote, signIn, signOut } from './sync.js';
import { tokenize, suggestFor, wholeLineMatch, searchPhrase } from './phrase.js';

const $ = (id) => document.getElementById(id);
const el = {
  listView: $('list-view'),
  editorView: $('editor-view'),
  list: $('note-list'),
  empty: $('empty'),
  noResult: $('no-result'),
  search: $('search'),
  title: $('title'),
  body: $('body'),
  meta: $('meta'),
  chip: $('chip'),
  status: $('bible-status'),
  openFinder: $('open-finder'),
  suggest: $('suggest'),
  suggestRef: $('suggest-ref'),
  suggestText: $('suggest-text'),
  finder: $('finder'),
  finderInput: $('finder-input'),
  finderPreview: $('finder-preview'),
  finderInsert: $('finder-insert'),
  settings: $('settings'),
  toast: $('toast'),
  toastMsg: $('toast-msg'),
  toastAction: $('toast-action'),
};

// 삭제한 메모는 다른 기기에도 삭제가 전달되도록 내용을 비운 채 deleted 표시만 남긴다
let notes = loadNotes();
let settings = loadSettings();
let current = null;

const visibleNotes = () => notes.filter((n) => !n.deleted);

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

function renderList() {
  const q = el.search.value.trim().toLowerCase();
  const visible = visibleNotes();
  const sorted = visible.sort((a, b) => b.updated - a.updated);
  const shown = q ? sorted.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : sorted;

  el.list.replaceChildren(...shown.map((n) => {
    const li = document.createElement('li');
    const card = document.createElement('button');
    card.className = 'note-card';
    const title = document.createElement('div');
    title.className = 'note-title' + (n.title.trim() ? '' : ' untitled');
    title.textContent = n.title.trim() || '제목 없음';
    const preview = document.createElement('div');
    preview.className = 'note-preview';
    preview.textContent = n.body.replace(/\s+/g, ' ').trim();
    const date = document.createElement('div');
    date.className = 'note-date';
    date.textContent = fmtDate(n.updated);
    card.append(title, ...(preview.textContent ? [preview] : []), date);
    card.addEventListener('click', () => openNote(n.id, true));
    li.append(card);
    return li;
  }));
  el.empty.hidden = visible.length > 0;
  el.noResult.hidden = !(visible.length && !shown.length);
}

/* ───────── 화면 전환 (안드로이드 뒤로가기 지원) ───────── */

function showEditor(show) {
  el.listView.hidden = show;
  el.editorView.hidden = !show;
  hideChip();
  hideSuggest();
}

function openNote(id, push) {
  const note = notes.find((n) => n.id === id && !n.deleted);
  if (!note) return closeEditor();
  current = note;
  if (push) history.pushState({ note: id }, '');
  el.title.value = note.title;
  el.body.value = note.body;
  lastLen = note.body.length;
  el.body.scrollTop = 0;
  updateMeta();
  showEditor(true);
}

function createNote() {
  const now = Date.now();
  const note = { id: newId(), title: '', body: '', created: now, updated: now };
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
  Object.assign(note, { title: '', body: '', deleted: true, updated: Date.now() });
  saveNotes(notes);
  pushNote(note);
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
  if (title === current.title && body === current.body) return;
  Object.assign(current, { title, body, updated: Date.now() });
  if (!saveNotes(notes)) toast('저장 공간이 부족해 저장하지 못했어요');
  if (title.trim() || body.trim()) pushNote(current);
  updateMeta();
  if (!persistAsked) {
    persistAsked = true;
    requestPersist();
  }
}

function updateMeta() {
  el.meta.textContent = current ? `${fmtDate(current.updated, true)} · 개역한글` : '';
}

document.addEventListener('visibilitychange', () => document.hidden && flushSave());
window.addEventListener('pagehide', flushSave);

/* ───────── 본문 편집 · 말씀 자동 넣기 ───────── */

let lastLen = 0;
let busy = false;
let composingGrew = false;

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
  scheduleSave();
}

function setCaret(pos) {
  el.body.setSelectionRange(pos, pos);
}

/** 방금 띄어쓰기/줄바꿈을 쳤고 그 앞이 구절 표기면 " (말씀)"을 넣는다 */
function autoExpand() {
  const ta = el.body;
  const pos = ta.selectionStart;
  if (!bible || !settings.auto || pos !== ta.selectionEnd || pos < 2) return;
  const v = ta.value;
  if (!/[ \n ]/.test(v[pos - 1])) return;
  const lineStart = v.lastIndexOf('\n', pos - 2) + 1;
  const ref = refAtEnd(v.slice(lineStart, pos - 1));
  if (!ref || EXPANDED.test(v.slice(pos))) return;
  const verses = lookup(bible, ref);
  if (!verses) return;

  const at = pos - 1;
  const insert = ` (${verseText(verses)})`;
  replaceText(at, at, insert);
  setCaret(at + insert.length + 1);
  toast(`${ref.label} 말씀을 넣었어요`, '되돌리기', () => {
    if (el.body.value.slice(at, at + insert.length) === insert) {
      replaceText(at, at + insert.length, '');
      setCaret(at + 1);
      updateChip();
    }
  });
}

el.body.addEventListener('input', (e) => {
  if (busy) return;
  const grew = el.body.value.length > lastLen;
  lastLen = el.body.value.length;
  scheduleSave();
  schedulePhrase();
  if (e.isComposing) {
    composingGrew ||= grew;
    return;
  }
  if (grew) {
    autoExpand();
    if (el.body.value[el.body.selectionStart - 1] === '\n') autoPhraseLine();
  }
  updateChip();
});

// 일부 안드로이드 키보드는 띄어쓰기를 조합(composition) 중에 넣는다 → 조합이 끝난 뒤 한 번 더 확인
el.body.addEventListener('compositionend', () => {
  schedulePhrase();
  if (!composingGrew) return;
  composingGrew = false;
  setTimeout(() => {
    autoExpand();
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

/* ───────── 구절을 누르면 뜨는 "말씀 넣기" 버튼 ───────── */

let chipTarget = null;

function findChipTarget() {
  const ta = el.body;
  if (!bible || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) return null;
  const pos = ta.selectionStart;
  const v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = v.indexOf('\n', pos);
  if (lineEnd < 0) lineEnd = v.length;
  const line = v.slice(lineStart, lineEnd);
  const ref = refAround(line, pos - lineStart);
  if (!ref || EXPANDED.test(line.slice(ref.end))) return null;
  const verses = lookup(bible, ref);
  return verses ? { at: lineStart + ref.end, label: ref.label, verses } : null;
}

function hideChip() {
  chipTarget = null;
  el.chip.hidden = true;
  el.status.hidden = !!suggestion;
}

function updateChip() {
  const t = findChipTarget();
  if (!t) return hideChip();
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

let chipFrame = 0;
function updateChipSoon() {
  cancelAnimationFrame(chipFrame);
  chipFrame = requestAnimationFrame(updateChip);
}

document.addEventListener('selectionchange', () => {
  if (document.activeElement !== el.body) return;
  updateChipSoon();
  schedulePhrase();
});
el.body.addEventListener('click', updateChipSoon);
el.body.addEventListener('focus', updateChipSoon);
el.body.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement === el.body) return;
  hideChip();
  hideSuggest();
}, 150));

// 버튼을 눌러도 키보드가 내려가지 않게
for (const b of [el.chip, el.suggest, el.toastAction]) b.addEventListener('pointerdown', (e) => e.preventDefault());

el.chip.addEventListener('click', () => {
  const t = findChipTarget() || chipTarget;
  if (!t) return;
  const insert = ` (${verseText(t.verses)})`;
  replaceText(t.at, t.at, insert);
  setCaret(t.at + insert.length);
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
  const ready = settings.phrase && bible && !chipTarget && document.activeElement === el.body;
  const tokens = ready ? wordsBeforeCaret() : null;
  if (!tokens || tokens.length < 2) return hideSuggest();
  const snapshot = el.body.value;
  const best = await suggestFor(tokens.map((t) => t.word));
  // 찾는 사이에 글이 바뀌었으면 버린다 (곧 다시 찾음)
  if (el.body.value !== snapshot || chipTarget || document.activeElement !== el.body) return;
  if (!best) return hideSuggest();
  const start = tokens[best.k].start;
  const end = tokens[tokens.length - 1].end;
  const phrase = snapshot.slice(start, end);
  if (declined.has(phrase)) return hideSuggest();
  showSuggest({ start, end, phrase, ...verseInfo(best) });
}

function showSuggest(s) {
  suggestion = s;
  el.suggestRef.textContent = s.label;
  el.suggestText.textContent = s.text;
  el.suggest.hidden = false;
  el.openFinder.hidden = true;
  el.status.hidden = true;
}

function hideSuggest() {
  if (!suggestion) return;
  suggestion = null;
  el.suggest.hidden = true;
  el.openFinder.hidden = false;
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

el.suggest.addEventListener('click', () => suggestion && applyPhrase(suggestion));

/** 방금 줄을 바꿨는데 그 줄 전체가 확실히 한 절이면 바로 바꾼다 */
async function autoPhraseLine() {
  if (!bible || !settings.phrase || !settings.phraseAuto) return;
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
      finderResult = { raw: ref.raw.trim(), verses };
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
  if (finderResult) insertAtFinderCaret(`${finderResult.raw} (${verseText(finderResult.verses)})`);
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
$('open-finder').addEventListener('click', openFinder);

/* ───────── 설정 · 백업 ───────── */

const TOGGLES = { 'set-auto': 'auto', 'set-numbers': 'numbers', 'set-phrase': 'phrase', 'set-phrase-auto': 'phraseAuto' };

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
  const data = { app: 'BibleNote', version: 1, exported: new Date().toISOString(), notes: visibleNotes() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const d = new Date();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `BibleNote-백업-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
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
      pushNote(note);
    }
    saveNotes(notes);
    renderList();
    toast(added ? `메모 ${added}개를 불러왔어요` : '새로 불러올 메모가 없어요');
  } catch {
    toast('백업 파일을 읽지 못했어요');
  }
});

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}
for (const dlg of [el.finder, el.settings]) {
  // 바깥(어두운 부분)을 누르면 닫기
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
}

/* ───────── 공유 · 삭제 ───────── */

$('share').addEventListener('click', async () => {
  flushSave();
  const title = el.title.value.trim();
  const text = [title, el.body.value].filter(Boolean).join('\n\n');
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ title: title || 'BibleNote', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('메모를 복사했어요');
    }
  } catch { /* 공유 취소 */ }
});

$('delete').addEventListener('click', () => {
  if (!current || !confirm('이 메모를 삭제할까요?')) return;
  clearTimeout(saveTimer);
  deleteNote(current);
  current = null;
  goBack();
});

/* ───────── Google 로그인 · 동기화 ───────── */

const SYNC_TEXT = {
  off: '로그인하면 휴대폰·PC 어디서나 같은 메모를 볼 수 있어요',
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
  const ind = $('sync-ind');
  ind.hidden = !email;
  ind.dataset.status = status;
  ind.setAttribute('aria-label', SYNC_TEXT[status] ?? '동기화');
}

/** 서버에서 받은 메모 중 이 기기 것보다 최신인 것만 반영 */
function applyRemote(remote) {
  let changed = false;
  for (const [id, r] of remote) {
    let n = notes.find((x) => x.id === id);
    if (n && n.updated >= r.updated) continue;
    // 지금 편집 중인데 아직 저장 안 된 입력이 있으면, 곧 이 기기 것이 더 최신으로 저장되므로 건너뛴다
    if (n && n === current && (el.title.value !== n.title || el.body.value !== n.body)) continue;
    const incoming = {
      title: String(r.title ?? ''),
      body: String(r.body ?? ''),
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
  if (document.activeElement === el.body) setCaret(Math.min(pos, current.body.length));
  updateMeta();
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
$('sync-ind').addEventListener('click', openSettings);

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

/* ───────── 시작 ───────── */

el.search.addEventListener('input', renderList);
$('new-note').addEventListener('click', createNote);
$('back').addEventListener('click', goBack);
$('open-settings').addEventListener('click', openSettings);

renderList();
if (history.state?.note && notes.some((n) => n.id === history.state.note)) openNote(history.state.note, false);
else history.replaceState(null, '');
loadBible().catch(() => {});

renderSync();
initSync({
  getNotes: () => notes,
  applyRemote,
  onState: (s) => {
    syncState = s;
    renderSync();
  },
});

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || location.search.includes('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
