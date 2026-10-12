// A Hailuo-like schema in the shape Replicate publishes (enums behind allOf/$ref).
export const HAILUO_SCHEMA = {
  components: {
    schemas: {
      Input: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', 'x-order': 0, description: 'Text prompt for generation' },
          duration: { allOf: [{ $ref: '#/components/schemas/duration' }], default: 6, 'x-order': 1 },
          resolution: { allOf: [{ $ref: '#/components/schemas/resolution' }], default: '768p', 'x-order': 2 },
          prompt_optimizer: { type: 'boolean', default: true, 'x-order': 3 },
          first_frame_image: { type: 'string', format: 'uri', 'x-order': 4 },
        },
      },
      duration: { type: 'integer', enum: [6, 10] },
      resolution: { type: 'string', enum: ['512p', '768p', '1080p'] },
    },
  },
};

// A Kling-like schema: resolution chosen through mode, image required.
export const KLING_SCHEMA = {
  components: {
    schemas: {
      Input: {
        type: 'object',
        required: ['prompt', 'start_image'],
        properties: {
          prompt: { type: 'string' },
          negative_prompt: { type: 'string', default: '' },
          start_image: { type: 'string', format: 'uri' },
          mode: { allOf: [{ $ref: '#/components/schemas/mode' }], default: 'standard' },
          duration: { allOf: [{ $ref: '#/components/schemas/duration' }], default: 5 },
          aspect_ratio: { allOf: [{ $ref: '#/components/schemas/aspect_ratio' }], default: '16:9' },
          seed: { type: 'integer' },
        },
      },
      mode: { type: 'string', enum: ['standard', 'pro'] },
      duration: { type: 'integer', enum: [5, 10] },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
    },
  },
};

const json = (status, body) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new ArrayBuffer(0),
});

// Simulated Replicate API. Records every request in `calls`.
export function fakeReplicate({ schema = HAILUO_SCHEMA, pollsUntilDone = 2, finalStatus = 'succeeded', error, output } = {}) {
  const calls = [];
  const predictions = new Map();
  let nextId = 1;
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body && JSON.parse(init.body), headers: init.headers });
    if (url.startsWith('https://replicate.delivery/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`VIDEO:${url}`).buffer };
    }
    const path = url.replace('https://api.replicate.com/v1', '');
    if (error && path === error.path) return json(error.status, { detail: error.detail });

    if (method === 'GET' && path === '/account') return json(200, { username: 'tester' });
    let m;
    if (method === 'GET' && (m = /^\/models\/([^/]+)\/([^/]+)$/.exec(path))) {
      return json(200, { owner: m[1], name: m[2], latest_version: { id: 'abc123', openapi_schema: schema } });
    }
    if (method === 'POST' && /^\/models\/[^/]+\/[^/]+\/predictions$/.test(path)) {
      const id = `pred${nextId++}`;
      const p = { id, status: 'starting', polls: 0, input: JSON.parse(init.body).input,
        urls: { get: `https://api.replicate.com/v1/predictions/${id}`, cancel: `https://api.replicate.com/v1/predictions/${id}/cancel` } };
      predictions.set(id, p);
      return json(201, p);
    }
    if (method === 'GET' && (m = /^\/predictions\/(\w+)$/.exec(path))) {
      const p = predictions.get(m[1]);
      if (p.status === 'canceled') return json(200, p);
      p.polls++;
      if (p.polls >= pollsUntilDone) {
        p.status = finalStatus;
        if (finalStatus === 'succeeded') p.output = output ?? `https://replicate.delivery/xyz/${p.id}/output.mp4`;
        if (finalStatus === 'failed') p.error = 'NSFW content detected';
        p.metrics = { predict_time: 42.5 };
      } else {
        p.status = 'processing';
      }
      return json(200, p);
    }
    if (method === 'POST' && (m = /^\/predictions\/(\w+)\/cancel$/.exec(path))) {
      predictions.get(m[1]).status = 'canceled';
      return json(200, predictions.get(m[1]));
    }
    return json(404, { detail: `no route ${method} ${path}` });
  };
  return { fetch, calls, predictions };
}

export function captureOutput() {
  const out = [];
  const err = [];
  return { out, err, log: m => out.push(m), error: m => err.push(m), text: () => out.join('\n'), errText: () => err.join('\n') };
}
