// Chess LLM calls. Only OpenRouter, only the free auto-router (openrouter/free).
// Key lives only in the Vercel env var OPENROUTER_API_KEY. Never in the page.

const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const URL_BASE = 'https://openrouter.ai/api/v1';

const MOVE_PATTERNS = [
  /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/,   // Nf3, Qxd5, Rae1
  /\b[a-h]x[a-h][1-8]\b/,                  // exd5
  /\bO-O(-O)?\b/,                          // castling
  /\b[a-h][1-8]\s*(to|->|→|-)\s*[a-h][1-8]\b/i,
];

async function chat(messages, maxTokens = 250) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(URL_BASE + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.4 }),
    });
    if (!res.ok) throw new Error('openrouter HTTP ' + res.status);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('openrouter empty reply');
    return { text: text.trim(), via: 'openrouter:' + MODEL };
  } finally {
    clearTimeout(timer);
  }
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

module.exports = { chat, leaksMove, rateLimited, clientIp, readBody };
