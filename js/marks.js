// 글자 서식 (굵게 · 색깔 · 형광펜)
//
// 입력창(textarea)은 글자 하나하나에 서식을 줄 수 없어서, 글은 입력창에 그대로 두고
// 서식은 "몇 번째 글자부터 몇 번째까지"로 따로 저장한다: note.marks = [{ s, e, b?, c?, h? }]
//   s, e: 글자 번호 [s, e)   b: 굵게   c: 'red'|'blue' 글자색   h: 형광펜
// 화면에서는 입력창 글자를 투명하게 하고, 바로 뒤에 똑같이 줄바꿈되는 층(backdrop)에 서식을 입혀 그린다.
// 굵게는 글자 폭이 안 바뀌도록 외곽선으로 표현한다 (폭이 바뀌면 입력창과 어긋난다).

const ATTRS = ['b', 'c', 'h'];
const same = (a, b) => ATTRS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
const plain = (m) => ATTRS.every((k) => !m[k]);

/** 겹치지 않게 정렬돼 있다고 보고, 비어 있거나 서식 없는 구간을 빼고 이웃한 같은 서식을 합친다 */
function tidy(list) {
  const out = [];
  for (const m of list) {
    if (m.e <= m.s || plain(m)) continue;
    const last = out[out.length - 1];
    if (last && last.e === m.s && same(last, m)) last.e = m.e;
    else out.push({ ...m });
  }
  return out;
}

/** [s, e) 경계에서 구간들을 잘라 준다 */
function splitAt(list, s, e) {
  const out = [];
  for (const m of list) {
    const cuts = [m.s, ...[s, e].filter((x) => x > m.s && x < m.e), m.e];
    for (let i = 0; i + 1 < cuts.length; i++) out.push({ ...m, s: cuts[i], e: cuts[i + 1] });
  }
  return out;
}

/**
 * 선택한 [s, e)에 서식을 적용한다. attr: { b: 1 } | { c: 'red' } | { h: 1 } | null(서식 지우기)
 * 선택 전체에 이미 그 서식이 있으면 끈다 (같은 버튼을 다시 누르면 해제).
 */
export function applyMark(marks, s, e, attr) {
  if (e <= s) return marks;
  const cut = splitAt(marks, s, e);
  const inside = cut.filter((m) => m.s >= s && m.e <= e);
  if (!attr) return tidy(cut.filter((m) => m.e <= s || m.s >= e));

  const [key, value] = Object.entries(attr)[0];
  // 선택 전체가 이미 그 서식인지 (구간들이 빈틈없이 덮고 있어야 한다)
  let pos = s;
  let all = true;
  for (const m of inside) {
    if (m.s !== pos || m[key] !== value) all = false;
    pos = m.e;
  }
  all = all && pos === e;

  const result = cut.filter((m) => m.e <= s || m.s >= e);
  // 빈틈까지 채운 선택 구간을 새로 만든다
  pos = s;
  const add = (from, to, base) => {
    if (to <= from) return;
    const m = { ...base, s: from, e: to };
    if (all) delete m[key];
    else m[key] = value;
    result.push(m);
  };
  for (const m of inside) {
    add(pos, m.s, {});
    add(m.s, m.e, m);
    pos = m.e;
  }
  add(pos, e, {});
  result.sort((a, b) => a.s - b.s);
  return tidy(result);
}

/** 글이 바뀌면 서식 구간도 같이 옮긴다. 구간 안에 쓴 글은 구간에 포함, 끝에 이어 쓴 글은 포함하지 않는다 */
export function shiftMarks(marks, before, after) {
  if (!marks.length || before === after) return marks;
  let a = 0;
  const min = Math.min(before.length, after.length);
  while (a < min && before[a] === after[a]) a++;
  let b = 0;
  while (b < min - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  const oldEnd = before.length - b;
  const delta = after.length - before.length;
  const newEnd = oldEnd + delta;
  const moved = marks.map((m) => {
    if (m.e <= a) return m;
    if (m.s >= oldEnd) return { ...m, s: m.s + delta, e: m.e + delta };
    return { ...m, s: m.s < a ? m.s : newEnd, e: m.e > oldEnd ? m.e + delta : Math.min(m.e, a) };
  });
  return tidy(moved);
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 입력창과 똑같이 줄바꿈되도록 층의 글꼴·여백을 맞춘다 */
function fit(ta, box, inner) {
  const cs = getComputedStyle(ta);
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordBreak', 'overflowWrap', 'tabSize']) {
    inner.style[prop] = cs[prop];
  }
  // 아이폰 입력창에는 없앨 수 없는 좌우 3px 여백이 있어서 똑같이 맞춘다
  const extra = isIOS ? 3 : 0;
  inner.style.paddingLeft = `${parseFloat(cs.paddingLeft) + extra}px`;
  inner.style.paddingRight = `${parseFloat(cs.paddingRight) + extra}px`;
  inner.style.paddingTop = cs.paddingTop;
  inner.style.width = `${ta.clientWidth}px`;
  box.style.height = `${ta.clientHeight}px`;
}

/** 서식 층 다시 그리기. 서식이 없으면 층을 숨기고 입력창 글자를 그대로 쓴다 */
export function renderMarks(ta, box, inner, marks) {
  const on = marks.length > 0;
  ta.classList.toggle('styled', on);
  box.hidden = !on;
  if (!on) return;
  fit(ta, box, inner);
  const v = ta.value;
  const nodes = [];
  let pos = 0;
  for (const m of marks) {
    const s = Math.min(m.s, v.length);
    const e = Math.min(m.e, v.length);
    if (e <= s) continue;
    if (s > pos) nodes.push(document.createTextNode(v.slice(pos, s)));
    const span = document.createElement('span');
    span.className = [m.b ? 'm-bold' : '', m.c ? `m-${m.c}` : '', m.h ? 'm-hl' : ''].join(' ').trim();
    span.textContent = v.slice(s, e);
    nodes.push(span);
    pos = e;
  }
  // 맨 끝 줄바꿈도 입력창처럼 한 줄로 치도록 보이지 않는 글자를 하나 붙인다
  nodes.push(document.createTextNode(`${v.slice(pos)}​`));
  inner.replaceChildren(...nodes);
  scrollMarks(ta, inner);
}

export function scrollMarks(ta, inner) {
  inner.style.transform = `translateY(${-ta.scrollTop}px)`;
}
