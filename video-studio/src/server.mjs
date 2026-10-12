// Local web server for Video Studio: serves the browser UI from ../web and a small JSON API.
// It only answers requests addressed to localhost from its own pages, so other websites
// open in the same browser cannot start (paid) generations or change the token.

import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplicateClient } from './replicate.mjs';
import { buildInput, readInputSchema } from './inputs.mjs';
import { DEFAULT_PRESET, PRESETS, resolveModel } from './presets.mjs';
import { generateVideo } from './generate.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const MEDIA_TYPES = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
const MAX_BODY_BYTES = 25 * 1024 * 1024; // room for an uploaded start image
const MAX_PARALLEL = 3;
const MAX_COUNT = 4;
const FINISHED = new Set(['succeeded', 'failed', 'canceled']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SAFE_NAME = /^[\w.-]+$/;

async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Expected a JSON request');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large (is the image over 20 MB?)');
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// Saves or replaces REPLICATE_API_TOKEN in the .env file, keeping any other lines.
async function saveToken(envFile, token) {
  const existing = existsSync(envFile) ? await readFile(envFile, 'utf8') : '';
  const lines = existing.split(/\r?\n/).filter(l => l.trim() && !/^\s*REPLICATE_API_TOKEN\s*=/.test(l));
  lines.push(`REPLICATE_API_TOKEN=${token}`);
  await writeFile(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
}

async function serveFile(req, res, file, type) {
  const { size } = await stat(file);
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    // Browsers request byte ranges to seek inside videos.
    let start;
    let end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      start = Math.max(size - Number(range[2]), 0);
      end = size - 1;
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/**
 * Creates (but does not start) the HTTP server.
 * options: { token, envFile, outDir, fetch, sleep, now, timeoutMs }
 */
export function createStudioServer({ token, envFile, outDir, fetch = globalThis.fetch, sleep, now, timeoutMs = 15 * 60_000 }) {
  const makeClient = t => new ReplicateClient({ token: t, fetch, ...(sleep && { sleep }) });
  let client = token ? makeClient(token) : null;
  const schemas = new Map();
  const jobs = [];
  let nextJobId = 1;
  let running = 0;

  const requireClient = () => {
    if (!client) throw new HttpError(401, 'Add your Replicate API token first');
    return client;
  };

  async function getSchema(model) {
    if (!schemas.has(model)) schemas.set(model, readInputSchema(await requireClient().getSchema(model)));
    return schemas.get(model);
  }

  const publicJob = ({ id, prompt, model, status, error, files, variation, createdAt, startedAt, finishedAt }) =>
    ({ id, prompt, model, status, error, files, variation, createdAt, startedAt, finishedAt });

  async function runJob(job) {
    running++;
    job.status = 'starting';
    job.startedAt = Date.now();
    try {
      job.client = requireClient();
      const { files } = await generateVideo({
        client: job.client, model: job.model, job, outDir, fetch, now, timeoutMs,
        onPrediction: prediction => {
          job.prediction = prediction;
          if (job.cancelRequested) job.client.cancel(prediction).catch(() => {});
        },
        onStatus: status => {
          job.status = status;
        },
      });
      job.status = 'succeeded';
      job.files = files.map(f => path.basename(f));
    } catch (e) {
      job.status = job.cancelRequested ? 'canceled' : 'failed';
      if (!job.cancelRequested) job.error = e.message;
    } finally {
      running--;
      job.finishedAt = Date.now();
      pump();
    }
  }

  function pump() {
    while (running < MAX_PARALLEL) {
      const next = jobs.find(j => j.status === 'queued');
      if (!next) return;
      runJob(next);
    }
  }

  async function listVideos() {
    if (!existsSync(outDir)) return [];
    const names = await readdir(outDir);
    const videos = [];
    for (const name of names.filter(n => n.endsWith('.json'))) {
      try {
        const record = JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
        const files = (record.files ?? []).filter(f => SAFE_NAME.test(f) && existsSync(path.join(outDir, f)));
        if (!files.length) continue;
        const savedAt = record.saved_at ?? (await stat(path.join(outDir, name))).mtime.toISOString();
        videos.push({ id: name.slice(0, -5), prompt: record.prompt, model: record.model, input: record.input, savedAt, predictTime: record.predict_time_seconds, files });
      } catch {
        // Skip unreadable or unrelated JSON files.
      }
    }
    return videos.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  const routes = {
    'GET /api/status': () => ({
      hasToken: Boolean(client),
      defaultModel: DEFAULT_PRESET,
      presets: Object.entries(PRESETS).map(([name, p]) => ({ name, model: p.model, about: p.about })),
      outDir,
    }),

    'POST /api/token': async req => {
      const { token: newToken } = await readJson(req);
      const value = String(newToken ?? '').trim();
      if (!/^\S{8,}$/.test(value)) throw new HttpError(400, 'Paste the whole token (it starts with r8_)');
      const candidate = makeClient(value);
      await candidate.request('GET', '/account'); // throws a friendly 401 message if the token is wrong
      await saveToken(envFile, value);
      client = candidate;
      schemas.clear();
      return { ok: true };
    },

    'GET /api/schema': async (req, url) => {
      const model = resolveModel(url.searchParams.get('model') || DEFAULT_PRESET);
      const schema = await getSchema(model);
      return { model, ...schema };
    },

    'POST /api/generate': async req => {
      const body = await readJson(req);
      const prompt = String(body.prompt ?? '').trim();
      if (!prompt) throw new HttpError(400, 'Please write a prompt');
      const count = Number(body.count ?? 1);
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new HttpError(400, `Count must be 1 to ${MAX_COUNT}`);
      const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
      const model = resolveModel(String(body.model || DEFAULT_PRESET));
      const schema = await getSchema(model);

      // Validate every variation before anything is queued (and paid for).
      const created = [];
      const warnings = new Set();
      for (let i = 0; i < count; i++) {
        const set = { ...settings };
        if (count > 1 && set.seed !== undefined && set.seed !== '') set.seed = Number(set.seed) + i;
        let built;
        try {
          built = buildInput(schema, { prompt, set }, { flagHints: false });
        } catch (e) {
          throw new HttpError(400, e.message);
        }
        built.warnings.forEach(w => warnings.add(w));
        created.push({ id: String(nextJobId++), prompt, model, input: built.input, variation: count > 1 ? i + 1 : 0, status: 'queued', createdAt: Date.now() });
      }
      await mkdir(outDir, { recursive: true });
      jobs.push(...created);
      pump();
      return { jobs: created.map(publicJob), warnings: [...warnings] };
    },

    'GET /api/jobs': () => ({ jobs: jobs.map(publicJob) }),

    'GET /api/videos': async () => ({ videos: await listVideos() }),
  };

  const findJob = id => {
    const job = jobs.find(j => j.id === id);
    if (!job) throw new HttpError(404, 'Job not found');
    return job;
  };

  async function handleDynamic(req, url) {
    let m;
    if (req.method === 'POST' && (m = /^\/api\/jobs\/(\w+)\/cancel$/.exec(url.pathname))) {
      const job = findJob(m[1]);
      if (FINISHED.has(job.status)) return { job: publicJob(job) };
      job.cancelRequested = true;
      if (job.status === 'queued') {
        job.status = 'canceled';
        job.finishedAt = Date.now();
      } else if (job.prediction) {
        await job.client.cancel(job.prediction).catch(() => {});
      }
      return { job: publicJob(job) };
    }
    if (req.method === 'DELETE' && (m = /^\/api\/jobs\/(\w+)$/.exec(url.pathname))) {
      const job = findJob(m[1]);
      if (!FINISHED.has(job.status)) throw new HttpError(409, 'Cancel the job before removing it');
      jobs.splice(jobs.indexOf(job), 1);
      return { ok: true };
    }
    if (req.method === 'DELETE' && (m = /^\/api\/videos\/([^/]+)$/.exec(url.pathname))) {
      const id = decodeURIComponent(m[1]);
      const recordFile = path.join(outDir, `${id}.json`);
      if (!SAFE_NAME.test(id) || !existsSync(recordFile)) throw new HttpError(404, 'Video not found');
      const record = JSON.parse(await readFile(recordFile, 'utf8'));
      for (const f of record.files ?? []) {
        if (SAFE_NAME.test(f)) await rm(path.join(outDir, f), { force: true });
      }
      await rm(recordFile, { force: true });
      return { ok: true };
    }
    return undefined;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address()?.port;
      const host = req.headers.host ?? '';
      // Only answer requests addressed to this machine (blocks DNS-rebinding attacks).
      if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) {
        throw new HttpError(403, 'Forbidden host');
      }
      // Requests that change something must come from Video Studio's own page.
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== `http://${host}`) {
        throw new HttpError(403, 'Forbidden origin');
      }

      const url = new URL(req.url, `http://${host}`);
      const staticFile = req.method === 'GET' && STATIC_FILES[url.pathname];
      if (staticFile) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self'; script-src 'self'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return await serveFile(req, res, path.join(WEB_DIR, staticFile[0]), staticFile[1]);
      }

      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith('/videos/')) {
        const name = decodeURIComponent(url.pathname.slice('/videos/'.length));
        const type = MEDIA_TYPES[path.extname(name).toLowerCase()];
        const file = path.join(outDir, name);
        if (!SAFE_NAME.test(name) || !type || !existsSync(file)) throw new HttpError(404, 'Not found');
        return await serveFile(req, res, file, type);
      }

      const handler = routes[`${req.method} ${url.pathname}`];
      const result = handler ? await handler(req, url) : await handleDynamic(req, url);
      if (result === undefined) throw new HttpError(404, 'Not found');
      sendJson(res, 200, result);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      sendJson(res, e.status ?? 500, { error: e.message });
    }
  });

  return server;
}
