'use strict';

import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-argon';
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const GEMINI_THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL || 'high').toUpperCase();
const GEMINI_ENABLE_SEARCH = process.env.GEMINI_ENABLE_SEARCH !== 'false';
const GEMINI_ENABLE_URL_CONTEXT = process.env.GEMINI_ENABLE_URL_CONTEXT !== 'false';
const GEMINI_ENABLE_CODE_EXECUTION = process.env.GEMINI_ENABLE_CODE_EXECUTION === 'true';
const GEMINI_STRUCTURED_OUTPUT = process.env.GEMINI_STRUCTURED_OUTPUT === 'true';
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE || 0.25);
const GEMINI_MAX_OUTPUT = Number(process.env.GEMINI_MAX_OUTPUT || 8192);
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const GEMINI_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Orus';
const GEMINI_LIVE_ENABLED = process.env.GEMINI_LIVE_ENABLED !== 'false';
const ACCESS_PASSWORD = process.env.EXION_ACCESS_PASSWORD || '';
const SITE_URL = process.env.OPENROUTER_SITE_URL || `http://${HOST}:${PORT}`;
const APP_NAME = process.env.OPENROUTER_APP_NAME || 'EXION AI';
const IMAGE_API_URL = process.env.IMAGE_API_URL || '';
const IMAGE_API_KEY = process.env.IMAGE_API_KEY || '';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-4.1-mini';
const MAX_BODY = 16_000_000;
const MAX_OUTPUT = 120_000;
const COMMAND_TIMEOUT = 8_000;
const DATA_DIR = process.env.EXION_DATA_DIR || path.join(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MAX_STORED_MESSAGES = 5000;
let memoryStore = { users: {} };
let memoryWrite = Promise.resolve();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Exion-Password',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function authorized(req) {
  if (!ACCESS_PASSWORD) return true;
  return req.headers['x-exion-password'] === ACCESS_PASSWORD;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-24).filter(m =>
    m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'
  ).map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIP(address) === 6) {
    const x = address.toLowerCase();
    return x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:');
  }
  return false;
}

async function safeUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Apenas URLs HTTP/HTTPS são permitidas.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Host local bloqueado.');
  const ips = await dns.lookup(host, { all: true });
  if (ips.some(x => isPrivateAddress(x.address))) throw new Error('Endereço de rede privada bloqueado.');
  return u;
}

async function publicFetch(rawUrl, init = {}) {
  let current = await safeUrl(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (![301,302,303,307,308].includes(response.status)) return { response, url: current };
    const location = response.headers.get('location');
    if (!location) return { response, url: current };
    current = await safeUrl(new URL(location, current).toString());
  }
  throw new Error('Muitos redirecionamentos.');
}

async function webFetch({ url }) {
  const { response, url: finalUrl } = await publicFetch(url, { headers: { 'User-Agent': 'EXION/4.1 web-fetch' } });
  const text = await response.text();
  return { url: finalUrl.toString(), status: response.status, contentType: response.headers.get('content-type') || '', text: text.slice(0, 30000) };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

async function webSearch({ query }) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) throw new Error('Consulta de pesquisa inválida.');
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
  const { response, url: finalUrl } = await publicFetch(url, { headers: { 'User-Agent': 'EXION/4.1 web-search' } });
  if (!response.ok) throw new Error(`Pesquisa web respondeu HTTP ${response.status}.`);
  const html = await response.text();
  const results = [];
  const blocks = html.match(/<div[^>]*class="result[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let href = link[1].replace(/&amp;/g, '&');
    try {
      const parsed = new URL(href);
      if (parsed.hostname.includes('duckduckgo.com')) {
        const target = parsed.searchParams.get('uddg');
        if (target) href = decodeURIComponent(target);
      }
      await safeUrl(href);
    } catch { continue; }
    const title = stripHtml(link[2]);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = stripHtml(snippetMatch?.[1] || snippetMatch?.[2] || '');
    results.push({ title, url: href, snippet });
    if (results.length >= 8) break;
  }
  return { query, source: finalUrl.toString(), results };
}

async function githubSearch({ query }) {
  if (!query || query.length > 200) throw new Error('Consulta inválida.');
  const u = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`;
  const response = await fetch(u, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'EXION/4.1' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}.`);
  const data = await response.json();
  return (data.items || []).map(r => ({ name: r.full_name, description: r.description, url: r.html_url, stars: r.stargazers_count, language: r.language, defaultBranch: r.default_branch }));
}

async function githubRepo({ owner, repo, path = '' }) {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner || '') || !/^[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('Repositório inválido.');
  if (path && !/^[A-Za-z0-9_./@+-]+$/.test(path)) throw new Error('Caminho inválido.');
  const u = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(u, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'EXION/4.1' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}.`);
  const data = await response.json();
  if (Array.isArray(data)) return data.map(x => ({ name: x.name, type: x.type, path: x.path, url: x.html_url }));
  return { name: data.name, path: data.path, url: data.html_url, download_url: data.download_url, content: data.encoding === 'base64' ? Buffer.from(data.content.replace(/\\n/g, ''), 'base64').toString('utf8').slice(0, 30000) : undefined };
}

const allowed = new Map([
  ['pwd', { args: [] }],
  ['ls', { args: [] }],
  ['node', { args: ['--version'] }],
  ['npm', { args: ['--version'] }],
  ['git', { args: ['--version'] }],
  ['whoami', { args: [] }],
  ['date', { args: [] }]
]);

function runTerminal({ command }) {
  if (typeof command !== 'string' || !/^[a-z0-9_-]+$/i.test(command)) throw new Error('Comando não permitido.');
  const spec = allowed.get(command);
  if (!spec) throw new Error(`Comando bloqueado. Permitidos: ${[...allowed.keys()].join(', ')}.`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, spec.args, { cwd: process.cwd(), shell: false, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Comando excedeu o tempo limite.')); }, COMMAND_TIMEOUT);
    child.stdout.on('data', x => out += x);
    child.stderr.on('data', x => err += x);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ command, code, stdout: out.slice(0, 5000), stderr: err.slice(0, 5000) }); });
  });
}


async function loadMemoryStore() {
  try { memoryStore = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8')); }
  catch { memoryStore = { users: {} }; }
  if (!memoryStore || typeof memoryStore !== 'object') memoryStore = { users: {} };
  if (!memoryStore.users || typeof memoryStore.users !== 'object') memoryStore.users = {};
}

function userBucket(clientId) {
  const id = String(clientId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default';
  if (!memoryStore.users[id]) memoryStore.users[id] = { memories: [], messages: [] };
  return memoryStore.users[id];
}

function persistMemoryStore() {
  memoryWrite = memoryWrite.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${MEMORY_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(memoryStore, null, 2), 'utf8');
    await fs.rename(tmp, MEMORY_FILE);
  }).catch(() => {});
  return memoryWrite;
}

function remember(clientId, { category = 'geral', content, importance = 3 }) {
  if (typeof content !== 'string' || content.trim().length < 3) throw new Error('Memória vazia.');
  const bucket = userBucket(clientId);
  const clean = content.trim().slice(0, 1200);
  const existing = bucket.memories.find(m => m.content.toLowerCase() === clean.toLowerCase());
  if (existing) { existing.updatedAt = new Date().toISOString(); existing.importance = Math.max(existing.importance || 1, Number(importance) || 1); }
  else bucket.memories.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, category: String(category).slice(0,40), content: clean, importance: Math.min(5, Math.max(1, Number(importance) || 3)), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  bucket.memories = bucket.memories.slice(-500);
  persistMemoryStore();
  return { saved: true, content: clean };
}

function searchMemories(clientId, query) {
  const bucket = userBucket(clientId);
  const words = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  return bucket.memories.map(m => {
    const text = m.content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');
    const score = words.reduce((n,w) => n + (text.includes(w) ? 1 : 0), 0) + ((m.importance || 1) * 0.15);
    return { ...m, score };
  }).filter(m => m.score > 0).sort((a,b) => b.score-a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map(({score,...m})=>m);
}

function storeMessages(clientId, messages) {
  const bucket = userBucket(clientId);
  for (const m of messages) {
    if (!m?.content) continue;
    bucket.messages.push({ role: m.role, content: String(m.content).slice(0, 12000), at: new Date().toISOString() });
  }
  bucket.messages = bucket.messages.slice(-MAX_STORED_MESSAGES);
  persistMemoryStore();
}


function parseDataImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Imagem inválida. Envie PNG, JPG/JPEG ou WebP.');
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 12 MB.');
  return { mime, buffer };
}


async function imageVision({ image, prompt }) {
  if (!OPENAI_API_KEY) throw new Error('Visão de imagens não está configurada. Configure OPENAI_API_KEY no .env.');
  if (typeof prompt !== 'string' || prompt.trim().length < 2) throw new Error('Diga o que você quer que a EXION observe ou explique na foto.');
  const { mime, buffer } = parseDataImage(image);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt.trim().slice(0, 4000) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }],
      max_tokens: 2000
    }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Servidor de visão HTTP ${response.status}.`);
  const reply = data.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('A visão não retornou uma descrição.');
  return { reply: reply.trim(), model: VISION_MODEL };
}

async function imageGenerate({ prompt, size = '1024x1024' }) {
  const apiUrl = IMAGE_API_URL || `${OPENAI_BASE_URL}/images/generations`;
  const apiKey = IMAGE_API_KEY || OPENAI_API_KEY;
  if (!apiKey) throw new Error('Criação de imagens não está configurada. Configure OPENAI_API_KEY ou IMAGE_API_KEY no .env.');
  if (typeof prompt !== 'string' || prompt.trim().length < 2) throw new Error('Descreva a imagem que você quer criar.');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: prompt.trim().slice(0, 6000), size }),
    signal: AbortSignal.timeout(180000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || `Servidor de imagens HTTP ${response.status}.`);
  const item = data.data?.[0];
  if (item?.b64_json) return { image: `data:image/png;base64,${item.b64_json}`, model: IMAGE_MODEL };
  if (item?.url) return { imageUrl: item.url, model: IMAGE_MODEL };
  throw new Error('O provedor não retornou a imagem criada.');
}

async function imageEdit({ image, prompt }) {
  const apiUrl = IMAGE_API_URL || `${OPENAI_BASE_URL}/images/edits`;
  const apiKey = IMAGE_API_KEY || OPENAI_API_KEY;
  if (!apiUrl || !apiKey) {
    throw new Error('Edição de imagens ainda não está configurada. Configure OPENAI_API_KEY ou IMAGE_API_KEY no .env.');
  }
  if (typeof prompt !== 'string' || prompt.trim().length < 2) throw new Error('Descreva o que deseja mudar na foto.');
  const { mime, buffer } = parseDataImage(image);
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', prompt.trim().slice(0, 4000));
  form.append('image', new Blob([buffer], { type: mime }), `exion-input.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`);
  form.append('size', 'auto');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${IMAGE_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || `Servidor de imagens HTTP ${response.status}.`);
  const item = data.data?.[0];
  if (item?.b64_json) return { image: `data:image/png;base64,${item.b64_json}`, provider: apiUrl, model: IMAGE_MODEL };
  if (item?.url) return { imageUrl: item.url, provider: apiUrl, model: IMAGE_MODEL };
  throw new Error('O provedor de imagens não retornou uma imagem editada.');
}


function nowInfo() {
  const now = new Date();
  return { iso: now.toISOString(), utc: now.toUTCString(), unix: now.getTime() };
}

function getConversationHistory(clientId, limit = 30) {
  const bucket = userBucket(clientId);
  const n = Math.min(100, Math.max(1, Number(limit) || 30));
  return bucket.messages.slice(-n);
}

const tools = [
  { type: 'function', function: { name: 'web_search', description: 'Pesquisar na web por informações atuais. Retorna títulos, URLs e trechos dos resultados.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'Ler uma página pública específica da internet.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'github_search', description: 'Pesquisar repositórios públicos no GitHub.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'github_repo', description: 'Consultar arquivos ou conteúdo de um repositório público do GitHub.', parameters: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' } }, required: ['owner', 'repo'] } } },
  { type: 'function', function: { name: 'remember', description: 'Guardar uma memória duradoura quando o usuário revelar uma preferência, objetivo, informação pessoal não sensível, decisão importante do projeto ou algo que possa ser útil no futuro. Não guarde senhas, chaves, dados financeiros ou informações sensíveis.', parameters: { type: 'object', properties: { category: { type: 'string' }, content: { type: 'string' }, importance: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['content'] } } },
  { type: 'function', function: { name: 'memory_search', description: 'Pesquisar memórias já salvas deste usuário para recuperar contexto relevante.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'conversation_history', description: 'Consultar mensagens antigas já arquivadas para recuperar contexto de uma conversa anterior.', parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } } },
  { type: 'function', function: { name: 'time_now', description: 'Obter data e hora atuais do servidor em UTC.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'terminal_run', description: 'Executar diagnósticos controlados no terminal do servidor. Comandos disponíveis: pwd, ls, node, npm, git, whoami e date. Não aceita argumentos arbitrários.', parameters: { type: 'object', properties: { command: { type: 'string', enum: [...allowed.keys()] } }, required: ['command'] } } }
];

async function executeTool(name, args, clientId) {
  if (name === 'web_search') return webSearch(args);
  if (name === 'web_fetch') return webFetch(args);
  if (name === 'github_search') return githubSearch(args);
  if (name === 'github_repo') return githubRepo(args);
  if (name === 'terminal_run') return runTerminal(args);
  if (name === 'remember') return remember(clientId, args);
  if (name === 'memory_search') return searchMemories(clientId, args.query);
  if (name === 'conversation_history') return getConversationHistory(clientId, args.limit);
  if (name === 'time_now') return nowInfo();
  throw new Error('Ferramenta desconhecida.');
}


function geminiToolDeclarations() {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    parametersJsonSchema: t.function.parameters
  }));
}

function geminiPartsFromMessages(messages) {
  const parts = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    parts.push({ text: `${m.role === 'assistant' ? 'EXION: ' : 'Usuário: '}${m.content}` });
  }
  return parts;
}

async function geminiChat(messages, clientId) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');
  const memories = searchMemories(clientId, messages.map(m => m.content).join(' '));
  const memoryText = memories.length ? `\nMemórias relevantes deste usuário/projeto:\n${memories.map(m => `- [${m.category}] ${m.content}`).join('\n')}` : '';
  const systemText = `Você é a EXION: um assistente multimodal inteligente, preciso, rápido e levemente descontraído. Responda em português quando o usuário falar português. Use ferramentas quando elas realmente melhorarem a resposta. Verifique informações atuais quando necessário. Para problemas complexos, planeje internamente, confira a resposta e entregue somente a conclusão e os passos úteis; nunca revele raciocínio interno privado. Não invente memórias, fontes, resultados de ferramentas ou ações executadas. Use memória somente quando relevante e não guarde segredos, senhas, chaves, dados financeiros ou informações sensíveis. Seja capaz de analisar texto, imagens, documentos e dados quando esses conteúdos forem fornecidos. ${memoryText}`;

  let contents = [{ role: 'user', parts: geminiPartsFromMessages(messages.slice(-16)) }];
  const toolList = [{ functionDeclarations: geminiToolDeclarations() }];
  if (GEMINI_ENABLE_SEARCH) toolList.push({ googleSearch: {} });
  if (GEMINI_ENABLE_URL_CONTEXT) toolList.push({ urlContext: {} });
  if (GEMINI_ENABLE_CODE_EXECUTION) toolList.push({ codeExecution: {} });

  for (let round = 0; round < 6; round++) {
    const body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      tools: toolList,
      generationConfig: {
        temperature: Math.max(0, Math.min(1, GEMINI_TEMPERATURE)),
        maxOutputTokens: GEMINI_MAX_OUTPUT,
        thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL }
      }
    };
    if (GEMINI_STRUCTURED_OUTPUT) {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseJsonSchema = {
        type: 'object',
        properties: { answer: { type: 'string' }, confidence: { type: 'number' } },
        required: ['answer']
      };
    }
    const response = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}.`);
    const candidate = data.candidates?.[0];
    const responseParts = candidate?.content?.parts || [];
    const calls = responseParts.filter(p => p.functionCall).map(p => p.functionCall);
    const text = responseParts.filter(p => typeof p.text === 'string').map(p => p.text).join(' ').trim();
    if (!calls.length) {
      if (GEMINI_STRUCTURED_OUTPUT && text) {
        try { return JSON.parse(text).answer || text; } catch { return text; }
      }
      return text || 'Não recebi conteúdo do modelo Gemini.';
    }
    contents.push(candidate.content);
    const functionResponses = [];
    for (const call of calls) {
      try {
        const result = await executeTool(call.name, call.args || {}, clientId);
        functionResponses.push({ functionResponse: { name: call.name, response: { result } } });
      } catch (e) {
        functionResponses.push({ functionResponse: { name: call.name, response: { error: e.message } } });
      }
    }
    contents.push({ role: 'user', parts: functionResponses });
  }
  throw new Error('Limite de chamadas de ferramentas Gemini atingido.');
}


function liveSystemInstruction(clientId) {
  const memories = searchMemories(clientId, '').slice(-12);
  const memoryText = memories.length
    ? `\nMemórias úteis deste usuário/projeto:\n${memories.map(m => `- [${m.category}] ${m.content}`).join('\n')}`
    : '';
  return `Você é a EXION, um assistente de voz inteligente e natural. Converse em português do Brasil quando o usuário falar português. Responda de forma curta e natural para voz, sem listas enormes quando uma frase ou poucas frases bastarem. Seja amigável, confiante e clara, com uma presença de assistente tecnológico. Não diga que é o JARVIS e não imite a voz de uma pessoa específica. Você pode ouvir interrupções do usuário: pare e preste atenção quando ele começar a falar. Nunca revele raciocínio interno privado. Não invente ações, memórias ou resultados. ${memoryText}`;
}

function createGeminiLiveSocket(clientId, onMessage, onClose, onError) {
  const upstreamUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const upstream = new WebSocket(upstreamUrl, {
    headers: { 'x-goog-api-key': GEMINI_API_KEY }
  });
  upstream.on('open', () => {
    const setup = {
      setup: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            languageCode: 'pt-BR',
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE } }
          }
        },
        systemInstruction: { parts: [{ text: liveSystemInstruction(clientId) }] },
        inputAudioTranscription: { },
        outputAudioTranscription: { },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            silenceDurationMs: 550
          }
        }
      }
    };
    upstream.send(JSON.stringify(setup));
    onMessage({ type: 'live_ready', model: GEMINI_LIVE_MODEL, voice: GEMINI_LIVE_VOICE });
  });
  upstream.on('message', data => onMessage(JSON.parse(data.toString())));
  upstream.on('close', (code, reason) => onClose(code, reason?.toString() || ''));
  upstream.on('error', onError);
  return upstream;
}

function installLiveVoiceWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || HOST}`);
      if (url.pathname !== '/api/live-voice') return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { socket.destroy(); }
  });

  wss.on('connection', ws => {
    let upstream = null;
    let authorizedLive = !ACCESS_PASSWORD;
    let clientId = 'default';
    let inputTranscript = '';
    let outputTranscript = '';

    const baseSend = payload => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    const forwardHandler = payload => {
      if (payload?.serverContent?.inputTranscription?.text) inputTranscript += payload.serverContent.inputTranscription.text;
      if (payload?.serverContent?.outputTranscription?.text) outputTranscript += payload.serverContent.outputTranscription.text;
      if (payload?.serverContent?.turnComplete) {
        const bucketMessages = [];
        if (inputTranscript.trim()) bucketMessages.push({ role: 'user', content: inputTranscript.trim() });
        if (outputTranscript.trim()) bucketMessages.push({ role: 'assistant', content: outputTranscript.trim() });
        if (bucketMessages.length) storeMessages(clientId, bucketMessages);
        inputTranscript = '';
        outputTranscript = '';
      }
    };

    const send = payload => { forwardHandler(payload); baseSend(payload); };

    const closeAll = () => {
      try { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    };

    const startUpstream = () => {
      if (!GEMINI_LIVE_ENABLED || !GEMINI_API_KEY || AI_PROVIDER !== 'gemini') {
        send({ type: 'error', error: 'O modo de voz em tempo real requer AI_PROVIDER=gemini, GEMINI_API_KEY e GEMINI_LIVE_ENABLED=true.' });
        return false;
      }
      if (upstream) return true;
      try {
        upstream = createGeminiLiveSocket(clientId, send, (code, reason) => {
          send({ type: 'live_closed', code, reason });
          try { ws.close(); } catch {}
        }, err => send({ type: 'error', error: `Gemini Live: ${err.message}` }));
        return true;
      } catch (e) {
        send({ type: 'error', error: e.message });
        return false;
      }
    };

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send({ type: 'error', error: 'Mensagem inválida.' }); }

      if (!authorizedLive) {
        if (msg.type !== 'auth') return send({ type: 'auth_required' });
        if (msg.password !== ACCESS_PASSWORD) {
          send({ type: 'error', error: 'Senha de acesso inválida.' });
          return closeAll();
        }
        authorizedLive = true;
        clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 100) : 'default';
        startUpstream();
        return;
      }

      if (msg.type === 'auth') {
        clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 100) : clientId;
        if (!startUpstream()) return;
        return;
      }

      if (!upstream) {
        if (!startUpstream()) return;
      }

      if (upstream.readyState !== WebSocket.OPEN) {
        return send({ type: 'error', error: 'A conexão de voz ainda está iniciando.' });
      }

      if (msg.type === 'audio') {
        const b64 = typeof msg.data === 'string' ? msg.data : '';
        if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 120000) return;
        upstream.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: b64 } } }));
        return;
      }
      if (msg.type === 'text') {
        const text = typeof msg.text === 'string' ? msg.text.slice(0, 8000) : '';
        if (!text) return;
        upstream.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
        return;
      }
      if (msg.type === 'activity_start') {
        upstream.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        return;
      }
      if (msg.type === 'activity_end') {
        upstream.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        return;
      }
      if (msg.type === 'close') return closeAll();
    });

    ws.on('close', () => {
      try { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
    });
  });
}

async function chat(messages, clientId) {
  if (AI_PROVIDER === 'gemini') return geminiChat(messages, clientId);
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY não configurada.');
  const memories = searchMemories(clientId, messages.map(m => m.content).join(' '));
  const memoryText = memories.length ? `\nMemórias relevantes deste usuário/projeto (use apenas quando realmente ajudarem):\n${memories.map(m => `- [${m.category}] ${m.content}`).join('\n')}` : '';
  const system = { role: 'system', content: `Você é a EXION V4: inteligente, rápida, clara e levemente descontraída, sem perder precisão. Responda em português quando o usuário falar português. Você tem acesso a pesquisa web, páginas públicas, GitHub público e terminal seguro. Use ferramentas quando necessário. Você também pode usar a ferramenta remember para guardar somente informações duradouras e úteis sobre o usuário ou projeto. Não guarde segredos, senhas, chaves, dados financeiros ou informações sensíveis. Se o usuário perguntar se você lembra de conversas anteriores, consulte as memórias e o contexto fornecido; seja honesta sobre o que realmente está disponível. Não invente lembranças. Não revele raciocínio interno privado. Você pode raciocinar internamente, mas entregue apenas conclusões, passos úteis, cálculos e verificações necessárias. Quando uma pergunta depender de informação atual, pesquise antes de afirmar. Quando houver fontes conflitantes, compare e deixe a incerteza clara. Use memória e histórico quando isso melhorar a resposta, sem inventar contexto. Para problemas complexos, divida a tarefa em etapas internamente e confira a resposta antes de enviar. Nunca diga que executou uma ação se a ferramenta não retornar sucesso. O terminal é limitado e não deve ser contornado. Seja objetiva para responder mais rápido, mas aprofunde quando a pergunta exigir.${memoryText}` };
  let current = [system, ...messages.slice(-12)];
  for (let round = 0; round < 4; round++) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': SITE_URL, 'X-Title': APP_NAME },
      body: JSON.stringify({ model: MODEL, messages: current, tools, tool_choice: 'auto', temperature: 0.3, max_tokens: 3000 }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `OpenRouter HTTP ${response.status}.`);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Resposta inválida do modelo.');
    if (!msg.tool_calls?.length) return msg.content || 'Não recebi conteúdo do modelo.';
    current.push(msg);
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { throw new Error('Argumentos de ferramenta inválidos.'); }
      try {
        const result = await executeTool(call.function.name, args, clientId);
        current.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, MAX_OUTPUT) });
      } catch (e) {
        current.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: e.message }) });
      }
    }
  }
  throw new Error('Limite de chamadas de ferramentas atingido.');
}


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.aab': 'application/octet-stream'
};

async function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const root = path.resolve(process.cwd());
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { return false; }
  const filePath = path.resolve(root, `.${decoded}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return false;
  let stat;
  try { stat = await fs.stat(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return true;
  const data = await fs.readFile(filePath);
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        configured: AI_PROVIDER === 'gemini' ? Boolean(GEMINI_API_KEY) : Boolean(API_KEY), passwordRequired: Boolean(ACCESS_PASSWORD), accessConfigured: Boolean(ACCESS_PASSWORD), model: AI_PROVIDER === 'gemini' ? GEMINI_MODEL : MODEL,
        provider: AI_PROVIDER,
        gemini: { thinkingLevel: GEMINI_THINKING_LEVEL, search: GEMINI_ENABLE_SEARCH, urlContext: GEMINI_ENABLE_URL_CONTEXT, codeExecution: GEMINI_ENABLE_CODE_EXECUTION, structuredOutput: GEMINI_STRUCTURED_OUTPUT, liveVoice: GEMINI_LIVE_ENABLED && Boolean(GEMINI_API_KEY), liveModel: GEMINI_LIVE_MODEL, liveVoiceName: GEMINI_LIVE_VOICE },
        tools: { webSearch: true, internet: true, github: true, terminal: true, memory: true, history: true, time: true, imageEdit: Boolean((IMAGE_API_URL && IMAGE_API_KEY) || (OPENAI_API_KEY && IMAGE_MODEL)), imageVision: Boolean(OPENAI_API_KEY), imageGenerate: Boolean((IMAGE_API_KEY || OPENAI_API_KEY) && IMAGE_MODEL) }
      });
    }
    if (!url.pathname.startsWith('/api/')) {
      if (await serveStatic(req, res, url.pathname)) return;
      return json(res, 404, { error: 'Página não encontrada.' });
    }
    if (!authorized(req)) return json(res, 401, { error: 'Senha de acesso inválida.' });
    if (url.pathname === '/api/memory' && req.method === 'GET') {
      const clientId = (url.searchParams.get('clientId') || 'default').slice(0, 100);
      const bucket = userBucket(clientId);
      return json(res, 200, { memories: bucket.memories.slice(-100), messages: bucket.messages.slice(-100) });
    }
    if (url.pathname === '/api/image-edit' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await imageEdit({ image: body.image, prompt: body.prompt });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/image-vision' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await imageVision({ image: body.image, prompt: body.prompt });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/image-generate' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await imageGenerate({ prompt: body.prompt, size: body.size });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 100) : 'default';
      const incoming = cleanMessages(body.messages);
      const reply = await chat(incoming, clientId);
      storeMessages(clientId, [...incoming.slice(-2), { role: 'assistant', content: reply }]);
      return json(res, 200, { reply, memories: searchMemories(clientId, incoming.map(m => m.content).join(' ')) });
    }
    return json(res, 404, { error: 'Endpoint não encontrado.' });
  } catch (error) {
    return json(res, 400, { error: error.message || 'Erro interno.' });
  }
});

await loadMemoryStore();
installLiveVoiceWebSocket(server);

server.listen(PORT, HOST, () => console.log(`EXION V4 backend em http://${HOST}:${PORT}`));
