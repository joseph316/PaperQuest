import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const DEFAULT_PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ROOT = process.env.APP_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || ROOT;
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = join(DATA_DIR, 'paperquest-data.json');

async function loadDotEnv() {
  try {
    const envPath = join(ROOT, '.env');
    const text = await readFile(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleGetState(req, res) {
  try {
    const body = await readFile(DATA_FILE, 'utf8');
    send(res, 200, body || '{}');
  } catch {
    const empty = { papers: [] };
    await writeFile(DATA_FILE, JSON.stringify(empty, null, 2), 'utf8');
    send(res, 200, JSON.stringify(empty));
  }
}

async function handleSaveState(req, res) {
  const body = await readJson(req);
  await writeFile(DATA_FILE, JSON.stringify(body, null, 2), 'utf8');
  send(res, 200, JSON.stringify({ ok: true, file: DATA_FILE }));
}

async function handleChat(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    send(res, 500, JSON.stringify({ error: 'OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다. .env 파일 또는 환경변수에 API 키를 설정해 주세요.' }));
    return;
  }

  const { prompt } = await readJson(req);
  if (!prompt || typeof prompt !== 'string') {
    send(res, 400, JSON.stringify({ error: 'prompt가 비어 있습니다.' }));
    return;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: 'system',
          content: 'You are a research reading assistant. Answer in Korean unless the user asks otherwise. Be concise, concrete, and grounded in the provided paper metadata/abstract. If the metadata is insufficient, say what is uncertain.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    send(res, response.status, JSON.stringify({ error: data.error?.message || 'OpenAI API 요청에 실패했습니다.' }));
    return;
  }

  const answer = data.output_text
    || data.output?.flatMap(item => item.content || []).map(c => c.text || '').join('\n').trim()
    || '응답 텍스트를 읽을 수 없습니다.';
  send(res, 200, JSON.stringify({ answer }));
}

async function handleTranslate(req, res) {
  const { text, langpair } = await readJson(req);
  const q = String(text || '').trim();
  const pair = String(langpair || 'en|ko');
  if (!q) {
    send(res, 400, JSON.stringify({ error: '번역할 단어 또는 문장이 비어 있습니다.' }));
    return;
  }
  if (!['en|ko', 'ko|en'].includes(pair)) {
    send(res, 400, JSON.stringify({ error: '지원하지 않는 번역 방향입니다.' }));
    return;
  }
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', q);
  url.searchParams.set('langpair', pair);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    send(res, response.status, JSON.stringify({ error: data.responseDetails || '번역 요청에 실패했습니다.' }));
    return;
  }
  const translatedText = data.responseData?.translatedText || '';
  if (!translatedText) {
    send(res, 500, JSON.stringify({ error: '번역 결과를 읽을 수 없습니다.' }));
    return;
  }
  send(res, 200, JSON.stringify({ translatedText, source: 'MyMemory', match: data.responseData?.match ?? null }));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${DEFAULT_PORT}`);
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const safePath = normalize(pathname).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = join(ROOT, safePath);
  const body = await readFile(filePath);
  send(res, 200, body, mime[extname(filePath)] || 'application/octet-stream');
}

export function startPaperQuestServer({ port = DEFAULT_PORT } = {}) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (req.url === '/health') return send(res, 200, JSON.stringify({ ok: true, dataFile: DATA_FILE }));
      if (req.url === '/api/state' && req.method === 'GET') return await handleGetState(req, res);
      if (req.url === '/api/state' && req.method === 'POST') return await handleSaveState(req, res);
      if (req.url === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
      if (req.url === '/api/translate' && req.method === 'POST') return await handleTranslate(req, res);
      if (req.method === 'GET') return await serveStatic(req, res);
      send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message || 'Server error' }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      console.log(`PaperQuest local server: http://localhost:${port}`);
      console.log(`Static root: ${ROOT}`);
      console.log(`Data file: ${DATA_FILE}`);
      console.log(`Model: ${MODEL}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  await loadDotEnv();
  startPaperQuestServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
