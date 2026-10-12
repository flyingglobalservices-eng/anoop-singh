import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, slugify } from '../src/cli.mjs';
import { captureOutput, fakeReplicate, KLING_SCHEMA } from './helpers.mjs';

const env = { REPLICATE_API_TOKEN: 'r8_test' };
const noSleep = async () => {};
const fixedNow = () => new Date('2026-10-12T09:30:05Z');

async function setup(apiOptions) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'vs-'));
  const api = fakeReplicate(apiOptions);
  const io = captureOutput();
  const go = argv => run(argv, { env, cwd, fetch: api.fetch, sleep: noSleep, now: fixedNow, log: io.log, error: io.error });
  return { cwd, api, io, go };
}

test('generates a video, downloads it and writes a JSON record', async () => {
  const { cwd, api, io, go } = await setup();
  const code = await go(['A drone shot over misty mountains', '-d', '10']);
  assert.equal(code, 0, io.errText());

  const create = api.calls.find(c => c.method === 'POST');
  assert.equal(create.url, 'https://api.replicate.com/v1/models/minimax/hailuo-02/predictions');
  assert.equal(create.headers.Authorization, 'Bearer r8_test');
  assert.deepEqual(create.body.input, { prompt: 'A drone shot over misty mountains', duration: 10, resolution: '1080p' });

  const files = (await readdir(path.join(cwd, 'videos'))).sort();
  assert.deepEqual(files, ['20261012-093005-a-drone-shot-over-misty-mountains.json', '20261012-093005-a-drone-shot-over-misty-mountains.mp4']);
  const video = await readFile(path.join(cwd, 'videos', files[1]), 'utf8');
  assert.equal(video, 'VIDEO:https://replicate.delivery/xyz/pred1/output.mp4');
  const record = JSON.parse(await readFile(path.join(cwd, 'videos', files[0]), 'utf8'));
  assert.equal(record.model, 'minimax/hailuo-02');
  assert.equal(record.predict_time_seconds, 42.5);
  assert.match(io.text(), /processing/);
  assert.match(io.text(), /✅ Saved/);
});

test('batch file plus --count makes variations with incrementing seeds', async () => {
  const { cwd, api, io, go } = await setup({ schema: { ...KLING_SCHEMA } });
  await writeFile(path.join(cwd, 'prompts.txt'), '# my ideas\nfirst idea\n\nsecond idea\n');
  await writeFile(path.join(cwd, 'face.png'), Buffer.from([1, 2, 3]));
  const code = await go(['-m', 'kling', '-f', 'prompts.txt', '-c', '2', '--seed', '100', '-i', 'face.png', '-o', 'out']);
  assert.equal(code, 0, io.errText());

  const inputs = api.calls.filter(c => c.method === 'POST').map(c => c.body.input);
  assert.equal(inputs.length, 4);
  assert.deepEqual(inputs.map(i => `${i.prompt}:${i.seed}`), ['first idea:100', 'first idea:101', 'second idea:100', 'second idea:101']);
  assert.equal(inputs[0].start_image, 'data:image/png;base64,AQID');
  assert.equal(inputs[0].mode, 'pro');
  const files = await readdir(path.join(cwd, 'out'));
  assert.equal(files.filter(f => f.endsWith('.mp4')).length, 4);
  assert.ok(files.includes('20261012-093005-second-idea-v2.mp4'));
  assert.match(io.text(), /Done: 4 of 4 succeeded/);
});

test('--dry-run validates inputs without creating predictions', async () => {
  const { api, io, go } = await setup();
  assert.equal(await go(['a cat', '--dry-run', '-r', '768p']), 0);
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 0);
  assert.match(io.text(), /"resolution": "768p"/);
});

test('invalid settings are rejected before anything is generated', async () => {
  const { api, io, go } = await setup();
  assert.equal(await go(['a cat', '-r', '4k']), 1);
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 0);
  assert.match(io.errText(), /Allowed: 512p, 768p, 1080p/);
});

test('reports a failed generation and exits with 1', async () => {
  const { io, go } = await setup({ finalStatus: 'failed' });
  assert.equal(await go(['a cat']), 1);
  assert.match(io.errText(), /Generation failed: NSFW content detected/);
});

test('times out and cancels a job that takes too long', async () => {
  const { api, io, go } = await setup({ pollsUntilDone: Infinity });
  let t = 0;
  const realNow = Date.now;
  Date.now = () => (t += 60_000);
  try {
    assert.equal(await go(['a cat', '--timeout', '2']), 1);
  } finally {
    Date.now = realNow;
  }
  assert.match(io.errText(), /Timed out after 2 min/);
  assert.ok(api.calls.some(c => c.url.endsWith('/cancel')));
});

test('friendly messages for missing token, bad token and missing prompt', async () => {
  const { cwd, api, io } = await setup({ error: { path: '/models/minimax/hailuo-02', status: 401, detail: 'Unauthenticated' } });
  const base = { cwd, fetch: api.fetch, sleep: noSleep, log: io.log, error: io.error };

  assert.equal(await run(['a cat'], { ...base, env: {} }), 1);
  assert.match(io.errText(), /No Replicate API token found/);

  await writeFile(path.join(cwd, '.env'), 'REPLICATE_API_TOKEN="r8_fromfile"\n');
  assert.equal(await run(['a cat'], { ...base, env: {} }), 1);
  assert.equal(api.calls.at(-1).headers.Authorization, 'Bearer r8_fromfile');
  assert.match(io.errText(), /TOKEN is missing or invalid/);

  assert.equal(await run([], { ...base, env }), 2);
  assert.match(io.errText(), /Please give a prompt/);
});

test('models, inputs and help commands', async () => {
  const { io, go } = await setup();
  assert.equal(await go(['models']), 0);
  assert.match(io.text(), /hailuo\s+minimax\/hailuo-02/);
  assert.equal(await go(['inputs', 'hailuo']), 0);
  assert.match(io.text(), /Settings for minimax\/hailuo-02/);
  assert.equal(await go(['--help']), 0);
  assert.match(io.text(), /Usage:/);
  assert.equal(await go(['--bogus']), 2);
});

test('slugify makes safe file names', () => {
  assert.equal(slugify('  Chai, poured in SLOW motion!! '), 'chai-poured-in-slow-motion');
  assert.equal(slugify('मौसम'), 'video');
  assert.equal(slugify('a'.repeat(39) + ' b c'), 'a'.repeat(39));
});
