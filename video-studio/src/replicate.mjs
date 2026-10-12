// Minimal Replicate HTTP API client (no dependencies, uses global fetch).
// Docs: https://replicate.com/docs/reference/http

const API = 'https://api.replicate.com/v1';
const DONE = new Set(['succeeded', 'failed', 'canceled']);

export class ReplicateError extends Error {
  constructor(status, detail) {
    super(explain(status, detail));
    this.status = status;
  }
}

function explain(status, detail) {
  const hints = {
    401: 'Your REPLICATE_API_TOKEN is missing or invalid. Create one at https://replicate.com/account/api-tokens',
    402: 'Your Replicate account needs credit. Add billing at https://replicate.com/account/billing',
    404: 'Model not found on Replicate. Check the name (run "video-studio models" for suggestions).',
    429: 'Replicate rate limit hit. Wait a minute or lower --count.',
  };
  if (hints[status]) return detail ? `${hints[status]} (${detail})` : hints[status];
  return `Replicate API error (HTTP ${status})${detail ? `: ${detail}` : ''}`;
}

// "owner/name" or "owner/name:version"
export function parseModelRef(ref) {
  const m = /^([\w.-]+)\/([\w.-]+)(?::([0-9a-f]{8,}))?$/i.exec(ref ?? '');
  if (!m) throw new Error(`Invalid model "${ref}". Use a preset name or "owner/model".`);
  return { owner: m[1], name: m[2], version: m[3] };
}

export class ReplicateClient {
  constructor({ token, fetch = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.token = token;
    this.fetch = fetch;
    this.sleep = sleep;
  }

  async request(method, url, body) {
    const res = await this.fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : data.title ?? (data.detail && JSON.stringify(data.detail));
      throw new ReplicateError(res.status, detail);
    }
    return data;
  }

  // Returns the OpenAPI schema describing the model's inputs.
  async getSchema(ref) {
    const { owner, name, version } = parseModelRef(ref);
    if (version) {
      const v = await this.request('GET', `/models/${owner}/${name}/versions/${version}`);
      return v.openapi_schema;
    }
    const model = await this.request('GET', `/models/${owner}/${name}`);
    if (!model.latest_version?.openapi_schema) {
      throw new Error(`Model "${ref}" has no published version to run.`);
    }
    return model.latest_version.openapi_schema;
  }

  createPrediction(ref, input) {
    const { owner, name, version } = parseModelRef(ref);
    return version
      ? this.request('POST', '/predictions', { version, input })
      : this.request('POST', `/models/${owner}/${name}/predictions`, { input });
  }

  cancel(prediction) {
    return this.request('POST', prediction.urls?.cancel ?? `/predictions/${prediction.id}/cancel`, {});
  }

  // Polls until the prediction finishes. onUpdate(prediction, elapsedMs) is called after each poll.
  async wait(prediction, { onUpdate, timeoutMs = 15 * 60_000, pollMs = 3000 } = {}) {
    const start = Date.now();
    let p = prediction;
    while (!DONE.has(p.status)) {
      if (Date.now() - start > timeoutMs) {
        await this.cancel(p).catch(() => {});
        throw new Error(`Timed out after ${Math.round(timeoutMs / 60000)} min; the job was canceled. Try --timeout with a bigger value.`);
      }
      await this.sleep(pollMs);
      p = await this.request('GET', p.urls?.get ?? `/predictions/${p.id}`);
      onUpdate?.(p, Date.now() - start);
    }
    if (p.status === 'failed') throw new Error(`Generation failed: ${p.error ?? 'unknown error'}`);
    if (p.status === 'canceled') throw new Error('Generation was canceled.');
    return p;
  }
}

// Replicate returns a URL, a list of URLs, or (rarely) an object of URLs.
export function outputUrls(output) {
  if (typeof output === 'string') return [output];
  if (Array.isArray(output)) return output.flatMap(outputUrls);
  if (output && typeof output === 'object') return Object.values(output).flatMap(outputUrls);
  return [];
}
