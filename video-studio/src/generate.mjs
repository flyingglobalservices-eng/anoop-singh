import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { outputUrls } from './replicate.mjs';

export const slugify = text =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'video';

const timestamp = date => date.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');

const extensionOf = url => {
  const ext = path.extname(new URL(url).pathname);
  return /^\.\w{2,5}$/.test(ext) ? ext : '.mp4';
};

// Replaces long data: URIs (uploaded images) so records and logs stay readable.
export const shorten = input =>
  Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('data:') ? `${v.slice(0, 30)}…` : v]));

/**
 * Runs one prediction to completion, downloads its output into outDir and writes a
 * JSON record next to it. Returns { base, files, record }.
 *
 * job: { prompt, input, variation }  (variation > 0 adds a "-vN" suffix)
 * hooks: onPrediction(prediction) once created, onStatus(status, elapsedMs) on each later status change,
 * and onStatus('downloading') with no elapsed time while the files are fetched.
 */
export async function generateVideo({ client, model, job, outDir, fetch = globalThis.fetch, now = () => new Date(), timeoutMs, onPrediction, onStatus }) {
  let prediction = await client.createPrediction(model, job.input);
  onPrediction?.(prediction);
  let lastStatus = prediction.status;
  prediction = await client.wait(prediction, {
    timeoutMs,
    onUpdate: (p, ms) => {
      if (p.status !== lastStatus) {
        lastStatus = p.status;
        onStatus?.(p.status, ms);
      }
    },
  });

  const urls = outputUrls(prediction.output);
  if (!urls.length) throw new Error('The model finished but returned no video.');
  onStatus?.('downloading');
  const savedAt = now();
  const base = `${timestamp(savedAt)}-${slugify(job.prompt)}${job.variation ? `-v${job.variation}` : ''}`;
  const files = [];
  for (const [i, url] of urls.entries()) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download the video (HTTP ${res.status}): ${url}`);
    const file = path.join(outDir, `${base}${urls.length > 1 ? `-${i + 1}` : ''}${extensionOf(url)}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    files.push(file);
  }
  const record = {
    prompt: job.prompt,
    model,
    input: shorten(job.input),
    prediction_id: prediction.id,
    created_at: prediction.created_at,
    saved_at: savedAt.toISOString(),
    predict_time_seconds: prediction.metrics?.predict_time,
    files: files.map(f => path.basename(f)),
  };
  await writeFile(path.join(outDir, `${base}.json`), JSON.stringify(record, null, 2));
  return { base, files, record };
}
