// AI가 용어의 뜻을 쓴다 (Claude API · 공식 SDK)
//
// 키는 사용자가 설정에 넣은 본인의 Claude API 키를 쓰고, 이 기기(localStorage)에만 저장한다 (동기화하지 않음).
// SDK는 AI를 처음 쓸 때만 불러온다 → AI를 안 쓰면 앱이 무거워지지 않는다.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.12.0/+esm';
const KEY = 'biblenote.aikey.v1';

export const MODELS = {
  'claude-opus-5-5': 'Opus 5.5 · 가장 정확 (용어 하나에 약 10~20원)',
  'claude-haiku-5-5': 'Haiku 5.5 · 빠르고 저렴 (용어 하나에 1원 미만)',
};
export const DEFAULT_MODEL = 'claude-opus-5-5';

export function getKey() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setKey(key) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch { /* 무시 */ }
  client = null;
}

export const hasKey = () => !!getKey();

let Anthropic = null;
let client = null;

async function getClient() {
  if (!Anthropic) Anthropic = (await import(SDK_URL)).default;
  // 브라우저에서 키를 쓰는 건 SDK가 기본으로 막아 둔다. 본인 키를 본인 기기에서만 쓰므로 허용한다.
  client ??= new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true, maxRetries: 1 });
  return client;
}

function systemPrompt({ subject, rules, examples }) {
  const lines = [
    `당신은 '${subject}' 공부 노트를 돕는 조수입니다. 사용자가 노트에 적은 용어의 뜻을, 노트의 괄호 안에 바로 넣을 수 있게 써 줍니다.`,
    '',
    '답하는 방법',
    '- 한국어로, 한 문장(길어도 두 문장)으로 짧게 씁니다.',
    "- 뜻만 씁니다. 용어를 되풀이하거나 인사·따옴표·괄호·'정의:' 같은 머리말은 붙이지 않습니다.",
    "- 사전처럼 '~하는 것.', '~을 나타내는 수지.'처럼 끝맺습니다.",
    `- '${subject}' 분야에서 쓰는 뜻으로 씁니다.`,
    "- 이 분야 용어가 아니거나 뜻을 확실히 모르면 물음표 하나('?')만 답합니다.",
  ];
  if (rules.trim()) lines.push('', '사용자가 정한 규칙과 참고 자료 (이를 따르세요):', rules.trim());
  if (examples.length) {
    lines.push('', '이 노트에 이미 적힌 뜻 (말투와 길이를 맞추세요):');
    for (const e of examples) lines.push(`- ${e.t}: ${e.d}`);
  }
  return lines.join('\n');
}

/**
 * 용어의 뜻 한 문장. 모르면 '' 를 돌려준다.
 * @param {{ model: string, subject: string, rules: string, examples: {t: string, d: string}[], term: string }} p
 */
export async function defineTerm({ model, subject, rules, examples, term }) {
  const c = await getClient();
  const params = {
    model,
    max_tokens: 2000, // 짧은 답이지만, 생각하는 데 쓰는 토큰도 이 안에 들어간다
    output_config: { effort: 'low' }, // 짧은 정의라 깊게 생각할 필요가 없다 (빠르고 저렴)
    cache_control: { type: 'ephemeral' }, // 같은 탭의 규칙이 길면 재사용해서 싸게
    system: systemPrompt({ subject, rules, examples }),
    messages: [{ role: 'user', content: term }],
  };
  // Opus는 안전 장치가 거절하면 서버가 다른 모델로 다시 답하게 한다 (Haiku는 이 기능이 없다)
  let res;
  if (model === 'claude-opus-5-5') {
    try {
      res = await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      // 계정에서 이 기능을 못 쓰는 경우 등: 기본 요청으로 한 번 더
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      res = await c.messages.create(params);
    }
  } else {
    res = await c.messages.create(params);
  }
  if (res.stop_reason === 'refusal') return '';
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text === '?' || text === '？' ? '' : text;
}

/** 키가 맞는지 확인 (모델 정보만 읽어서 요금이 들지 않는다) */
export async function testKey(model) {
  const c = await getClient();
  await c.models.retrieve(model);
}

/** 오류 → 사용자에게 보여 줄 말 */
export function errorMessage(err) {
  if (!Anthropic) return '인터넷에 연결된 상태에서 다시 해 주세요';
  if (err instanceof Anthropic.AuthenticationError) return 'API 키가 맞지 않아요. 설정에서 키를 확인해 주세요';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 키로는 이 모델을 쓸 수 없어요';
  if (err instanceof Anthropic.NotFoundError) return '이 계정에서 쓸 수 없는 모델이에요. 설정에서 다른 모델을 골라 주세요';
  if (err instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 해 주세요';
  if (err instanceof Anthropic.APIConnectionError) return '인터넷 연결을 확인해 주세요';
  if (err instanceof Anthropic.APIError) {
    if (err.status === 402) return 'Anthropic 계정의 크레딧(결제)을 확인해 주세요';
    if (err.status === 529 || err.status >= 500) return 'AI 서버가 바빠요. 잠시 후 다시 해 주세요';
    return `AI 요청 오류 (${err.status ?? '알 수 없음'})`;
  }
  return 'AI가 답하지 못했어요';
}
