import { BOOKS } from './books.js';
import { refAtEnd, refAround, parseRef, lookup, formatVerses } from './ref.js';
import { loadNotes, saveNotes, loadSettings, saveSettings, requestPersist, newId } from './store.js';

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
  finder: $('finder'),
  finderInput: $('finder-input'),
  finderPreview: $('finder-preview'),
  finderInsert: $('finder-insert'),
  settings: $('settings'),
  toast: $('toast'),
  toastMsg: $('toast-msg'),
  toastAction: $('toast-action'),
};

let notes = loadNotes();
let settings = loadSettings();
let current = null;

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
  const sorted = [...notes].sort((a, b) => b.updated - a.updated);
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
  el.empty.hidden = notes.length > 0;
  el.noResult.hidden = !(notes.length && !shown.length);
}

/* ───────── 화면 전환 (안드로이드 뒤로가기 지원) ───────── */

function showEditor(show) {
  el.listView.hidden = show;
  el.editorView.hidden = !show;
  if (!show) hideChip();
}

function openNote(id, push) {
  const note = notes.find((n) => n.id === id);
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
    notes = notes.filter((n) => n !== current);
    saveNotes(notes);
  }
  current = null;
  showEditor(false);
  renderList();
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
  if (e.isComposing) {
    composingGrew ||= grew;
    return;
  }
  if (grew) autoExpand();
  updateChip();
});

// 일부 안드로이드 키보드는 띄어쓰기를 조합(composition) 중에 넣는다 → 조합이 끝난 뒤 한 번 더 확인
el.body.addEventListener('compositionend', () => {
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
  el.status.hidden = false;
}

function updateChip() {
  const t = findChipTarget();
  if (!t) return hideChip();
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
  if (document.activeElement === el.body) updateChipSoon();
});
el.body.addEventListener('click', updateChipSoon);
el.body.addEventListener('focus', updateChipSoon);
el.body.addEventListener('blur', () => setTimeout(() => document.activeElement !== el.body && hideChip(), 150));

// 버튼을 눌러도 키보드가 내려가지 않게
for (const b of [el.chip, el.toastAction]) b.addEventListener('pointerdown', (e) => e.preventDefault());

el.chip.addEventListener('click', () => {
  const t = findChipTarget() || chipTarget;
  if (!t) return;
  const insert = ` (${verseText(t.verses)})`;
  replaceText(t.at, t.at, insert);
  setCaret(t.at + insert.length);
  hideChip();
});

/* ───────── 말씀 찾기 ───────── */

let finderCaret = 0;
let finderResult = null;

function renderFinder() {
  const q = el.finderInput.value;
  const box = el.finderPreview;
  finderResult = null;
  box.replaceChildren();
  if (q.trim()) {
    const ref = parseRef(q);
    const verses = ref && bible ? lookup(bible, ref) : null;
    if (verses) {
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
        : '책 이름과 장:절을 입력하세요 (예: 요 3:16)';
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

function insertFromFinder() {
  if (!finderResult) return;
  const v = el.body.value;
  const at = Math.min(finderCaret, v.length);
  const before = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '';
  const text = `${before}${finderResult.raw} (${verseText(finderResult.verses)})`;
  el.finder.close();
  replaceText(at, at, text);
  setCaret(at + text.length);
  updateChip();
}

el.finderInput.addEventListener('input', renderFinder);
el.finderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    insertFromFinder();
  }
});
el.finderInsert.addEventListener('click', insertFromFinder);
$('open-finder').addEventListener('click', openFinder);

/* ───────── 설정 · 백업 ───────── */

function openSettings() {
  $('set-auto').checked = settings.auto;
  $('set-numbers').checked = settings.numbers;
  el.settings.showModal();
}

$('set-auto').addEventListener('change', (e) => {
  settings.auto = e.target.checked;
  saveSettings(settings);
});
$('set-numbers').addEventListener('change', (e) => {
  settings.numbers = e.target.checked;
  saveSettings(settings);
});

$('abbr').append(...BOOKS.map(([name, short]) => {
  const d = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = short;
  d.append(b, name);
  return d;
}));

$('export').addEventListener('click', () => {
  flushSave();
  const data = { app: 'BibleNote', version: 1, exported: new Date().toISOString(), notes };
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
      (n) => n && typeof n.id === 'string' && typeof n.body === 'string',
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
        added++;
      } else if (note.updated > notes[i].updated) {
        notes[i] = note;
        added++;
      }
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
  notes = notes.filter((n) => n !== current);
  saveNotes(notes);
  current = null;
  goBack();
});

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

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || location.search.includes('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
