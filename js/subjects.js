// AI 노트의 주제 탭: 말씀(기본, 따로 저장 안 함) + 사용자가 만든 탭 (예: 미시경제학)
//
// 탭 = { id, name, rules, auto, dict, created, updated, deleted }
//   rules: 규칙 · 참고 자료 (책·논문 등). AI가 뜻을 쓸 때 따른다
//   auto : "용어:"를 치면 뜻을 자동으로 넣을지
//   dict : { 정규화한 용어: { t: 용어, d: 뜻, src: 'me'|'ai', u: 시각 } }
const KEY = 'biblenote.subjects.v1';
const DAY = 86400000;

let subjects = load();
let onSave = () => {};

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    // 오래된 삭제 표시는 버린다 (다른 기기에 이미 전달됐을 시간)
    return Array.isArray(list) ? list.filter((s) => !(s.deleted && s.updated < Date.now() - 30 * DAY)) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(subjects));
  } catch { /* 저장 공간 부족 */ }
}

function save(s) {
  s.updated = Date.now();
  persist();
  onSave(s);
}

/** 용어 비교용: 띄어쓰기·대소문자 무시 */
export const norm = (term) => term.replace(/\s+/g, '').toLowerCase();

export function initSubjects({ push }) {
  onSave = push;
}

export const allSubjects = () => subjects.filter((s) => !s.deleted).sort((a, b) => a.created - b.created);
export const getSubject = (id) => (id ? subjects.find((s) => s.id === id && !s.deleted) ?? null : null);

export function createSubject(name, id) {
  const now = Date.now();
  const s = { id, name: name.trim(), rules: '', auto: true, dict: {}, created: now, updated: now, deleted: false };
  subjects.push(s);
  save(s);
  return s;
}

export function updateSubject(s, patch) {
  Object.assign(s, patch);
  save(s);
}

export function deleteSubject(s) {
  Object.assign(s, { name: '', rules: '', dict: {}, deleted: true });
  save(s);
}

/* ───────── 용어 사전 ───────── */

export const lookupTerm = (s, term) => s?.dict?.[norm(term)]?.d ?? null;
export const termCount = (s) => Object.keys(s?.dict ?? {}).length;

export function setTerm(s, term, def, src = 'me') {
  const t = term.trim();
  const d = cleanDef(def);
  if (!t || !d) return false;
  s.dict = { ...s.dict, [norm(t)]: { t, d, src, u: Date.now() } };
  save(s);
  return true;
}

export function removeTerm(s, term) {
  const dict = { ...s.dict };
  delete dict[norm(term)];
  s.dict = dict;
  save(s);
}

/** 사전 목록 (찾는 말이 있으면 용어·뜻에 들어 있는 것만) */
export function listTerms(s, query = '') {
  const q = norm(query);
  return Object.values(s?.dict ?? {})
    .filter((e) => !q || norm(e.t).includes(q) || norm(e.d).includes(q))
    .sort((a, b) => a.t.localeCompare(b.t, 'ko'));
}

/** 뜻을 괄호 안에 넣기 좋게: 감싼 따옴표·괄호를 벗기고 한 줄로 */
export function cleanDef(def) {
  let d = String(def ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    const m = /^[("“'‘「](.*)[)"”'’」]$/.exec(d);
    if (m) d = m[1].trim();
  }
  return d;
}

/** "용어: 뜻", "용어 - 뜻", "용어 = 뜻", "용어<탭>뜻" 줄들 → [[용어, 뜻]] */
export function parseTermLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•▪▸]|\d+[.)])\s*/, '').trim();
    const m = /^(.{1,40}?)\s*(?::|：|\t| - | – | = )\s*(.+)$/.exec(line);
    if (m && /[가-힣A-Za-z]/.test(m[1])) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

export function importTerms(s, text) {
  const pairs = parseTermLines(text);
  if (!pairs.length) return 0;
  const dict = { ...s.dict };
  const now = Date.now();
  for (const [t, d] of pairs) {
    const def = cleanDef(d);
    if (def) dict[norm(t)] = { t, d: def, src: 'me', u: now };
  }
  s.dict = dict;
  save(s);
  return pairs.length;
}

/* ───────── "용어:" 찾기 ───────── */

// 콜론을 붙여 쓰지만 용어가 아닌 말 (AI에게 묻지 않는다)
const LABELS = new Set(['예', '예시', '예를들어', '참고', '정의', '뜻', '결론', '요약', '정리', '질문', '답', '문제', '풀이', '해설',
  '날짜', '시간', '장소', '준비물', '주제', '제목', '내용', '메모', '노트', '설명', '이유', '원인', '결과', '목표', '할일',
  '오늘', '내일', '어제', '출처', '비고', '주의', '중요', '핵심', '포인트', 'tip', 'note', 'q', 'a']);

export const isLabel = (term) => LABELS.has(norm(term));

/**
 * 콜론 앞 글(같은 줄)에서 용어를 찾는다.
 *   "상품수지"           → 상품수지
 *   "1. 한계 효용"       → 한계 효용
 *   "오늘 배운 것은 상품수지" → 사전에 있으면 상품수지, 없으면 마지막 낱말
 * known(용어) → 사전에 있는지
 */
export function termBefore(text, known) {
  let s = text.slice(text.lastIndexOf(')') + 1);
  s = s.replace(/^.*[.,;!?·…](?=\s)/, ''); // 문장이 끝난 뒤부터
  s = s.replace(/^\s*(?:[-*•▪▸→]|\d+[.)])\s*/, '').trim();
  if (!s || /\d$/.test(s) || !/[가-힣A-Za-z]$/.test(s)) return null; // "3:30" 같은 시각은 아니다
  const words = s.split(/\s+/);
  for (let k = 0; k < words.length; k++) {
    const cand = words.slice(k).join(' ');
    if (known(cand)) return { term: cand, known: true };
  }
  if (words.length <= 4 && s.length <= 25) return { term: s, known: false };
  return { term: words[words.length - 1], known: false };
}

/* ───────── 동기화 ───────── */

function applyRemote(remote) {
  let changed = false;
  for (const [id, r] of remote) {
    let s = subjects.find((x) => x.id === id);
    if (s && s.updated >= r.updated) continue;
    let dict = {};
    try {
      dict = JSON.parse(r.dict || '{}') || {};
    } catch { /* 깨진 데이터 */ }
    const incoming = {
      name: String(r.name ?? ''),
      rules: String(r.rules ?? ''),
      auto: r.auto !== false,
      dict,
      created: Number(r.created) || r.updated,
      updated: r.updated,
      deleted: !!r.deleted,
    };
    if (s) Object.assign(s, incoming);
    else subjects.push((s = { id, ...incoming }));
    changed = true;
  }
  if (changed) persist();
  return changed;
}

export const subjectSync = { get: () => subjects, apply: applyRemote };

/** 백업 파일용 */
export const exportSubjects = () => allSubjects();
export function importSubjects(list) {
  const remote = new Map((Array.isArray(list) ? list : []).filter((s) => s && typeof s.id === 'string')
    .map((s) => [s.id, { ...s, dict: JSON.stringify(s.dict ?? {}), updated: Number(s.updated) || Date.now() }]));
  const before = new Set(subjects.map((s) => `${s.id}:${s.updated}`));
  applyRemote(remote);
  const changed = subjects.filter((s) => !before.has(`${s.id}:${s.updated}`));
  for (const s of changed) onSave(s);
  return changed.length;
}
