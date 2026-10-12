import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ReplicateClient } from './replicate.mjs';
import { buildInput, describeInputs, readInputSchema } from './inputs.mjs';
import { DEFAULT_PRESET, PRESETS, resolveModel } from './presets.mjs';
import { generateVideo, shorten } from './generate.mjs';

export { slugify } from './generate.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PARALLEL = 3;

export const HELP = `video-studio: turn a text prompt into an HD video using AI models on Replicate

Usage:
  video-studio "<prompt>" [options]     Generate a video
  video-studio models                   List built-in model presets
  video-studio inputs [model]           Show every setting a model accepts

Options:
  -m, --model <name>        Preset (${Object.keys(PRESETS).join(', ')}) or any
                            Replicate model "owner/name". Default: ${DEFAULT_PRESET}
  -r, --resolution <res>    e.g. 1080p, 720p. Default: the model's highest
  -d, --duration <sec>      Video length in seconds (nearest allowed value is used)
  -a, --aspect <ratio>      e.g. 16:9, 9:16 (vertical/Reels), 1:1
  -n, --negative <text>     Things to avoid, e.g. "blurry, text, watermark"
  -i, --image <file|url>    Start frame: animate a photo (image-to-video)
      --seed <number>       Repeat a result exactly (same seed + same prompt)
      --fps <number>        Frames per second, if the model supports it
      --set <key=value>     Any other model setting (repeatable), see "inputs"
  -c, --count <n>           Make n variations of each prompt. Default: 1
  -f, --file <prompts.txt>  Batch mode: one prompt per line (# lines are skipped)
  -o, --out <folder>        Where to save videos. Default: ./videos
      --timeout <minutes>   Give up after this long per video. Default: 15
      --dry-run             Show what would be sent, without generating (no cost)
  -h, --help                Show this help

Setup: put REPLICATE_API_TOKEN=r8_... in video-studio/.env
       (get a token at https://replicate.com/account/api-tokens)

Examples:
  video-studio "A drone shot over misty Himalayan mountains at sunrise"
  video-studio "Chai being poured in slow motion" -m kling -d 10 -a 9:16
  video-studio "The person smiles and waves" -i photo.jpg -m hailuo
  video-studio -f prompts.txt -c 2 -o my-videos`;

const OPTIONS = {
  model: { type: 'string', short: 'm' },
  resolution: { type: 'string', short: 'r' },
  duration: { type: 'string', short: 'd' },
  aspect: { type: 'string', short: 'a' },
  negative: { type: 'string', short: 'n' },
  image: { type: 'string', short: 'i' },
  seed: { type: 'string' },
  fps: { type: 'string' },
  set: { type: 'string', multiple: true },
  count: { type: 'string', short: 'c' },
  file: { type: 'string', short: 'f' },
  out: { type: 'string', short: 'o' },
  timeout: { type: 'string' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

export async function loadToken(env, cwd) {
  if (env.REPLICATE_API_TOKEN) return env.REPLICATE_API_TOKEN.trim();
  for (const dir of [cwd, APP_DIR]) {
    const file = path.join(dir, '.env');
    if (!existsSync(file)) continue;
    const match = /^\s*REPLICATE_API_TOKEN\s*=\s*["']?([^"'\s#]+)/m.exec(await readFile(file, 'utf8'));
    if (match) return match[1];
  }
  return undefined;
}

async function toImageInput(image, cwd) {
  if (/^(https?:|data:)/.test(image)) return image;
  const file = path.resolve(cwd, image);
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`--image must be a .jpg, .png, .webp or .gif file (got "${image}")`);
  if (!existsSync(file)) throw new Error(`Image file not found: ${file}`);
  return `data:${type};base64,${(await readFile(file)).toString('base64')}`;
}

// Runs up to `limit` tasks at a time and returns their settled results in order.
async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Entry point. Returns a process exit code.
 * deps lets tests replace the network, clock and output streams.
 */
export async function run(argv, deps = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    fetch = globalThis.fetch,
    sleep,
    now = () => new Date(),
    log = msg => process.stdout.write(`${msg}\n`),
    error = msg => process.stderr.write(`${msg}\n`),
    onPrediction = () => {},
  } = deps;

  let args;
  try {
    args = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    error(`${e.message}\nRun "video-studio --help" for usage.`);
    return 2;
  }
  const { values: opts, positionals } = args;

  if (opts.help) {
    log(HELP);
    return 0;
  }

  if (positionals[0] === 'models' && positionals.length === 1) {
    log('Built-in presets (use with -m <name>):\n');
    for (const [name, p] of Object.entries(PRESETS)) {
      log(`  ${name.padEnd(10)} ${p.model.padEnd(28)} ${p.about}${name === DEFAULT_PRESET ? '  [default]' : ''}`);
    }
    log('\nAny other Replicate video model also works: -m owner/name');
    log('Browse more at https://replicate.com/collections/text-to-video');
    return 0;
  }

  try {
    const token = await loadToken(env, cwd);
    const needsApi = !(opts['dry-run'] && !token);
    if (!token && needsApi) {
      error('No Replicate API token found.\n' +
        '1. Create one at https://replicate.com/account/api-tokens\n' +
        `2. Save it in ${path.join(APP_DIR, '.env')} as: REPLICATE_API_TOKEN=r8_...\n` +
        '   (or set the REPLICATE_API_TOKEN environment variable)');
      return 1;
    }
    const client = new ReplicateClient({ token, fetch, ...(sleep && { sleep }) });

    if (positionals[0] === 'inputs' && positionals.length <= 2) {
      const model = resolveModel(positionals[1] ?? opts.model);
      const schema = readInputSchema(await client.getSchema(model));
      log(`Settings for ${model}:\n\n${describeInputs(schema)}\n\nPass any of these with --set key=value`);
      return 0;
    }

    const prompts = [];
    if (positionals.length) prompts.push(positionals.join(' ').trim());
    if (opts.file) {
      const text = await readFile(path.resolve(cwd, opts.file), 'utf8');
      prompts.push(...text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')));
    }
    if (!prompts.length || prompts.some(p => !p)) {
      error('Please give a prompt, e.g. video-studio "a cat surfing a wave at sunset"\nRun "video-studio --help" for all options.');
      return 2;
    }

    const count = opts.count === undefined ? 1 : Number(opts.count);
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--count must be a whole number from 1 to 20');
    const timeoutMin = opts.timeout === undefined ? 15 : Number(opts.timeout);
    if (!(timeoutMin > 0)) throw new Error('--timeout must be a positive number of minutes');
    if (opts.seed !== undefined && !/^\d+$/.test(opts.seed)) throw new Error('--seed must be a whole number');

    const set = {};
    for (const pair of opts.set ?? []) {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new Error(`--set needs key=value, got "${pair}"`);
      set[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
    }

    const model = resolveModel(opts.model);
    const image = opts.image && await toImageInput(opts.image, cwd);

    if (!token) {
      // Dry run without a token: we can't read the model's settings, so show the raw options.
      log(`Dry run (no token, so model settings were not checked). Model: ${model}`);
      prompts.forEach(p => log(JSON.stringify(shorten({ prompt: p, ...opts, image, set }), null, 2)));
      return 0;
    }

    const schema = readInputSchema(await client.getSchema(model));

    // Build and check every job's input before spending any money.
    const jobs = [];
    const warnings = new Set();
    for (const prompt of prompts) {
      for (let i = 0; i < count; i++) {
        const seed = opts.seed === undefined ? undefined : String(Number(opts.seed) + i);
        const built = buildInput(schema, { ...opts, prompt, image, seed, set });
        built.warnings.forEach(w => warnings.add(w));
        jobs.push({ prompt, variation: count > 1 ? i + 1 : 0, input: built.input });
      }
    }
    warnings.forEach(w => error(`⚠️  ${w}`));

    if (opts['dry-run']) {
      log(`Dry run: ${jobs.length} video(s) with ${model}. Nothing was generated.`);
      jobs.forEach((job, i) => log(`\n[${i + 1}] ${JSON.stringify(shorten(job.input), null, 2)}`));
      return 0;
    }

    const outDir = path.resolve(cwd, opts.out ?? 'videos');
    await mkdir(outDir, { recursive: true });
    log(`🎬 Generating ${jobs.length} video(s) with ${model}. This usually takes 1–10 minutes each.`);

    const tasks = jobs.map((job, index) => async () => {
      const label = jobs.length > 1 ? `[${index + 1}/${jobs.length}] ` : '';
      const { files: saved } = await generateVideo({
        client, model, job, outDir, fetch, now,
        timeoutMs: timeoutMin * 60_000,
        onPrediction: prediction => {
          onPrediction(client, prediction);
          log(`${label}Started (id ${prediction.id})`);
        },
        onStatus: (status, ms) => {
          if (ms !== undefined) log(`${label}${status} (${Math.round(ms / 1000)}s)`);
        },
      });
      saved.forEach(f => log(`${label}✅ Saved ${f}`));
      return saved;
    });

    const results = await runLimited(tasks, MAX_PARALLEL);
    const failed = results.filter(r => !r.ok);
    failed.forEach(r => error(`❌ ${r.error.message}`));
    if (jobs.length > 1) log(`\nDone: ${jobs.length - failed.length} of ${jobs.length} succeeded. Videos are in ${outDir}`);
    return failed.length ? 1 : 0;
  } catch (e) {
    error(`❌ ${e.message}`);
    return 1;
  }
}
