// Eleven AI: 사전에 없는 용어의 뜻을 찾아, 노트 괄호에 넣기 좋은 한 문장으로 정리한다.
//
// API 키도 요금도 없이 이 앱 안에서 돌아간다:
//   1) 이 탭의 규칙·참고 자료와 노트에서 찾는다 (인터넷 없이도 됨)
//      "용어란 …", "용어는 …이다", 참고 자료의 "용어: 뜻" 줄, 노트에 넣어 둔 "용어: (뜻)"
//   2) 없으면 한국어 위키백과에서 그 용어 문서의 첫 문장을 가져온다 (보내는 건 용어 하나뿐)
//   3) 찾은 문장을 사전 말투로 다듬는다
//      "기회비용(機會費用, 영어: opportunity cost)은 … 가장 큰 것의 가치를 말한다." → "… 가장 큰 것의 가치."
const WIKI_API = 'https://ko.wikipedia.org/w/api.php';
const WIKI_PAGE = 'https://ko.wikipedia.org/wiki/';
const TIMEOUT = 8000;

const squash = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 띄어쓰기와 상관없이 용어를 찾는 정규식 조각: "무차별곡선" ↔ "무차별 곡선" */
const termRe = (term) => [...String(term).replace(/\s+/g, '')].map(escapeRe).join('\\s*');

/* ───────── 문장 다듬기 ───────── */

// 한자·영어 이름처럼 덧붙인 괄호 (뜻에 필요한 괄호는 남긴다)
const LANG = /(영어|한자|문화어|약칭|약어|독일어|프랑스어|라틴어|일본어|중국어|그리스어|히브리어|스페인어|이탈리아어|러시아어|아랍어)\s*:/;
const isAside = (inner) => {
  const s = inner.trim();
  return !s || LANG.test(s) || /^[㐀-鿿豈-﫿\s,·・]+$/.test(s) || /^[A-Za-z0-9\s,.'’\-:;&/]+$/.test(s);
};

function dropAsides(s) {
  let prev;
  do {
    prev = s;
    // 안쪽 괄호부터 지운다: "(稱義, 히브리어: צדקה (tsedeq))" → "(稱義, 히브리어: צדקה)" → ""
    s = s.replace(/\s*\(([^()]*)\)/g, (m, inner) => (isAside(inner) ? '' : m));
  } while (s !== prev);
  return s;
}

/** s[i]가 '('이면 짝이 맞는 ')' 다음 위치 */
function skipParen(s, i) {
  if (s[i] !== '(') return i;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '(') depth++;
    else if (s[k] === ')' && --depth === 0) return k + 1;
  }
  return i;
}

/** 문장 앞의 "용어(…)는 " 같은 주어를 뗀다 ("경제학에서 탄력성이란 " 처럼 앞에 몇 글자가 있어도) */
function stripSubject(s, names) {
  for (const name of names) {
    if (!name) continue;
    const m = new RegExp(`^(.{0,30}?)${termRe(name)}`).exec(s);
    if (!m) continue;
    let i = skipParen(s, m[0].length);
    if (s[i] === ' ' && s[i + 1] === '(') i = skipParen(s, i + 1);
    const p = /^\s*(?:이라\s*함은|라\s*함은|이란|란|은|는|이|가)\s+/.exec(s.slice(i));
    if (p) return s.slice(i + p[0].length);
  }
  return s;
}

// 사전 말투로 끝맺기: "…의 가치를 말한다." → "…의 가치."
const ENDINGS = [
  /\s*(?:이)?라고\s*(?:정의|말|부르기도|이야기)\s*(?:할|한다|된다|하기도\s*한다)?\s*(?:수\s*있다)?\s*\.?$/,
  /\s*(?:을|를)\s*(?:말한다|뜻한다|의미한다|가리킨다|일컫는다|이른다|지칭한다|칭한다|말함|뜻함|의미함)\s*\.?$/,
  /\s*(?:을|를)\s*(?:말하며|뜻하며|의미하며|가리키며|말하고|뜻하고)\s*,?$/,
  /(?<=[가-힣)])\s*이다\s*\.?$/,
];

/** 첫 문장 (한국어 문장은 "…다." 다음에 띄어 쓴 곳에서 끝난다) */
function firstSentence(text) {
  const para = String(text).split(/\n+/).find((p) => p.trim()) ?? '';
  return para.split(/(?<=[가-힣a-z0-9)\]’”]\.)\s+/)[0].trim();
}

/** 찾은 문장 → 괄호에 넣을 뜻 한 문장 ('' = 쓸 만하지 않음) */
export function shape(raw, names = []) {
  let s = String(raw ?? '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  s = stripSubject(dropAsides(s), names);
  for (const re of ENDINGS) s = s.replace(re, '');
  s = s.replace(/[\s,;:·]+$/, '').trim();
  if (s.length < 4 || !/[가-힣]/.test(s)) return '';
  if (s.length > 200) s = `${s.slice(0, 198).replace(/\s+\S*$/, '')}…`;
  if (!/[.…?!]$/.test(s)) s += '.';
  return s;
}

/* ───────── 1) 탭의 참고 자료 · 노트에서 찾기 ───────── */

const BULLET = '(?:[-*•▪▸▾☐☑|]\\s*|\\d+[.)]\\s*)?';

function fromTexts(term, { rules = '', notes = [] }) {
  const t = termRe(term);
  // "용어란 … 말한다." / "용어는 …이다." (정의하는 문장만: 끝맺음을 본다)
  const defines = new RegExp(`(?:^|[\\n.!?]\\s*|\\s)${BULLET}${t}\\s*(?:\\([^()\\n]*\\))?\\s*(?:이라\\s*함은|라\\s*함은|이란|란|은|는)\\s+`
    + '([^\\n]{2,300}?(?:이다|말한다|뜻한다|의미한다|가리킨다|일컫는다|이른다|것)\\s*\\.?)(?=\\s|$)');
  // 참고 자료의 "용어: 뜻" 줄
  const line = new RegExp(`(?:^|\\n)\\s*${BULLET}${t}\\s*(?:[:：=]|\\s[-–]\\s)\\s*([^\\n(][^\\n]{1,300})`);
  // 노트에 넣어 둔 "용어: (뜻)"
  const inserted = new RegExp(`${t}\\s*[:：]\\s*\\(([^()\\n]{2,300})\\)`);

  const tries = [[line, [rules]], [defines, [rules, ...notes]], [inserted, notes]];
  for (const [re, texts] of tries) {
    for (const text of texts) {
      const m = text && re.exec(text);
      const def = m && shape(m[1], [term]);
      if (def) return { def, from: 'notes' };
    }
  }
  return null;
}

/* ───────── 2) 위키백과 ───────── */

async function wikiGet(params, signal) {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const r = await fetch(`${WIKI_API}?${q}`, { signal });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  return r.json();
}

/** 문서 첫 부분 (넘겨주기를 따라간다). 없으면 null */
async function wikiIntro(title, signal) {
  const d = await wikiGet({
    action: 'query', redirects: '1', prop: 'extracts|pageprops', exintro: '1', explaintext: '1',
    exsentences: '2', ppprop: 'disambiguation', titles: title,
  }, signal);
  const p = d?.query?.pages?.[0];
  if (!p || p.missing || p.invalid) return null;
  return { title: p.title, text: p.extract ?? '', disambig: !!p.pageprops };
}

async function wikiSearch(q, signal) {
  const d = await wikiGet({ action: 'query', list: 'search', srsearch: q, srlimit: '6', srnamespace: '0', srprop: '' }, signal);
  return (d?.query?.search ?? []).map((r) => r.title);
}

async function fromWiki(term, subject, signal) {
  const key = squash(term);
  const tried = new Set();
  const tryPage = async (title) => {
    if (tried.has(title)) return null;
    tried.add(title);
    const page = await wikiIntro(title, signal);
    if (!page) return null;
    tried.add(page.title);
    if (page.disambig || !page.text) return null;
    const def = shape(firstSentence(page.text), [term, page.title, page.title.replace(/\s*\(.*\)$/, '')]);
    return def ? { def, from: 'wiki', title: page.title } : null;
  };

  const hit = await tryPage(term);
  if (hit) return hit;
  // 문서가 없거나 동음이의어 문서면: 탭 이름을 붙여 검색해서, 제목에 그 용어가 들어간 문서
  for (const q of subject ? [`${term} ${subject}`, term] : [term]) {
    const titles = (await wikiSearch(q, signal)).filter((t) => squash(t).includes(key));
    // "수요 (경제학)"처럼 제목이 용어와 같은 문서를 먼저
    titles.sort((a, b) => Number(squash(b.replace(/\s*\(.*\)$/, '')) === key) - Number(squash(a.replace(/\s*\(.*\)$/, '')) === key));
    for (const t of titles.slice(0, 2)) {
      const h = await tryPage(t);
      if (h) return h;
    }
  }
  return null;
}

/* ───────── 밖에서 쓰는 것 ───────── */

/**
 * 용어의 뜻을 찾는다. 못 찾으면 null.
 * @param {{ term: string, subject?: string, rules?: string, notes?: string[], online?: boolean }} p
 * @returns {Promise<{ def: string, from: 'notes'|'wiki', title?: string } | null>}
 */
export async function defineTerm({ term, subject = '', rules = '', notes = [], online = true }) {
  const local = fromTexts(term, { rules, notes });
  if (local || !online) return local;
  if (!navigator.onLine) throw new Error('offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fromWiki(term, subject, ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 어디서 찾았는지: 알림·사전에 보여 줄 말 */
export const sourceLabel = (hit) => (hit.from === 'wiki' ? `위키백과 ‘${hit.title}’` : '탭 자료·노트');
export const wikiUrl = (title) => WIKI_PAGE + encodeURIComponent(title.replace(/ /g, '_'));

/** 오류 → 사용자에게 보여 줄 말 */
export function errorMessage(err) {
  if (err?.message === 'offline' || !navigator.onLine) return '인터넷에 연결되면 위키백과에서 찾아 드려요';
  if (err?.name === 'AbortError') return '위키백과가 늦게 답해서 그만뒀어요. 다시 해 주세요';
  return '뜻을 찾지 못했어요. 잠시 후 다시 해 주세요';
}
