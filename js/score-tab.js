// 악보 탭: 찬양 제목·가사로 악보 이미지를 바로 검색해 준다.
// 악보는 저작권이 있고 다른 사이트 이미지를 앱으로 가져올 수도 없어서, 앱에 담지 않고 검색 결과로 연결한다.
const RECENT_KEY = 'biblenote.scorerecent.v1';
const RECENT_MAX = 8;

let el = null;

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function remember(q) {
  const list = [q, ...readRecent().filter((x) => x !== q)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* 무시 */ }
  renderRecent();
}

/** "305", "305장" → 새찬송가 305장 */
function queryOf(text) {
  const q = text.trim().replace(/\s+/g, ' ');
  const hymn = /^(\d{1,3})\s*장?$/.exec(q);
  return hymn ? `새찬송가 ${hymn[1]}장` : q;
}

const google = (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${q} 악보`)}`;
const naver = (q) => `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(`${q} 악보`)}`;
const lyrics = (q) => `https://www.google.com/search?q=${encodeURIComponent(`${q} 가사`)}`;

function updateLinks() {
  const q = queryOf(el.input.value);
  el.links.classList.toggle('off', !q);
  el.google.href = q ? google(q) : '#';
  el.naver.href = q ? naver(q) : '#';
  el.lyrics.href = q ? lyrics(q) : '#';
}

function renderRecent() {
  const list = readRecent();
  el.recentBox.hidden = !list.length;
  el.recent.replaceChildren(...list.map((q) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-btn';
    b.textContent = q;
    b.addEventListener('click', () => {
      el.input.value = q;
      updateLinks();
    });
    return b;
  }));
}

export function initScoreTab({ $ }) {
  el = {
    input: $('score-input'),
    links: $('score-links'),
    google: $('score-google'),
    naver: $('score-naver'),
    lyrics: $('score-lyrics'),
    recent: $('score-recent'),
    recentBox: $('score-recent-box'),
  };
  el.input.addEventListener('input', updateLinks);
  $('score-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = queryOf(el.input.value);
    if (!q) return;
    remember(q);
    window.open(google(q), '_blank', 'noopener');
  });
  for (const a of [el.google, el.naver, el.lyrics]) {
    a.addEventListener('click', (e) => {
      const q = queryOf(el.input.value);
      if (!q) e.preventDefault();
      else remember(q);
    });
  }
  updateLinks();
  renderRecent();
}
