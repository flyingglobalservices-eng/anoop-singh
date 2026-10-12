// Turns the CLI's model-independent options (resolution, duration, ...) into the
// input names and values a specific Replicate model expects, using its OpenAPI schema.

// Each option maps to the first of these input names the model has.
const ALIASES = {
  prompt: ['prompt'],
  negative: ['negative_prompt'],
  resolution: ['resolution'],
  duration: ['duration', 'seconds'],
  aspect: ['aspect_ratio'],
  seed: ['seed'],
  image: ['image', 'start_image', 'first_frame_image', 'input_image'],
  fps: ['fps', 'frames_per_second'],
};

const OPTION_FLAGS = {
  prompt: 'prompt', negative: '--negative', resolution: '--resolution', duration: '--duration',
  aspect: '--aspect', seed: '--seed', image: '--image', fps: '--fps',
};

// Flattens the Input schema, following $ref/allOf so enums and types are visible on each property.
export function readInputSchema(openapi) {
  const schemas = openapi?.components?.schemas ?? {};
  const input = schemas.Input ?? {};
  const deref = ref => schemas[ref.split('/').pop()] ?? {};
  const properties = {};
  for (const [key, prop] of Object.entries(input.properties ?? {})) {
    const refs = [prop.$ref, ...(prop.allOf ?? []).map(a => a.$ref)].filter(Boolean);
    const merged = Object.assign({}, ...refs.map(deref), prop);
    delete merged.allOf;
    delete merged.$ref;
    properties[key] = merged;
  }
  return { properties, required: input.required ?? [] };
}

const height = v => parseInt(String(v), 10) || 0;

function coerce(key, raw, prop) {
  let value = raw;
  if (prop.type === 'integer') value = Number.parseInt(raw, 10);
  else if (prop.type === 'number') value = Number.parseFloat(raw);
  else if (prop.type === 'boolean') value = raw === true || /^(true|1|yes|on)$/i.test(String(raw));
  if ((prop.type === 'integer' || prop.type === 'number') && Number.isNaN(value)) {
    throw new Error(`"${key}" must be a number, got "${raw}"`);
  }

  if (!prop.enum) return { value };
  const exact = prop.enum.find(e => String(e).toLowerCase() === String(raw).toLowerCase());
  if (exact !== undefined) return { value: exact };
  // For numeric choices (e.g. duration 6 or 10), use the closest allowed value.
  if (prop.enum.every(e => typeof e === 'number') && !Number.isNaN(Number(raw))) {
    // On a tie, prefer the larger value (e.g. 8 s -> 10 s rather than 6 s).
    const dist = v => Math.abs(v - raw);
    const nearest = prop.enum.reduce((a, b) => (dist(b) < dist(a) || (dist(b) === dist(a) && b > a) ? b : a));
    return { value: nearest, warning: `${key}=${raw} is not available; using ${nearest} (allowed: ${prop.enum.join(', ')})` };
  }
  throw new Error(`"${raw}" is not a valid ${key} for this model. Allowed: ${prop.enum.join(', ')}`);
}

// options: { prompt, negative, resolution, duration, aspect, seed, image, fps, set: {key: rawValue} }
// Returns { input, warnings } or throws with a user-friendly message.
// flagHints: name the CLI flag that supplies a missing required input.
export function buildInput(schema, options, { flagHints = true } = {}) {
  const { properties, required } = schema;
  const input = {};
  const warnings = [];
  const assign = (key, raw) => {
    const { value, warning } = coerce(key, raw, properties[key]);
    input[key] = value;
    if (warning) warnings.push(warning);
  };

  for (const [option, names] of Object.entries(ALIASES)) {
    const raw = options[option];
    if (raw === undefined || raw === '') continue;
    const key = names.find(n => n in properties);
    if (key) {
      assign(key, raw);
    } else if (option === 'resolution' && properties.mode?.enum?.includes('pro')) {
      // Kling-style models pick resolution through a standard/pro mode.
      input.mode = height(raw) >= 1080 ? 'pro' : 'standard';
    } else {
      warnings.push(`This model has no ${option} setting, so ${OPTION_FLAGS[option]} was ignored`);
    }
  }

  // Default to the highest resolution the model offers.
  if (options.resolution === undefined) {
    const res = properties.resolution;
    if (res?.enum?.length) {
      input.resolution = [...res.enum].sort((a, b) => height(b) - height(a))[0];
    } else if (!res && properties.mode?.enum?.includes('pro')) {
      input.mode = 'pro';
    }
  }

  for (const [key, raw] of Object.entries(options.set ?? {})) {
    if (key in properties) {
      assign(key, raw);
    } else {
      warnings.push(`"${key}" is not a known input of this model; sending it anyway`);
      try {
        input[key] = JSON.parse(raw);
      } catch {
        input[key] = raw;
      }
    }
  }

  const missing = required.filter(k => !(k in input) && properties[k]?.default === undefined);
  if (missing.length) {
    const hint = k => {
      if (!flagHints) return k;
      const option = Object.keys(ALIASES).find(o => ALIASES[o].includes(k));
      return option ? `${k} (use ${OPTION_FLAGS[option]})` : `${k} (use --set ${k}=...)`;
    };
    throw new Error(`This model requires: ${missing.map(hint).join(', ')}`);
  }

  return { input, warnings };
}

// Human-readable list of a model's inputs, for "video-studio inputs <model>".
export function describeInputs(schema) {
  return Object.entries(schema.properties)
    .sort(([, a], [, b]) => (a['x-order'] ?? 0) - (b['x-order'] ?? 0))
    .map(([key, p]) => {
      const bits = [p.type ?? (p.enum ? 'choice' : 'value')];
      if (schema.required.includes(key)) bits.push('required');
      if (p.enum) bits.push(`one of: ${p.enum.join(', ')}`);
      if (p.minimum !== undefined || p.maximum !== undefined) bits.push(`range: ${p.minimum ?? ''}..${p.maximum ?? ''}`);
      if (p.default !== undefined) bits.push(`default: ${JSON.stringify(p.default)}`);
      const desc = p.description ? `\n      ${p.description}` : '';
      return `  ${key}  [${bits.join('; ')}]${desc}`;
    })
    .join('\n');
}
