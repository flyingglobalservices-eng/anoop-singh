import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInput, describeInputs, readInputSchema } from '../src/inputs.mjs';
import { parseModelRef, outputUrls } from '../src/replicate.mjs';
import { resolveModel } from '../src/presets.mjs';
import { HAILUO_SCHEMA, KLING_SCHEMA } from './helpers.mjs';

const hailuo = readInputSchema(HAILUO_SCHEMA);
const kling = readInputSchema(KLING_SCHEMA);

test('readInputSchema follows $ref/allOf to find enums and types', () => {
  assert.deepEqual(hailuo.properties.resolution.enum, ['512p', '768p', '1080p']);
  assert.equal(hailuo.properties.duration.type, 'integer');
  assert.equal(hailuo.properties.resolution.default, '768p');
  assert.deepEqual(hailuo.required, ['prompt']);
});

test('defaults to the highest resolution the model offers', () => {
  const { input, warnings } = buildInput(hailuo, { prompt: 'a cat' });
  assert.deepEqual(input, { prompt: 'a cat', resolution: '1080p' });
  assert.deepEqual(warnings, []);
});

test('maps generic options to model-specific input names and types', () => {
  const { input } = buildInput(hailuo, { prompt: 'a cat', duration: '10', resolution: '768P', image: 'https://x/y.png' });
  assert.deepEqual(input, { prompt: 'a cat', duration: 10, resolution: '768p', first_frame_image: 'https://x/y.png' });
});

test('snaps a numeric option to the nearest allowed value with a warning', () => {
  const { input, warnings } = buildInput(hailuo, { prompt: 'a cat', duration: '8' });
  assert.equal(input.duration, 10);
  assert.match(warnings[0], /duration=8 is not available; using 10/);
});

test('rejects an invalid choice and lists the allowed ones', () => {
  assert.throws(() => buildInput(hailuo, { prompt: 'a cat', resolution: '4k' }), /Allowed: 512p, 768p, 1080p/);
});

test('warns about options the model does not support', () => {
  const { input, warnings } = buildInput(hailuo, { prompt: 'a cat', aspect: '9:16', negative: 'blur' });
  assert.ok(!('aspect_ratio' in input));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /no negative setting/);
});

test('uses mode=pro/standard for Kling-style models', () => {
  const base = { prompt: 'p', image: 'https://x/a.jpg' };
  assert.equal(buildInput(kling, base).input.mode, 'pro');
  assert.equal(buildInput(kling, { ...base, resolution: '720p' }).input.mode, 'standard');
  const { input } = buildInput(kling, { ...base, negative: 'text', seed: '7', aspect: '9:16', duration: '10' });
  assert.deepEqual(input, { prompt: 'p', negative_prompt: 'text', start_image: 'https://x/a.jpg', aspect_ratio: '9:16', seed: 7, duration: 10, mode: 'pro' });
});

test('explains which flag provides a missing required input', () => {
  assert.throws(() => buildInput(kling, { prompt: 'p' }), /requires: start_image \(use --image\)/);
});

test('--set coerces known inputs and passes unknown ones through', () => {
  const { input, warnings } = buildInput(hailuo, { prompt: 'p', set: { prompt_optimizer: 'false', extra: '{"a":1}', label: 'hi' } });
  assert.equal(input.prompt_optimizer, false);
  assert.deepEqual(input.extra, { a: 1 });
  assert.equal(input.label, 'hi');
  assert.equal(warnings.length, 2);
});

test('describeInputs lists settings in model order', () => {
  const text = describeInputs(hailuo);
  assert.ok(text.indexOf('prompt  [string; required]') < text.indexOf('resolution'));
  assert.match(text, /one of: 512p, 768p, 1080p; default: "768p"/);
});

test('model references and presets', () => {
  assert.deepEqual(parseModelRef('owner/name'), { owner: 'owner', name: 'name', version: undefined });
  assert.equal(parseModelRef('a/b:0123456789abcdef').version, '0123456789abcdef');
  assert.throws(() => parseModelRef('nonsense'), /Invalid model/);
  assert.equal(resolveModel('KLING'), 'kwaivgi/kling-v2.1-master');
  assert.equal(resolveModel('someone/model'), 'someone/model');
});

test('outputUrls handles string, list and object outputs', () => {
  assert.deepEqual(outputUrls('u1'), ['u1']);
  assert.deepEqual(outputUrls(['u1', 'u2']), ['u1', 'u2']);
  assert.deepEqual(outputUrls({ video: 'u1' }), ['u1']);
  assert.deepEqual(outputUrls(null), []);
});
