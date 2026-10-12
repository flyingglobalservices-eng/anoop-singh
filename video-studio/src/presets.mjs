// Short names for popular text-to-video models on Replicate.
// Any other Replicate model can be used with --model owner/name.
export const PRESETS = {
  hailuo: { model: 'minimax/hailuo-02', about: 'MiniMax Hailuo 02: realistic motion and physics, up to 1080p, 6 or 10 s' },
  kling: { model: 'kwaivgi/kling-v2.1-master', about: 'Kling 2.1 Master: cinematic quality, 1080p, 5 or 10 s' },
  veo3: { model: 'google/veo-3', about: 'Google Veo 3: top quality, video with generated sound, ~8 s' },
  'veo3-fast': { model: 'google/veo-3-fast', about: 'Google Veo 3 Fast: cheaper and quicker Veo 3 with sound' },
  seedance: { model: 'bytedance/seedance-1-pro', about: 'ByteDance Seedance 1 Pro: multi-shot scenes, up to 1080p' },
  wan: { model: 'wan-video/wan-2.2-t2v-fast', about: 'Wan 2.2 (open model): fast and low cost, up to 720p' },
};

export const DEFAULT_PRESET = 'hailuo';

export function resolveModel(name = DEFAULT_PRESET) {
  return PRESETS[name.toLowerCase()]?.model ?? name;
}
