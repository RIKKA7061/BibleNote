// 펜 필기: 메모 글 위에 동그라미·밑줄, 빈 여백에 그림
//
// 그린 선은 "글자 위치"에 붙여 둔다 (anchor = 그 선이 시작하는 줄의 글자 번호).
// 위쪽에 글을 더 쓰면 그 글자가 아래로 밀리고, 선도 같이 따라 내려간다.
// 가로 위치는 화면 폭에 대한 비율(0~1000)로 저장 → 폰·PC에서 대략 같은 자리에 보인다.
// (화면 폭이 달라 줄바꿈 위치가 바뀌면 조금 어긋날 수 있다)
//
// 저장 형식: note.ink = [{ i: 글자 번호, c: 'k'|'r'|'b'|'y', p: [x, y, x, y, …] }]
//   x: 폭 비율 0~1000,  y: 기준 줄 위쪽에서부터의 픽셀

const COLORS = { r: '#e03131', b: '#1c7ed6', y: 'rgba(255, 212, 59, 0.45)' };
const WIDTH = { k: 2.4, r: 2.4, b: 2.4, y: 16 };

let ta = null;
let canvas = null;
let ctx2d = null;
let mirror = null;
let onChange = () => {};

let strokes = [];
let undoStack = [];
let penMode = false;
let tool = 'k'; // k|r|b|y|eraser
let penSeen = false; // S펜을 한 번이라도 쓰면, 손가락은 그리기 대신 스크롤
let gesture = null; // { kind: 'draw'|'erase'|'scroll', … }

/* ───────── 글자 위치 재기 (textarea와 똑같이 줄바꿈되는 보이지 않는 복사본) ───────── */

let layoutKey = '';
let yCache = new Map();

function syncMirror() {
  const cs = getComputedStyle(ta);
  // 글이 바뀌면 textChanged/setStrokes 가 layoutKey 를 비운다
  const key = `${ta.value.length}|${ta.clientWidth}|${cs.fontSize}|${cs.lineHeight}`;
  if (key === layoutKey) return;
  layoutKey = key;
  yCache = new Map();
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordBreak', 'overflowWrap', 'paddingLeft', 'paddingRight', 'paddingTop', 'tabSize']) {
    mirror.style[prop] = cs[prop];
  }
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.textContent = ta.value;
}

/** 글자 번호 → 그 글자가 있는 줄의 위쪽 y (글 맨 위 기준) */
function yOf(index) {
  syncMirror();
  const i = Math.max(0, Math.min(index, ta.value.length));
  if (yCache.has(i)) return yCache.get(i);
  const before = document.createTextNode(ta.value.slice(0, i));
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.replaceChildren(before, mark, document.createTextNode(ta.value.slice(i)));
  const y = mark.offsetTop;
  yCache.set(i, y);
  return y;
}

/** y 위치에 있는 줄의 글자 번호 (그 줄 또는 바로 위 줄) */
function indexAtY(y) {
  let lo = 0;
  let hi = ta.value.length;
  if (yOf(0) > y) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (yOf(mid) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ───────── 그리기 ───────── */

function inkColor(c) {
  return COLORS[c] ?? getComputedStyle(ta).color;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = ta.clientWidth;
  const h = ta.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 화면 좌표로 바꾼 점들 [x, y, …] */
function screenPoints(s) {
  const base = yOf(s.i) - ta.scrollTop;
  const w = ta.clientWidth;
  const out = new Array(s.p.length);
  for (let k = 0; k < s.p.length; k += 2) {
    out[k] = (s.p[k] / 1000) * w;
    out[k + 1] = base + s.p[k + 1];
  }
  return out;
}

function strokePath(pts, c) {
  ctx2d.strokeStyle = inkColor(c);
  ctx2d.lineWidth = WIDTH[c] ?? 2.4;
  ctx2d.lineCap = 'round';
  ctx2d.lineJoin = 'round';
  ctx2d.beginPath();
  ctx2d.moveTo(pts[0], pts[1]);
  if (pts.length === 2) ctx2d.lineTo(pts[0] + 0.1, pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx2d.lineTo(pts[k], pts[k + 1]);
  ctx2d.stroke();
}

export function redraw() {
  if (!canvas) return;
  resize();
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  const h = ta.clientHeight;
  for (const s of strokes) {
    const pts = screenPoints(s);
    let top = Infinity;
    let bottom = -Infinity;
    for (let k = 1; k < pts.length; k += 2) {
      top = Math.min(top, pts[k]);
      bottom = Math.max(bottom, pts[k]);
    }
    if (bottom < -20 || top > h + 20) continue; // 화면 밖은 건너뜀
    strokePath(pts, s.c);
  }
  if (gesture?.kind === 'draw') strokePath(gesture.pts, tool);
}

/* ───────── 펜 입력 ───────── */

function local(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function eraseAt(x, y) {
  const hit = strokes.findIndex((s) => {
    const pts = screenPoints(s);
    for (let k = 0; k < pts.length; k += 2) {
      if (Math.hypot(pts[k] - x, pts[k + 1] - y) < 14) return true;
    }
    return false;
  });
  if (hit < 0) return;
  const [removed] = strokes.splice(hit, 1);
  undoStack.push({ kind: 'remove', stroke: removed, at: hit });
  changed();
}

function finishStroke() {
  const pts = gesture.pts;
  gesture = null;
  if (!pts.length) return;
  const w = ta.clientWidth;
  let top = Infinity;
  for (let k = 1; k < pts.length; k += 2) top = Math.min(top, pts[k] + ta.scrollTop);
  const i = indexAtY(top);
  const base = yOf(i);
  const p = [];
  for (let k = 0; k < pts.length; k += 2) {
    p.push(Math.round((pts[k] / w) * 1000), Math.round(pts[k + 1] + ta.scrollTop - base));
  }
  const stroke = { i, c: tool, p };
  strokes.push(stroke);
  undoStack.push({ kind: 'add', stroke });
  changed();
}

function onDown(e) {
  if (!penMode) return;
  if (e.pointerType === 'pen') penSeen = true;
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = local(e);
  if (e.pointerType === 'touch' && penSeen) {
    gesture = { kind: 'scroll', y: e.clientY, top: ta.scrollTop };
  } else if (tool === 'eraser' || e.button === 5) {
    gesture = { kind: 'erase' };
    eraseAt(x, y);
  } else {
    gesture = { kind: 'draw', pts: [x, y] };
  }
  e.preventDefault();
}

function onMove(e) {
  if (!gesture) return;
  if (gesture.kind === 'scroll') {
    ta.scrollTop = gesture.top - (e.clientY - gesture.y);
    return;
  }
  for (const ev of e.getCoalescedEvents?.() ?? [e]) {
    const [x, y] = local(ev);
    if (gesture.kind === 'erase') eraseAt(x, y);
    else {
      const n = gesture.pts.length;
      if (Math.hypot(x - gesture.pts[n - 2], y - gesture.pts[n - 1]) < 1.5) continue;
      ctx2d.strokeStyle = inkColor(tool);
      ctx2d.lineWidth = WIDTH[tool] ?? 2.4;
      ctx2d.lineCap = 'round';
      ctx2d.beginPath();
      ctx2d.moveTo(gesture.pts[n - 2], gesture.pts[n - 1]);
      ctx2d.lineTo(x, y);
      ctx2d.stroke();
      gesture.pts.push(x, y);
    }
  }
}

function onUp() {
  if (gesture?.kind === 'draw') finishStroke();
  gesture = null;
  redraw();
}

function changed() {
  redraw();
  onChange(strokes);
}

/* ───────── 밖에서 쓰는 기능 ───────── */

export function initInk({ textarea, canvas: cv, onChange: cb }) {
  ta = textarea;
  canvas = cv;
  ctx2d = canvas.getContext('2d');
  onChange = cb;
  mirror = document.createElement('div');
  mirror.className = 'ink-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  ta.parentElement.append(mirror);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  ta.addEventListener('scroll', () => requestAnimationFrame(redraw));
  new ResizeObserver(() => {
    layoutKey = '';
    redraw();
  }).observe(ta);
}

/** 메모를 열 때 */
export function setStrokes(list) {
  strokes = Array.isArray(list) ? list.filter((s) => s && Array.isArray(s.p) && s.p.length >= 2) : [];
  undoStack = [];
  layoutKey = '';
  redraw();
}

/** 글이 바뀌면 바뀐 곳 뒤에 붙은 선들의 글자 번호를 같이 옮긴다 */
export function textChanged(before, after) {
  layoutKey = '';
  if (!strokes.length || before === after) return redraw();
  let a = 0;
  const min = Math.min(before.length, after.length);
  while (a < min && before[a] === after[a]) a++;
  let b = 0;
  while (b < min - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  const oldEnd = before.length - b;
  const delta = after.length - before.length;
  let moved = false;
  for (const s of strokes) {
    if (s.i >= oldEnd && delta) {
      s.i += delta;
      moved = true;
    } else if (s.i > a && s.i < oldEnd) {
      s.i = a;
      moved = true;
    }
  }
  if (moved) changed();
  else redraw();
}

export function setPenMode(on) {
  penMode = on;
  canvas.classList.toggle('active', on);
  ta.readOnly = on;
  if (on) ta.blur();
}

export const isPenMode = () => penMode;

export function setTool(t) {
  tool = t;
}

export function undo() {
  const last = undoStack.pop();
  if (!last) return false;
  if (last.kind === 'add') strokes = strokes.filter((s) => s !== last.stroke);
  else strokes.splice(last.at, 0, last.stroke);
  changed();
  return true;
}

export function clearAll() {
  if (!strokes.length) return;
  strokes.forEach((stroke, at) => undoStack.push({ kind: 'remove', stroke, at: 0 }));
  strokes = [];
  changed();
}

export const hasStrokes = () => strokes.length > 0;
