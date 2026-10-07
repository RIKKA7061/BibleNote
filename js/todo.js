// 할일 탭: 체크리스트 · 매일 초기화 · 루틴 · 자동완성 · 지킴이 점수
//
// 하루는 "초기화 시각"(기본 07:00)부터 다음 날 같은 시각까지. 초기화 때:
//   1) 지난 날 점수를 기록하고  2) 완료한 일은 지우고  3) 못 한 일은 오늘로 넘기고(이월)
//   4) 루틴을 오늘 할일로 새로 만든다.
// 루틴 항목 id는 "r_루틴id_날짜"로 정해져 있어서 휴대폰·PC가 동시에 초기화해도 겹치지 않는다.
import { jamo } from './hangul.js';
import { loadTodos, saveTodos, loadTodoMeta, saveTodoMeta, newId } from './store.js';

// 지킴이 점수 규칙
const PER_TASK = 10; // 할일 1개 완료
const MAX_COUNTED = 15; // 하루에 점수가 붙는 할일 수
const ALLCLEAR_MIN = 3; // 올클리어로 치려면 할일이 이만큼은 있어야 한다
const ALLCLEAR_BONUS = 50;
const STREAK_STEP = 10; // 연속 올클리어 하루마다 추가 점수
const STREAK_MAX = 50;
const HISTORY_MAX = 400; // 자동완성용으로 기억하는 할일 수
const DAY = 86400000;

export const TIERS = [
  { min: 0, icon: '🌱', name: '새싹 지킴이', cls: 't0' },
  { min: 300, icon: '🌿', name: '성실한 지킴이', cls: 't1' },
  { min: 1000, icon: '🌳', name: '꾸준한 지킴이', cls: 't2' },
  { min: 3000, icon: '⭐', name: '든든한 지킴이', cls: 't3' },
  { min: 7000, icon: '💎', name: '빛나는 지킴이', cls: 't4' },
  { min: 15000, icon: '👑', name: '전설의 지킴이', cls: 't5' },
];

let todos = loadTodos().filter((t) => !(t.deleted && t.updated < Date.now() - 7 * DAY));
let meta = loadTodoMeta();
let ctx = null; // { $, toast, push, pushMeta, whenSynced }
let el = null;
let editing = null; // 지금 고치고 있는 할일 id (그동안 목록을 다시 그리지 않는다)

/* ───────── 날짜 ───────── */

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const resetMinutes = () => {
  const [h, m] = (meta.resetAt || '07:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** 초기화 시각 기준 "오늘" (예: 07:00 초기화면 새벽 3시는 아직 어제) */
const dayKey = (t = Date.now()) => fmt(new Date(t - resetMinutes() * 60000));
const keyDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const prevKey = (key) => {
  const d = keyDate(key);
  d.setDate(d.getDate() - 1);
  return fmt(d);
};
const dayLabel = (key) => {
  const d = keyDate(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
};
function nextReset(t = Date.now()) {
  const now = new Date(t);
  const r = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, resetMinutes());
  if (r <= now) r.setDate(r.getDate() + 1);
  return r.getTime();
}

/* ───────── 저장 ───────── */

function saveItems(changed) {
  saveTodos(todos);
  for (const t of changed) ctx.push('todos', t);
}

function saveMeta(partial, deletions) {
  saveTodoMeta(meta);
  if (partial) ctx.pushMeta(partial, deletions);
}

const clean = (s) => s.trim().replace(/\s+/g, ' ');
const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `h${(h >>> 0).toString(36)}`;
}

/* ───────── 점수 ───────── */

function scoreDay(key, list) {
  const total = list.length;
  const done = list.filter((t) => t.done).length;
  const prev = meta.days[prevKey(key)];
  const all = total >= ALLCLEAR_MIN && done === total;
  const streak = all ? (prev?.all ? prev.streak || 1 : 0) + 1 : 0;
  const bonus = all ? ALLCLEAR_BONUS + Math.min((streak - 1) * STREAK_STEP, STREAK_MAX) : 0;
  return { done, total, all, streak, pts: Math.min(done, MAX_COUNTED) * PER_TASK + bonus, bonus };
}

const todayItems = () => {
  const key = dayKey();
  return todos.filter((t) => !t.deleted && t.day === key);
};

function tierOf(points) {
  let i = 0;
  while (i + 1 < TIERS.length && points >= TIERS[i + 1].min) i++;
  return i;
}

function totals() {
  const key = dayKey();
  const today = scoreDay(key, todayItems());
  let sum = today.pts;
  // 오늘 기록은 아직 마감 전이라 빼되, 초기화 시각을 바꿔 다시 연 날이면 그날 이미 얻은 점수는 넣는다
  for (const [k, d] of Object.entries(meta.days)) if (k !== key || d.reopened) sum += d.pts || 0;
  return { today, sum, tier: tierOf(sum) };
}

/* ───────── 매일 초기화 ───────── */

function ensureRoutines(key, changed) {
  const now = Date.now();
  for (const [rid, r] of Object.entries(meta.routines)) {
    if (r.deleted || todos.some((t) => t.routine === rid && t.day === key)) continue; // 오늘 지운 루틴은 다시 안 만든다
    const t = { id: `r_${rid}_${key}`, text: r.text, done: false, doneAt: 0, day: key, routine: rid, carried: 0, created: now, updated: now, deleted: false };
    todos.push(t);
    changed.push(t);
  }
}

function rollover() {
  const today = dayKey();
  const now = Date.now();
  const changed = [];
  const days = {};
  const past = new Map();
  for (const t of todos) {
    if (t.deleted || t.day >= today) continue;
    if (!past.has(t.day)) past.set(t.day, []);
    past.get(t.day).push(t);
  }
  for (const [key, list] of [...past].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const old = meta.days[key];
    if (!old || old.reopened) {
      const rec = scoreDay(key, list);
      delete rec.bonus;
      if (old?.reopened) Object.assign(rec, { done: rec.done + old.done, total: rec.total + old.total, pts: rec.pts + old.pts });
      meta.days[key] = rec;
      days[key] = rec;
    }
    for (const t of list) {
      if (t.done || t.routine) Object.assign(t, { deleted: true, updated: now }); // 완료한 일·지난 루틴은 지운다
      else Object.assign(t, { day: today, carried: (t.carried || 0) + 1, updated: now }); // 못 한 일은 오늘로
      changed.push(t);
    }
  }
  ensureRoutines(today, changed);
  if (changed.length) saveItems(changed);
  if (Object.keys(days).length) saveMeta({ days });
  render();
  scheduleRollover();
}

let rollTimer = 0;
function scheduleRollover() {
  clearTimeout(rollTimer);
  rollTimer = setTimeout(rollover, Math.min(nextReset() - Date.now() + 500, 2 ** 31 - 1));
}

function setResetAt(value) {
  if (!/^\d\d:\d\d$/.test(value) || value === meta.resetAt) return;
  const oldKey = dayKey();
  meta.resetAt = value;
  const newKey = dayKey();
  const changed = [];
  if (newKey !== oldKey) {
    // 지금 목록은 그대로 "오늘" 것으로 둔다
    for (const t of todos) {
      if (!t.deleted && t.day === oldKey) {
        Object.assign(t, { day: newKey, updated: Date.now() });
        changed.push(t);
      }
    }
    // 이미 마감한 날로 옮겨가면, 다음 마감 때 그날 기록에 더한다
    if (meta.days[newKey]) meta.days[newKey].reopened = true;
  }
  saveItems(changed);
  saveMeta({ resetAt: value, ...(meta.days[newKey] ? { days: { [newKey]: meta.days[newKey] } } : {}) });
  scheduleRollover();
  render();
  renderSheet();
  ctx.toast(`매일 ${value}에 하루를 새로 시작해요`);
}

/* ───────── 할일 ───────── */

function addTodo(text) {
  text = clean(text);
  if (!text) return;
  const now = Date.now();
  const t = { id: newId(), text, done: false, doneAt: 0, day: dayKey(now), routine: '', carried: 0, created: now, updated: now, deleted: false };
  todos.push(t);
  saveItems([t]);
  remember(text);
  render();
}

function toggle(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  const before = totals();
  Object.assign(t, { done: !t.done, doneAt: t.done ? 0 : Date.now(), updated: Date.now() });
  saveItems([t]);
  const after = totals();
  render();
  if (!t.done) return;
  if (after.today.done <= MAX_COUNTED) floatText(id, `+${PER_TASK}`);
  if (after.today.all && !before.today.all) celebrate(after.today);
  if (after.tier > before.tier) {
    const T = TIERS[after.tier];
    setTimeout(() => ctx.toast(`${T.icon} 승급! 이제 '${T.name}'예요`), 1400);
  }
}

function remove(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, { deleted: true, updated: Date.now() });
  saveItems([t]);
  render();
  ctx.toast('할 일을 지웠어요', '되돌리기', () => {
    Object.assign(t, { deleted: false, updated: Date.now() });
    saveItems([t]);
    render();
  });
}

function startEdit(id) {
  const t = todos.find((x) => x.id === id);
  const span = el.list.querySelector(`[data-id="${id}"] .todo-text`);
  if (!t || !span) return;
  editing = id;
  const input = document.createElement('input');
  input.className = 'todo-edit';
  input.value = t.text;
  input.enterKeyHint = 'done';
  span.replaceWith(input);
  input.focus();
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    editing = null;
    const text = clean(input.value);
    if (save && text && text !== t.text) {
      Object.assign(t, { text, updated: Date.now() });
      saveItems([t]);
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/* ───────── 자동완성 (한 번이라도 썼던 할일 기억) ───────── */

function remember(text) {
  const key = hashKey(norm(text));
  const entry = { t: text, c: (meta.history[key]?.c || 0) + 1, l: Date.now() };
  meta.history[key] = entry;
  const deletions = [];
  const keys = Object.keys(meta.history);
  if (keys.length > HISTORY_MAX) {
    keys.sort((a, b) => meta.history[a].l - meta.history[b].l);
    for (const k of keys.slice(0, keys.length - HISTORY_MAX)) {
      delete meta.history[k];
      deletions.push(['history', k]);
    }
  }
  saveMeta({ history: { [key]: entry } }, deletions);
}

function suggestions(input) {
  const typed = norm(input);
  const q = jamo(typed);
  if (!q) return [];
  const active = new Set(todayItems().filter((t) => !t.done).map((t) => norm(t.text)));
  const found = [];
  for (const h of Object.values(meta.history)) {
    const n = norm(h.t);
    if (n === typed || active.has(n)) continue;
    const j = jamo(n);
    const rank = j.startsWith(q) ? 2 : q.length >= 2 && j.includes(q) ? 1 : 0;
    if (rank) found.push({ ...h, rank });
  }
  found.sort((a, b) => b.rank - a.rank || b.c - a.c || b.l - a.l);
  return found.slice(0, 3);
}

function renderSuggest() {
  const items = suggestions(el.input.value);
  el.suggest.hidden = !items.length;
  if (!items.length) return el.suggest.replaceChildren();
  const head = document.createElement('div');
  head.className = 'sugg-head';
  head.textContent = '이걸로 할까요?';
  el.suggest.replaceChildren(head, ...items.map((h) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sugg';
    b.textContent = h.t;
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // 키보드가 내려가지 않게
    b.addEventListener('click', () => {
      addTodo(h.t);
      el.input.value = '';
      renderSuggest();
    });
    return b;
  }));
}

/* ───────── 루틴 ───────── */

function addRoutine(text) {
  text = clean(text);
  if (!text) return;
  const rid = newId();
  const live = Object.values(meta.routines).filter((r) => !r.deleted);
  meta.routines[rid] = { text, order: live.length ? Math.max(...live.map((r) => r.order)) + 1 : 0, deleted: false, updated: Date.now() };
  saveMeta({ routines: { [rid]: meta.routines[rid] } });
  const changed = [];
  ensureRoutines(dayKey(), changed); // 오늘 목록에도 바로
  saveItems(changed);
  render();
  renderSheet();
}

function removeRoutine(rid) {
  meta.routines[rid] = { ...meta.routines[rid], deleted: true, updated: Date.now() };
  saveMeta({ routines: { [rid]: meta.routines[rid] } });
  // 오늘 아직 안 한 그 루틴은 같이 지운다
  const t = todos.find((x) => x.routine === rid && x.day === dayKey() && !x.deleted && !x.done);
  if (t) {
    Object.assign(t, { deleted: true, updated: Date.now() });
    saveItems([t]);
  }
  render();
  renderSheet();
}

/* ───────── 화면 ───────── */

function svg(paths) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

function row(t) {
  const li = document.createElement('li');
  li.className = `todo${t.done ? ' done' : ''}`;
  li.dataset.id = t.id;
  const check = document.createElement('button');
  check.className = 'check';
  check.dataset.act = 'toggle';
  check.setAttribute('aria-label', t.done ? '완료 취소' : '완료');
  check.append(svg(['M5 12.5l4.5 4.5L19 7.5']));
  const main = document.createElement('span');
  main.className = 'todo-main';
  const text = document.createElement('span');
  text.className = 'todo-text';
  text.dataset.act = 'edit';
  text.textContent = t.text;
  main.append(text);
  if (t.routine) main.append(tag('루틴', ''));
  if (t.carried && !t.done) main.append(tag(t.carried > 1 ? `${t.carried}일째` : '어제부터', 'warm'));
  const del = document.createElement('button');
  del.className = 'todo-del';
  del.dataset.act = 'del';
  del.setAttribute('aria-label', '지우기');
  del.append(svg(['M7 7l10 10M17 7L7 17']));
  li.append(check, main, del);
  return li;
}

function tag(text, cls) {
  const s = document.createElement('span');
  s.className = `tag ${cls}`;
  s.textContent = text;
  return s;
}

function render() {
  if (!el || editing) return;
  const key = dayKey();
  el.date.textContent = dayLabel(key);
  const list = todayItems();
  const order = (t) => meta.routines[t.routine]?.order ?? 0;
  const undone = list
    .filter((t) => !t.done)
    .sort((a, b) => (a.routine ? 0 : 1) - (b.routine ? 0 : 1) || order(a) - order(b) || a.created - b.created);
  const done = list.filter((t) => t.done).sort((a, b) => a.doneAt - b.doneAt);
  el.list.replaceChildren(...undone.map(row), ...done.map(row));
  el.empty.hidden = list.length > 0;
  renderKeeper();
}

const RING = 2 * Math.PI * 30;

function renderKeeper() {
  const { today, sum, tier } = totals();
  const pct = today.total ? Math.round((today.done / today.total) * 100) : 0;
  el.ringBar.style.strokeDashoffset = String(RING * (1 - pct / 100));
  el.pct.textContent = `${pct}%`;
  el.count.textContent = today.total ? `${today.done}/${today.total}` : '할일 없음';
  el.card.classList.toggle('clear', today.all);

  const T = TIERS[tier];
  const N = TIERS[tier + 1];
  el.badge.className = `tier-badge ${T.cls}`;
  el.badge.textContent = `${T.icon} ${T.name}`;
  el.points.textContent = `${sum.toLocaleString()}점`;
  el.todayPts.textContent = `오늘 +${today.pts}`;
  el.tierBar.style.width = N ? `${Math.min(100, ((sum - T.min) / (N.min - T.min)) * 100)}%` : '100%';
  el.next.textContent = N ? `${N.icon} ${N.name}까지 ${(N.min - sum).toLocaleString()}점` : '최고 등급이에요';

  const prev = meta.days[prevKey(dayKey())];
  const streak = today.all ? today.streak : prev?.all ? prev.streak : 0;
  el.streak.textContent = streak
    ? `🔥 ${streak}일 연속 올클리어`
    : today.total >= ALLCLEAR_MIN ? `다 끝내면 올클리어 +${ALLCLEAR_BONUS}` : '';
}

function floatText(id, text) {
  const btn = el.list.querySelector(`[data-id="${id}"] .check`);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'float-pts';
  s.textContent = text;
  s.style.left = `${r.left + r.width / 2}px`;
  s.style.top = `${r.top}px`;
  document.body.append(s);
  setTimeout(() => s.remove(), 1000);
}

function celebrate(today) {
  const r = el.ring.getBoundingClientRect();
  const marks = ['🎉', '✨', '⭐', '🙌', '💛'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.className = 'burst';
    s.textContent = marks[i % marks.length];
    const a = (i / 18) * Math.PI * 2;
    const d = 70 + Math.random() * 60;
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    document.body.append(s);
    setTimeout(() => s.remove(), 1100);
  }
  ctx.toast(`🎉 올클리어! +${today.bonus}점${today.streak > 1 ? ` · 🔥 ${today.streak}일 연속` : ''}`);
}

/* ───────── 할일 설정 창 (초기화 시각 · 루틴 · 지킴이 기록) ───────── */

function renderSheet() {
  if (!el.sheet.open) return;
  el.resetAt.value = meta.resetAt;

  const routines = Object.entries(meta.routines).filter(([, r]) => !r.deleted).sort(([, a], [, b]) => a.order - b.order);
  el.routines.replaceChildren(...routines.map(([rid, r]) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = r.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.setAttribute('aria-label', `${r.text} 루틴 지우기`);
    del.append(svg(['M7 7l10 10M17 7L7 17']));
    del.addEventListener('click', () => removeRoutine(rid));
    li.append(text, del);
    return li;
  }));
  el.routinesEmpty.hidden = routines.length > 0;

  const { sum, tier } = totals();
  el.tiers.replaceChildren(...TIERS.map((T, i) => {
    const d = document.createElement('div');
    d.className = `tier-row${i === tier ? ' now' : ''}${sum >= T.min ? ' got' : ''}`;
    const b = document.createElement('span');
    b.className = `tier-badge ${T.cls}`;
    b.textContent = `${T.icon} ${T.name}`;
    const m = document.createElement('span');
    m.textContent = `${T.min.toLocaleString()}점`;
    d.append(b, m);
    return d;
  }));

  // 최근 7일
  const rows = [];
  let key = prevKey(dayKey());
  for (let i = 0; i < 7; i++, key = prevKey(key)) {
    const rec = meta.days[key];
    const d = document.createElement('div');
    d.className = 'day-row';
    const label = document.createElement('span');
    label.textContent = dayLabel(key);
    const bar = document.createElement('span');
    bar.className = 'day-bar';
    const fill = document.createElement('i');
    fill.style.width = rec?.total ? `${(rec.done / rec.total) * 100}%` : '0';
    bar.append(fill);
    const info = document.createElement('span');
    info.className = 'day-info';
    info.textContent = rec ? `${rec.done}/${rec.total}${rec.all ? ' 🎉' : ''} · +${rec.pts}` : '기록 없음';
    d.append(label, bar, info);
    rows.push(d);
  }
  el.days.replaceChildren(...rows);
}

function openSheet() {
  el.sheet.showModal();
  renderSheet();
}

/* ───────── 동기화 연결 ───────── */

function applyRemote(remote) {
  let changed = false;
  for (const [id, r] of remote) {
    let t = todos.find((x) => x.id === id);
    if (t && t.updated >= r.updated) continue;
    const incoming = {
      text: String(r.text ?? ''),
      done: !!r.done,
      doneAt: Number(r.doneAt) || 0,
      day: String(r.day ?? ''),
      routine: String(r.routine ?? ''),
      carried: Number(r.carried) || 0,
      created: Number(r.created) || r.updated,
      updated: r.updated,
      deleted: !!r.deleted,
    };
    if (t) Object.assign(t, incoming);
    else todos.push((t = { id, ...incoming }));
    changed = true;
  }
  if (changed) {
    saveTodos(todos);
    render();
  }
}

/** 처음 연결될 때: 이 기기 기록 + 서버 기록 합치기 */
function mergeMeta(remote) {
  const m = {
    resetAt: remote.resetAt || meta.resetAt,
    routines: { ...meta.routines },
    history: { ...meta.history },
    days: { ...meta.days },
  };
  for (const [k, r] of Object.entries(remote.routines || {})) {
    if (!m.routines[k] || (r.updated || 0) >= (m.routines[k].updated || 0)) m.routines[k] = r;
  }
  for (const [k, r] of Object.entries(remote.history || {})) {
    const l = m.history[k];
    m.history[k] = l ? { t: r.l >= l.l ? r.t : l.t, c: Math.max(r.c, l.c), l: Math.max(r.l, l.l) } : r;
  }
  Object.assign(m.days, remote.days || {}); // 날짜별 점수는 서버 기록 우선
  return m;
}

function applyMeta(remote) {
  const resetChanged = remote.resetAt && remote.resetAt !== meta.resetAt;
  meta = {
    resetAt: remote.resetAt || meta.resetAt,
    routines: remote.routines || {},
    history: remote.history || {},
    days: remote.days || {},
  };
  saveTodoMeta(meta);
  if (resetChanged) scheduleRollover();
  render();
  renderSheet();
}

export const todoSync = {
  collection: { get: () => todos, apply: applyRemote },
  meta: { merge: mergeMeta, apply: applyMeta },
};

/* ───────── 시작 ───────── */

export function initTodos(context) {
  ctx = context;
  const { $ } = ctx;
  el = {
    date: $('todo-date'),
    list: $('todo-list'),
    empty: $('todo-empty'),
    input: $('todo-input'),
    suggest: $('todo-suggest'),
    card: $('keeper'),
    ring: $('keeper-ring'),
    ringBar: $('keeper-ring-bar'),
    pct: $('keeper-pct'),
    count: $('keeper-count'),
    badge: $('keeper-badge'),
    points: $('keeper-points'),
    todayPts: $('keeper-today'),
    tierBar: $('keeper-tier-bar'),
    next: $('keeper-next'),
    streak: $('keeper-streak'),
    sheet: $('todo-settings'),
    resetAt: $('reset-at'),
    routines: $('routine-list'),
    routinesEmpty: $('routine-empty'),
    tiers: $('tier-list'),
    days: $('day-history'),
  };
  el.ringBar.style.strokeDasharray = String(RING);

  $('todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addTodo(el.input.value);
    el.input.value = '';
    renderSuggest();
  });
  el.input.addEventListener('input', renderSuggest);
  el.input.addEventListener('blur', () => setTimeout(() => {
    el.suggest.hidden = true;
  }, 150));
  el.input.addEventListener('focus', renderSuggest);

  el.list.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const id = act?.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (act.dataset.act === 'toggle') toggle(id);
    else if (act.dataset.act === 'del') remove(id);
    else if (act.dataset.act === 'edit') startEdit(id);
  });

  el.card.addEventListener('click', openSheet);
  $('open-todo-settings').addEventListener('click', openSheet);
  el.resetAt.addEventListener('change', () => setResetAt(el.resetAt.value));
  $('routine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('routine-input');
    addRoutine(input.value);
    input.value = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && started) rollover();
  });

  render();
  // 로그인 상태면 다른 기기 기록을 먼저 받아온 뒤 초기화한다 (같은 날을 두 번 마감하지 않게)
  ctx.whenSynced().then(() => {
    started = true;
    rollover();
  });
}

let started = false;

/** 할일 탭을 열 때 */
export function showTodos() {
  if (started) rollover();
  else render();
}
