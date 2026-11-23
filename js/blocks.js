// 노션처럼 정리하기: 토글 · 할 일 · 제목 · 글머리 · 번호 · 인용 · 구분선
//
// 노트는 그대로 글자로 저장한다 → 동기화·백업·공유해도 그대로 읽힌다.
//   ▾ 펼친 토글   ▸ 접은 토글   ☐ 할 일   ☑ 한 일   • 글머리(- * 도 됨)   1. 번호   | 인용   # 제목   --- 구분선
//   토글 안의 내용 = 토글 줄보다 더 들여 쓴(앞에 띄어쓰기 2칸) 줄들
// 편집 화면: 줄 맨 앞에서 "> " → "▾ ", "[] " → "☐ ", "\" " → "| ". 엔터를 치면 목록을 이어 쓴다.
// 보기 화면: 토글을 접고 펴고, 할 일을 눌러 체크한다.

export const INDENT = '  ';

const LINE_RE = /^([ \t　]*)(?:(?<h>#{1,3}) |(?<tg>[▸▾]) |(?<td>[☐☑]) |(?<box>\[(?: |x|X)?\]) |(?<bl>[•\-*]) |(?<num>\d{1,3})(?<dl>[.)]) |(?<q>\|) )?/;
const DIVIDER = /^\s*(?:-{3,}|—{2,}|\*{3,}|_{3,})\s*$/;

/** 줄 하나 → { indentStr, width, markerLen, content, kind, open, done, num, delim } */
export function parseLine(line) {
  const m = LINE_RE.exec(line);
  const g = m.groups ?? {};
  const indentStr = m[1];
  let width = 0;
  for (const c of indentStr) width += c === '\t' ? 4 : c === '　' ? 2 : 1;
  const out = {
    indentStr, width, markerLen: m[0].length - indentStr.length, content: line.slice(m[0].length),
    kind: 'text', open: false, done: false, num: 0, delim: '',
  };
  if (g.h) out.kind = `h${g.h.length}`;
  else if (g.tg) Object.assign(out, { kind: 'toggle', open: g.tg === '▾' });
  else if (g.td) Object.assign(out, { kind: 'todo', done: g.td === '☑' });
  else if (g.box) Object.assign(out, { kind: 'todo', done: /x/i.test(g.box) });
  else if (g.bl) out.kind = 'bullet';
  else if (g.num) Object.assign(out, { kind: 'num', num: Number(g.num), delim: g.dl });
  else if (g.q) out.kind = 'quote';
  else if (DIVIDER.test(line)) out.kind = 'divider';
  else if (!line.trim()) out.kind = 'empty';
  return out;
}

const outdentStr = (ind) => ind.replace(/(?: {1,2}|\t|　)$/, '');

/**
 * 엔터로 새 줄을 만든 직후, 바로 윗줄(prevLine)을 보고 할 일:
 *   { insert }  새 줄 맨 앞에 넣을 글 (목록 이어 쓰기)
 *   { line }    빈 항목에서 엔터 → 윗줄을 line으로 바꾸고 방금 만든 줄은 없앤다 (목록 끝내기 · 한 칸 내어쓰기)
 *   openToggle  윗줄이 접힌 토글이면 펴기
 *   null        할 일 없음
 */
export function continueAfter(prevLine) {
  const p = parseLine(prevLine);
  const ind = p.indentStr;
  const empty = !p.content.trim();
  const marker = prevLine.slice(ind.length, ind.length + p.markerLen);
  // 내용 없이 머리말만 있는 줄: 들여 썼으면 한 칸 내어쓰고, 아니면 머리말을 지운다
  const exit = () => ({ line: ind ? outdentStr(ind) + marker : '' });
  switch (p.kind) {
    case 'toggle': return empty ? exit() : { insert: ind + INDENT, openToggle: !p.open };
    case 'todo': return empty ? exit() : { insert: `${ind}☐ ` };
    case 'bullet': return empty ? exit() : { insert: ind + marker };
    case 'num': return empty ? exit() : { insert: `${ind}${p.num + 1}${p.delim} ` };
    case 'empty': return ind ? { line: outdentStr(ind) } : null; // 토글 안에서 빈 줄로 엔터 → 토글 밖으로
    default: return ind ? { insert: ind } : null; // 들여 쓴 줄은 들여쓰기를 이어 간다
  }
}

/** 줄 맨 앞에서 방금 띄어쓰기를 쳤을 때: "> " → "▾ " 처럼 바꿀 것. lineBefore = 줄 처음부터 커서까지 */
export function shortcutAt(lineBefore) {
  const m = /^([ \t　]*)(>|\[ ?\]|\[[xX]\]|"|“)[  ]$/.exec(lineBefore);
  if (!m) return null;
  const k = m[2];
  const to = k === '>' ? '▾ ' : k === '"' || k === '“' ? '| ' : /x/i.test(k) ? '☑ ' : '☐ ';
  return { at: m[1].length, len: k.length + 1, to };
}

/** 보기 화면에서 누르면 바뀌는 머리말: 토글 ▸↔▾, 할 일 ☐↔☑ */
export function flippedMarker(p) {
  if (p.kind === 'toggle') return p.open ? '▸ ' : '▾ ';
  if (p.kind === 'todo') return p.done ? '☐ ' : '☑ ';
  return null;
}

/** 블록 메뉴 ("/" 또는 ＋ 버튼) */
export const BLOCK_TYPES = [
  { id: 'toggle', label: '토글', marker: '▾ ', icon: '▸' },
  { id: 'todo', label: '할 일', marker: '☐ ', icon: '☐' },
  { id: 'bullet', label: '글머리', marker: '• ', icon: '•' },
  { id: 'num', label: '번호', marker: '1. ', icon: '1.' },
  { id: 'h1', label: '제목1', marker: '# ', icon: 'H1' },
  { id: 'h2', label: '제목2', marker: '## ', icon: 'H2' },
  { id: 'h3', label: '제목3', marker: '### ', icon: 'H3' },
  { id: 'quote', label: '인용', marker: '| ', icon: '❝' },
  { id: 'divider', label: '구분선', marker: '---', icon: '―' },
  { id: 'text', label: '글', marker: '', icon: 'T' },
];

/**
 * 노트 → 블록 나무. 각 줄이 블록이고, 그 줄보다 더 들여 쓴 다음 줄들이 자식이 된다.
 * 빈 줄은 다음 줄의 들여쓰기를 따른다 (토글 안의 빈 줄은 토글 안에 남게).
 * @returns {{ line: object, children: object[] }[]}  line = parseLine 결과 + start(글자 위치), end
 */
export function parseBlocks(text) {
  const lines = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    lines.push({ ...parseLine(raw), start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }
  let next = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind === 'empty') lines[i].width = next;
    else next = lines[i].width;
  }
  const root = { children: [] };
  const stack = [{ node: root, width: -1 }];
  for (const line of lines) {
    while (stack.length > 1 && line.width <= stack[stack.length - 1].width) stack.pop();
    const node = { line, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, width: line.width });
  }
  // 맨 끝의 빈 줄들은 보여 줄 필요가 없다
  while (root.children.length && root.children[root.children.length - 1].line.kind === 'empty'
    && !root.children[root.children.length - 1].children.length) root.children.pop();
  return root.children;
}

/** 할 일 개수 { done, total } */
export function todoCount(text) {
  let done = 0;
  let total = 0;
  for (const raw of text.split('\n')) {
    const p = parseLine(raw);
    if (p.kind !== 'todo') continue;
    total++;
    if (p.done) done++;
  }
  return { done, total };
}

/** 정리 보기를 쓸 만한 노트인지 (토글·할 일이 있으면 열 때 보기 화면으로) */
export const hasStructure = (text) => /^[ \t　]*(?:[▸▾☐☑] |\[(?: |x|X)?\] )/m.test(text);
