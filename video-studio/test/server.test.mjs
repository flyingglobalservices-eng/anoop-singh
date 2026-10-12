import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStudioServer } from '../src/server.mjs';
import { fakeReplicate, KLING_SCHEMA } from './helpers.mjs';

async function start({ token = 'r8_test', api = fakeReplicate() } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vs-web-'));
  const envFile = path.join(dir, '.env');
  const outDir = path.join(dir, 'videos');
  const server = createStudioServer({
    token, envFile, outDir, fetch: api.fetch,
    sleep: () => new Promise(r => setTimeout(r, 5)),
    now: () => new Date('2026-10-12T09:30:05Z'),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;

  // Plain node:http so tests control Host/Origin exactly as a browser would send them.
  const call = (method, urlPath, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: {
        host,
        ...(method !== 'GET' && { origin: `http://${host}` }),
        ...(payload && { 'content-type': 'application/json' }),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });

  const waitForJobs = async () => {
    for (let i = 0; i < 400; i++) {
      const { json } = await call('GET', '/api/jobs');
      if (json.jobs.every(j => ['succeeded', 'failed', 'canceled'].includes(j.status))) return json.jobs;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('jobs did not finish');
  };

  return { server, call, api, envFile, outDir, waitForJobs, close: () => { server.closeAllConnections(); server.close(); } };
}

test('generates videos, lists them, streams with ranges and deletes them', async t => {
  const s = await start();
  t.after(s.close);

  const status = await s.call('GET', '/api/status');
  assert.equal(status.json.hasToken, true);
  assert.equal(status.json.defaultModel, 'hailuo');

  const schema = await s.call('GET', '/api/schema?model=hailuo');
  assert.equal(schema.json.model, 'minimax/hailuo-02');
  assert.deepEqual(schema.json.properties.resolution.enum, ['512p', '768p', '1080p']);

  const gen = await s.call('POST', '/api/generate', {
    body: { model: 'minimax/hailuo-02', prompt: 'A paper boat in the rain', count: 2, settings: { duration: 10, seed: 5 } },
  });
  assert.equal(gen.status, 200, gen.text);
  assert.equal(gen.json.jobs.length, 2);

  const jobs = await s.waitForJobs();
  assert.deepEqual(jobs.map(j => j.status), ['succeeded', 'succeeded']);
  const inputs = s.api.calls.filter(c => c.method === 'POST').map(c => c.body.input);
  assert.deepEqual(inputs.map(i => [i.seed, i.duration, i.resolution]), [[5, 10, '1080p'], [6, 10, '1080p']]);

  const { json: { videos } } = await s.call('GET', '/api/videos');
  assert.equal(videos.length, 2);
  assert.equal(videos[0].prompt, 'A paper boat in the rain');
  const file = videos.find(v => v.id.endsWith('-v1')).files[0];
  assert.equal(file, '20261012-093005-a-paper-boat-in-the-rain-v1.mp4');

  const full = await s.call('GET', `/videos/${file}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.match(full.text, /^VIDEO:/);
  const part = await s.call('GET', `/videos/${file}`, { headers: { range: 'bytes=0-4' } });
  assert.equal(part.status, 206);
  assert.equal(part.text, 'VIDEO');
  assert.match(part.headers['content-range'], /^bytes 0-4\/\d+$/);
  const tail = await s.call('GET', `/videos/${file}`, { headers: { range: 'bytes=-3' } });
  assert.equal(tail.text, full.text.slice(-3));
  assert.equal((await s.call('GET', `/videos/${file}`, { headers: { range: 'bytes=9999-' } })).status, 416);

  assert.equal((await s.call('DELETE', `/api/jobs/${jobs[0].id}`)).status, 200);
  assert.equal((await s.call('DELETE', `/api/videos/${videos[0].id}`)).status, 200);
  assert.equal((await s.call('GET', '/api/videos')).json.videos.length, 1);
});

test('rejects invalid settings before creating any prediction', async t => {
  const s = await start({ api: fakeReplicate({ schema: KLING_SCHEMA }) });
  t.after(s.close);

  const bad = await s.call('POST', '/api/generate', { body: { model: 'kling', prompt: 'x', settings: { start_image: 'data:image/png;base64,AA', aspect_ratio: '4:3' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Allowed: 16:9, 9:16, 1:1/);

  const missing = await s.call('POST', '/api/generate', { body: { model: 'kling', prompt: 'x' } });
  assert.equal(missing.json.error, 'This model requires: start_image');

  assert.equal((await s.call('POST', '/api/generate', { body: { prompt: '  ' } })).json.error, 'Please write a prompt');
  assert.equal((await s.call('POST', '/api/generate', { body: { prompt: 'x', count: 9 } })).status, 400);
  assert.equal(s.api.calls.filter(c => c.method === 'POST').length, 0);
});

test('cancels a running job on Replicate', async t => {
  const s = await start({ api: fakeReplicate({ pollsUntilDone: Infinity }) });
  t.after(s.close);
  const { json } = await s.call('POST', '/api/generate', { body: { prompt: 'slow one' } });
  const id = json.jobs[0].id;
  for (let i = 0; i < 100 && !s.api.predictions.size; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await s.call('POST', `/api/jobs/${id}/cancel`)).status, 200);
  const jobs = await s.waitForJobs();
  assert.equal(jobs[0].status, 'canceled');
  assert.ok(s.api.calls.some(c => c.url.endsWith('/cancel')));
});

test('saves a verified token and enables generation', async t => {
  const s = await start({ token: '' });
  t.after(s.close);
  assert.equal((await s.call('GET', '/api/status')).json.hasToken, false);
  assert.equal((await s.call('GET', '/api/schema')).status, 401);
  await writeFile(s.envFile, 'OTHER=1\nREPLICATE_API_TOKEN=old\n');

  assert.equal((await s.call('POST', '/api/token', { body: { token: 'short' } })).status, 400);
  const ok = await s.call('POST', '/api/token', { body: { token: ' r8_newtoken123 ' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(await readFile(s.envFile, 'utf8'), 'OTHER=1\nREPLICATE_API_TOKEN=r8_newtoken123\n');
  assert.equal(s.api.calls.at(-1).headers.Authorization, 'Bearer r8_newtoken123');
  assert.equal((await s.call('GET', '/api/status')).json.hasToken, true);
});

test('blocks other hosts, other origins and non-JSON writes', async t => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.call('GET', '/api/status', { headers: { host: 'evil.example:80' } })).status, 403);
  const body = { prompt: 'x' };
  assert.equal((await s.call('POST', '/api/generate', { body, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('POST', '/api/generate', { body, headers: { origin: '' } })).status, 403);
  assert.equal((await s.call('POST', '/api/generate', { body, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal(s.api.calls.filter(c => c.method === 'POST').length, 0);
});

test('serves the UI with a strict CSP and refuses path tricks', async t => {
  const s = await start();
  t.after(s.close);
  const page = await s.call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Video Studio<\/title>/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal((await s.call('GET', '/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await s.call('GET', '/videos/..%2F.env')).status, 404);
  assert.equal((await s.call('GET', '/videos/notes.txt')).status, 404);
  assert.equal((await s.call('DELETE', '/api/videos/..%2Fx')).status, 404);
  assert.equal((await s.call('GET', '/nope')).status, 404);
});
