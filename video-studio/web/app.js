// Video Studio browser UI. Talks to the local server in src/server.mjs.

const $ = id => document.getElementById(id);
const CUSTOM = '__custom';
const MAIN_KEYS = new Set(['resolution', 'duration', 'aspect_ratio', 'mode', 'negative_prompt', 'generate_audio', 'camera_fixed']);
const ACTIVE = new Set(['queued', 'starting', 'processing', 'downloading']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const STATUS_LABELS = {
  queued: 'Waiting in line',
  starting: 'Starting the model',
  processing: 'Generating',
  downloading: 'Saving to your computer',
  canceled: 'Canceled',
};

const state = {
  status: null,
  schema: null,
  model: null,
  controls: {},
  uploads: {},
  jobs: [],
  timer: null,
  tick: 0,
  notifiedFailures: new Set(),
};

// ---------- helpers ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c);
  return node;
}

const humanize = key => key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const height = v => parseInt(String(v), 10) || 0;
const elapsed = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function toast(message, kind = 'ok') {
  const t = el('div', { class: `toast ${kind}`, role: 'status' }, message);
  $('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4500);
}

function showMessages(errors = [], warnings = []) {
  const box = $('form-messages');
  box.replaceChildren(
    ...errors.map(m => el('p', { class: 'alert error' }, m)),
    ...warnings.map(m => el('p', { class: 'alert warn' }, m)),
  );
}

// ---------- setup / token ----------

async function loadStatus() {
  state.status = await api('GET', '/api/status');
  const connected = state.status.hasToken;
  $('setup').hidden = connected;
  $('studio').hidden = !connected;
  $('connection').hidden = !connected;
  $('connection').textContent = 'Connected to Replicate';
  $('connection').title = 'Change API token';
}

$('token-form').addEventListener('submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('token-error').hidden = true;
  try {
    await api('POST', '/api/token', { token: $('token').value });
    $('token').value = '';
    const firstTime = !$('model').options.length;
    await loadStatus();
    if (firstTime) await initStudio();
    else await loadModel(currentModelRef());
    toast('Connected to Replicate');
  } catch (err) {
    $('token-error').textContent = err.message;
    $('token-error').hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('connection').addEventListener('click', () => {
  $('setup').hidden = !$('setup').hidden;
  if (!$('setup').hidden) $('token').focus();
});

// ---------- model + settings ----------

function currentModelRef() {
  return $('model').value === CUSTOM ? $('custom-model').value.trim() : $('model').value;
}

function presetFor(ref) {
  return state.status.presets.find(p => p.name === ref || p.model === ref);
}

function populateModels() {
  const select = $('model');
  select.replaceChildren(
    ...state.status.presets.map(p => el('option', { value: p.name }, `${p.about.split(':')[0]}${p.name === state.status.defaultModel ? ' (default)' : ''}`)),
    el('option', { value: CUSTOM }, 'Other Replicate model…'),
  );
  const saved = store.get('vs-model');
  if (saved && presetFor(saved)) select.value = presetFor(saved).name;
  else if (saved?.includes('/')) {
    select.value = CUSTOM;
    $('custom-model').value = saved;
  } else select.value = state.status.defaultModel;
}

function updateModelAbout() {
  const custom = $('model').value === CUSTOM;
  $('custom-model-row').hidden = !custom;
  const preset = presetFor($('model').value);
  $('model-about').textContent = preset ? preset.about.split(': ').slice(1).join(': ') : 'Any text-to-video model from replicate.com, e.g. owner/model-name';
}

$('model').addEventListener('change', () => {
  updateModelAbout();
  if ($('model').value === CUSTOM) {
    $('custom-model').focus();
    if ($('custom-model').value.trim()) loadModel(currentModelRef());
  } else {
    loadModel($('model').value);
  }
});
$('load-model').addEventListener('click', () => loadModel(currentModelRef()));
$('custom-model').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadModel(currentModelRef());
  }
});

async function loadModel(ref) {
  state.schema = null;
  state.controls = {};
  state.uploads = {};
  $('uploads').replaceChildren();
  $('main-settings').replaceChildren();
  $('advanced-settings').replaceChildren();
  $('advanced').hidden = true;
  $('generate').disabled = true;
  showMessages();
  if (!ref) {
    $('settings-status').textContent = 'Type a model name like owner/model-name, then press Load.';
    return;
  }
  $('settings-status').textContent = 'Loading model settings…';
  try {
    const schema = await api('GET', `/api/schema?model=${encodeURIComponent(ref)}`);
    if (currentModelRef() !== ref) return; // the user picked another model meanwhile
    state.schema = schema;
    state.model = schema.model;
    store.set('vs-model', ref);
    renderSettings(schema);
    $('settings-status').textContent = '';
    $('generate').disabled = false;
  } catch (err) {
    $('settings-status').textContent = '';
    showMessages([err.message]);
  }
}

function renderSettings(schema) {
  const entries = Object.entries(schema.properties)
    .filter(([key]) => key !== 'prompt')
    .sort(([, a], [, b]) => (a['x-order'] ?? 0) - (b['x-order'] ?? 0));
  const required = new Set(schema.required);

  for (const [key, prop] of entries) {
    if (prop.type === 'string' && prop.format === 'uri') {
      $('uploads').append(makeUpload(key, prop, required.has(key)));
      continue;
    }
    if (prop.type === 'array' || prop.type === 'object') continue;
    const control = makeControl(key, prop, required.has(key));
    if (!control) continue;
    (MAIN_KEYS.has(key) ? $('main-settings') : $('advanced-settings')).append(control);
  }
  $('advanced').hidden = !$('advanced-settings').children.length;
}

function labelFor(key, prop, isRequired, forId) {
  return el('label', { class: 'label', for: forId }, humanize(key), isRequired ? el('span', { class: 'req' }, ' *') : null);
}

function makeControl(key, prop, isRequired) {
  const id = `set-${key}`;
  const help = prop.description ? el('span', { class: 'help' }, prop.description) : null;
  const props = state.schema.properties;

  if (prop.enum) {
    const select = el('select', { id }, prop.enum.map(v => el('option', { value: String(v) }, String(v))));
    let initial = prop.default;
    // HD by default: the highest resolution, or "pro" mode on models without a resolution choice.
    if (key === 'resolution') initial = [...prop.enum].sort((a, b) => height(b) - height(a))[0];
    if (key === 'mode' && !props.resolution && prop.enum.includes('pro')) initial = 'pro';
    if (initial !== undefined) select.value = String(initial);
    const numeric = prop.enum.every(v => typeof v === 'number');
    state.controls[key] = {
      read: () => (select.value === String(prop.default) ? undefined : numeric ? Number(select.value) : select.value),
      write: v => { select.value = String(v); },
    };
    return el('div', { class: 'field' }, labelFor(key, prop, isRequired, id), select, help);
  }

  if (prop.type === 'boolean') {
    const box = el('input', { id, type: 'checkbox' });
    box.checked = Boolean(prop.default);
    state.controls[key] = {
      read: () => (box.checked === Boolean(prop.default) ? undefined : box.checked),
      write: v => { box.checked = Boolean(v); },
    };
    return el('div', { class: 'field' }, el('label', { class: 'toggle', for: id }, box, humanize(key)), help);
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    const input = el('input', {
      id, type: 'number', inputmode: 'decimal',
      min: prop.minimum, max: prop.maximum, step: prop.type === 'integer' ? 1 : 'any',
      placeholder: prop.default !== undefined ? `Default: ${prop.default}` : key === 'seed' ? 'Random' : '',
    });
    state.controls[key] = {
      read: () => (input.value === '' ? undefined : Number(input.value)),
      write: v => { input.value = v ?? ''; },
    };
    return el('div', { class: 'field' }, labelFor(key, prop, isRequired, id), input, help);
  }

  const long = /prompt|text|description/.test(key);
  const input = long ? el('textarea', { id, rows: 2 }) : el('input', { id, type: 'text' });
  if (prop.default) input.placeholder = String(prop.default);
  state.controls[key] = {
    read: () => (input.value.trim() === '' || input.value === prop.default ? undefined : input.value),
    write: v => { input.value = v ?? ''; },
  };
  return el('div', { class: `field${long ? ' wide' : ''}` }, labelFor(key, prop, isRequired, id), input, help);
}

function makeUpload(key, prop, isRequired) {
  const id = `upload-${key}`;
  const preview = el('img', { alt: '', hidden: true });
  const text = el('span', { class: 'muted small' }, 'Drop a photo here or click to choose (JPG, PNG, WebP)');
  const input = el('input', { id, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  const remove = el('button', { type: 'button', class: 'btn small remove', hidden: true }, 'Remove');
  const zone = el('div', { class: 'dropzone' }, input, preview, text, remove);

  const clear = () => {
    delete state.uploads[key];
    preview.hidden = true;
    remove.hidden = true;
    input.value = '';
    text.textContent = 'Drop a photo here or click to choose (JPG, PNG, WebP)';
  };
  const setFile = file => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error');
    if (file.size > MAX_IMAGE_BYTES) return toast('Image must be 10 MB or smaller', 'error');
    const reader = new FileReader();
    reader.onload = () => {
      state.uploads[key] = reader.result;
      preview.src = reader.result;
      preview.hidden = false;
      remove.hidden = false;
      text.textContent = file.name;
    };
    reader.readAsDataURL(file);
  };

  input.addEventListener('change', () => setFile(input.files[0]));
  remove.addEventListener('click', e => {
    e.stopPropagation();
    clear();
  });
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    setFile(e.dataTransfer.files[0]);
  });

  const help = prop.description ? el('span', { class: 'help' }, prop.description) : null;
  return el('div', { class: 'field' }, labelFor(key, prop, isRequired, id), zone, help);
}

function collectSettings() {
  const settings = {};
  for (const [key, control] of Object.entries(state.controls)) {
    const value = control.read();
    if (value !== undefined && !Number.isNaN(value)) settings[key] = value;
  }
  return { ...settings, ...state.uploads };
}

// ---------- generate ----------

document.querySelectorAll('[data-example]').forEach(chip =>
  chip.addEventListener('click', () => {
    $('prompt').value = chip.dataset.example;
    $('prompt').focus();
  }));

$('prompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('create').requestSubmit();
});

$('create').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.schema) return;
  const prompt = $('prompt').value.trim();
  const settings = collectSettings();
  const missing = state.schema.required.filter(k =>
    k !== 'prompt' && settings[k] === undefined && state.schema.properties[k]?.default === undefined);
  const errors = [];
  if (!prompt) errors.push('Please describe the video you want.');
  if (missing.length) errors.push(`This model needs: ${missing.map(humanize).join(', ')}`);
  if (errors.length) return showMessages(errors);

  const button = $('generate');
  button.disabled = true;
  button.textContent = 'Starting…';
  try {
    const count = Number($('count').value);
    const result = await api('POST', '/api/generate', { model: state.model, prompt, settings, count });
    showMessages([], result.warnings);
    state.jobs.push(...result.jobs);
    renderJobs();
    startPolling();
    toast(count > 1 ? `Started ${count} videos` : 'Started. This usually takes 1–10 minutes.');
  } catch (err) {
    showMessages([err.message]);
  } finally {
    button.disabled = false;
    button.textContent = 'Generate';
  }
});

// ---------- queue ----------

function renderJobs() {
  const visible = state.jobs.filter(j => j.status !== 'succeeded');
  $('queue-section').hidden = !visible.length;
  $('queue').replaceChildren(...visible.map(job => {
    const active = ACTIVE.has(job.status);
    const since = job.startedAt ?? job.createdAt;
    const parts = [
      job.status === 'failed' ? job.error : STATUS_LABELS[job.status] ?? job.status,
      active && since ? elapsed(Date.now() - since) : null,
      job.model.split('/').pop(),
      job.variation ? `variation ${job.variation}` : null,
    ].filter(Boolean);
    const action = active
      ? el('button', { type: 'button', class: 'btn small danger', onclick: () => cancelJob(job) }, 'Cancel')
      : el('button', { type: 'button', class: 'btn small', onclick: () => dismissJob(job) }, 'Dismiss');
    return el('li', { class: `job ${job.status}` },
      el('div', { class: 'spinner', 'aria-hidden': 'true' }),
      el('div', { class: 'info' }, el('div', { class: 'prompt', title: job.prompt }, job.prompt), el('div', { class: 'meta' }, parts.join(' · '))),
      action);
  }));
}

async function cancelJob(job) {
  try {
    await api('POST', `/api/jobs/${job.id}/cancel`);
    await refreshJobs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function dismissJob(job) {
  await api('DELETE', `/api/jobs/${job.id}`).catch(() => {});
  state.jobs = state.jobs.filter(j => j.id !== job.id);
  renderJobs();
}

async function refreshJobs() {
  const { jobs } = await api('GET', '/api/jobs');
  const finishedNow = jobs.filter(j => j.status === 'succeeded');
  state.jobs = jobs;
  renderJobs();
  if (finishedNow.length) {
    toast(finishedNow.length > 1 ? `${finishedNow.length} videos are ready` : 'Your video is ready 🎉');
    await Promise.all(finishedNow.map(j => api('DELETE', `/api/jobs/${j.id}`).catch(() => {})));
    state.jobs = state.jobs.filter(j => j.status !== 'succeeded');
    await loadGallery();
  }
  for (const j of jobs) {
    if (j.status === 'failed' && !state.notifiedFailures.has(j.id)) {
      state.notifiedFailures.add(j.id);
      toast(`A video failed: ${j.error}`, 'error');
    }
  }
}

function startPolling() {
  if (state.timer) return;
  state.timer = setInterval(async () => {
    state.tick++;
    renderJobs(); // refresh the elapsed timers every second
    if (state.tick % 2) return;
    try {
      await refreshJobs();
    } catch {
      // Server briefly unavailable; try again on the next tick.
    }
    if (!state.jobs.some(j => ACTIVE.has(j.status))) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }, 1000);
}

// ---------- gallery ----------

async function loadGallery() {
  const { videos } = await api('GET', '/api/videos');
  $('gallery-empty').hidden = videos.length > 0;
  $('video-count').textContent = videos.length ? `${videos.length} saved` : '';
  $('gallery').replaceChildren(...videos.map(videoCard));
}

function videoCard(video) {
  const file = video.files[0];
  const src = `/videos/${encodeURIComponent(file)}`;
  const isVideo = /\.(mp4|webm|mov)$/i.test(file);
  const media = isVideo
    ? el('video', { src, controls: true, preload: 'metadata', playsinline: true, loop: true })
    : el('img', { src, alt: video.prompt ?? '' });
  const meta = [
    video.model?.split('/').pop(),
    new Date(video.savedAt).toLocaleString(),
    video.predictTime ? `made in ${Math.round(video.predictTime)}s` : null,
  ].filter(Boolean).join(' · ');

  return el('article', { class: 'video-card' },
    media,
    el('div', { class: 'body' },
      el('div', { class: 'prompt', title: video.prompt }, video.prompt ?? ''),
      el('div', { class: 'meta' }, meta),
      el('div', { class: 'actions' },
        el('a', { class: 'btn small', href: src, download: file }, 'Download'),
        el('button', { type: 'button', class: 'btn small', onclick: () => reuse(video) }, 'Reuse settings'),
        el('button', { type: 'button', class: 'btn small danger', onclick: () => deleteVideo(video) }, 'Delete'))));
}

async function reuse(video) {
  const preset = presetFor(video.model);
  if (preset) {
    $('model').value = preset.name;
  } else {
    $('model').value = CUSTOM;
    $('custom-model').value = video.model;
  }
  updateModelAbout();
  await loadModel(currentModelRef());
  $('prompt').value = video.prompt ?? '';
  for (const [key, value] of Object.entries(video.input ?? {})) {
    if (key !== 'prompt' && state.controls[key]) state.controls[key].write(value);
  }
  if (Object.values(video.input ?? {}).some(v => typeof v === 'string' && v.startsWith('data:'))) {
    toast('Images are not reused. Add the photo again if you need it.');
  }
  $('create').scrollIntoView({ behavior: 'smooth' });
  $('prompt').focus();
}

async function deleteVideo(video) {
  if (!confirm('Delete this video from your computer?')) return;
  try {
    await api('DELETE', `/api/videos/${encodeURIComponent(video.id)}`);
    await loadGallery();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- start ----------

async function initStudio() {
  populateModels();
  updateModelAbout();
  await Promise.all([loadModel(currentModelRef()), loadGallery()]);
  const { jobs } = await api('GET', '/api/jobs');
  state.jobs = jobs.filter(j => j.status !== 'succeeded');
  renderJobs();
  if (state.jobs.some(j => ACTIVE.has(j.status))) startPolling();
}

try {
  await loadStatus();
  if (state.status.hasToken) await initStudio();
} catch (err) {
  document.body.prepend(el('p', { class: 'alert error' }, `Could not reach Video Studio: ${err.message}. Is the server still running?`));
}
