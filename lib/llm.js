// Shared LLM chain for chess endpoints: FreeLLMAPI -> OmniRoute -> OpenRouter free.
// A step is skipped when its env vars are not set. Keys live only in Vercel env vars.

const MOVE_PATTERNS = [
  /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/,   // Nf3, Qxd5, Rae1
  /\b[a-h]x[a-h][1-8]\b/,                  // exd5
  /\bO-O(-O)?\b/,                          // castling
  /\b[a-h][1-8]\s*(to|->|→|-)\s*[a-h][1-8]\b/i,
];

function providers() {
  const list = [];
  if (process.env.FREELLM_URL && process.env.FREELLM_KEY) {
    list.push({ name: 'freellm', url: process.env.FREELLM_URL, key: process.env.FREELLM_KEY, model: process.env.FREELLM_MODEL || 'auto' });
  }
  if (process.env.OMNIROUTE_URL && process.env.OMNIROUTE_KEY) {
    list.push({ name: 'omniroute', url: process.env.OMNIROUTE_URL, key: process.env.OMNIROUTE_KEY, model: process.env.OMNIROUTE_MODEL || 'free-first' });
  }
  if (process.env.OPENROUTER_API_KEY) {
    list.push({ name: 'openrouter', url: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY, model: 'openrouter/free' });
  }
  return list;
}

async function callProvider(p, messages, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(p.url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(p.name + ' HTTP ' + res.status);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error(p.name + ' empty reply');
    return { text: text.trim(), via: p.name };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { text, via } from the first provider that answers, or throws with all errors.
async function chat(messages, maxTokens = 250) {
  const chain = providers();
  if (!chain.length) throw new Error('not configured');
  const errors = [];
  for (const p of chain) {
    try { return await callProvider(p, messages, maxTokens); }
    catch (err) { errors.push(String(err.message || err)); }
  }
  const e = new Error('all providers failed');
  e.details = errors;
  throw e;
}

function leaksMove(text) {
  return MOVE_PATTERNS.some(re => re.test(text));
}

// Best-effort per-IP rate limit (resets on cold start).
const hits = new Map();
function rateLimited(ip, limitPerMin = 10) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limitPerMin;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

module.exports = { chat, leaksMove, rateLimited, clientIp, readBody, providers };
