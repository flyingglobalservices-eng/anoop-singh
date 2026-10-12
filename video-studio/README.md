# Video Studio

Type a description, get an HD video. Video Studio sends your prompt to top AI
video models (Hailuo, Kling, Google Veo 3, Seedance, Wan) on
[Replicate](https://replicate.com) and saves the finished MP4 on your computer.

```
video-studio "A drone shot over misty Himalayan mountains at sunrise"
🎬 Generating 1 video(s) with minimax/hailuo-02. This usually takes 1–10 minutes each.
Started (id abc123)
processing (5s)
succeeded (148s)
✅ Saved videos/20261012-093005-a-drone-shot-over-misty-himalayan.mp4
```

## Setup (one time, about 5 minutes)

1. **Install Node.js 18 or newer** from https://nodejs.org (choose "LTS").
2. **Get a Replicate API token**
   - Sign up at https://replicate.com
   - Add a payment method at https://replicate.com/account/billing (videos are paid per video)
   - Create a token at https://replicate.com/account/api-tokens (it starts with `r8_`)
3. **Save the token**: copy `.env.example` to `.env` in this folder and paste your token:
   ```
   REPLICATE_API_TOKEN=r8_your_token_here
   ```
   Keep this file private. It is already excluded from git.
4. **Optional: make the `video-studio` command available everywhere**. In this folder, run:
   ```
   npm link
   ```
   Otherwise use `node bin/video-studio.mjs` instead of `video-studio` in the examples below.

No `npm install` is needed: the tool has no dependencies.

## Making videos

```bash
# Simplest: default model (Hailuo 02) at its best quality (1080p)
video-studio "A golden retriever running on a beach at sunset, slow motion"

# Pick a model, length and shape (9:16 = vertical for Reels/Shorts)
video-studio "Chai being poured into a glass, close-up, cinematic" -m kling -d 10 -a 9:16

# Video with sound (Google Veo 3)
video-studio "A street musician playing sitar in Jaipur, crowd clapping" -m veo3

# Bring a photo to life (image-to-video)
video-studio "The woman smiles and turns towards the camera" -i photo.jpg

# Avoid unwanted things
video-studio "Busy Mumbai street at night" -n "blurry, text, watermark, distorted faces"

# 3 different versions of the same idea
video-studio "A paper boat sailing in a rain puddle" -c 3

# Many videos at once: one prompt per line in a text file
video-studio -f prompts.txt -o my-videos
```

Videos are saved in a `videos` folder (change it with `-o`). Next to every video
there is a `.json` file recording the prompt, model and settings, so you can
re-create or tweak a video later.

### All options

| Option | What it does |
|---|---|
| `-m, --model` | Model preset (see below) or any Replicate model as `owner/name` |
| `-r, --resolution` | `1080p`, `720p`, … Default: the highest the model offers |
| `-d, --duration` | Length in seconds. If the model doesn't offer that exact length, the closest one is used |
| `-a, --aspect` | `16:9` (YouTube), `9:16` (Reels/Shorts), `1:1` (square) |
| `-n, --negative` | Things to keep out of the video |
| `-i, --image` | A photo (file or URL) to use as the first frame |
| `--seed` | A number that makes results repeatable |
| `--fps` | Frames per second (only some models) |
| `--set key=value` | Any other model setting. Can be repeated |
| `-c, --count` | Number of variations per prompt (1–20) |
| `-f, --file` | Text file with one prompt per line. Lines starting with `#` are skipped |
| `-o, --out` | Output folder |
| `--timeout` | Minutes to wait per video before giving up (default 15) |
| `--dry-run` | Check your settings and show what would be sent. Free: nothing is generated |

Press **Ctrl+C** at any time to stop. Jobs still running on Replicate are
canceled so they don't keep costing money.

### Models

Run `video-studio models` to see this list:

| Preset | Model | Good for |
|---|---|---|
| `hailuo` (default) | minimax/hailuo-02 | Realistic motion and physics, 1080p, 6 or 10 s |
| `kling` | kwaivgi/kling-v2.1-master | Cinematic quality, 1080p, 5 or 10 s |
| `veo3` | google/veo-3 | Top quality, **includes sound** |
| `veo3-fast` | google/veo-3-fast | Cheaper and faster Veo 3, with sound |
| `seedance` | bytedance/seedance-1-pro | Multi-shot scenes, up to 1080p |
| `wan` | wan-video/wan-2.2-t2v-fast | Open model, fast and cheap, up to 720p |

You can use any other model from
[replicate.com/collections/text-to-video](https://replicate.com/collections/text-to-video),
for example `-m owner/model-name`.

Every model has different settings. To see them all, with allowed values and
defaults:

```bash
video-studio inputs kling
```

Video Studio reads these settings from Replicate each time it runs, so options
like `--resolution` and `--duration` are matched to whatever the chosen model
calls them. Invalid values are caught **before** anything is generated or charged.

## Cost

Replicate charges per video, and the price depends on the model, resolution and
length. Check the price on each model's Replicate page before making many videos.
Tips to save money:

- Test prompts with `--dry-run` (free), then at `-r 720p` or with `-m wan`.
  Switch to 1080p and a premium model once you like the result.
- Be careful with `--count` and `--file`: each line or variation is a separate paid video.
- See your spending at https://replicate.com/account/billing

## Writing good prompts

Describe **subject + action + setting + camera + style**, for example:

> A young woman in a red saree walking through a misty tea garden in Munnar,
> camera slowly tracking beside her, soft morning light, cinematic, shallow depth of field

- Say how the camera moves: "drone shot", "slow zoom in", "handheld", "close-up".
- Describe the light and mood: "golden hour", "neon-lit", "moody", "bright and cheerful".
- Keep one main action per clip. Models make short clips (5–10 seconds).
- For Veo 3, describe sounds or dialogue too: "…she says 'Welcome home' with a smile".

## Troubleshooting

| Message | Fix |
|---|---|
| `No Replicate API token found` | Do setup step 3 |
| `token is missing or invalid` | Copy the token again from replicate.com/account/api-tokens |
| `account needs credit` | Add billing at replicate.com/account/billing |
| `Model not found` | Check the name with `video-studio models`, or copy it from the model's Replicate page |
| `Generation failed: …` | Usually the prompt was blocked by the model's safety filter. Rephrase it |
| `Timed out` | The model was busy. Try again, or use `--timeout 30` |

## Development

```bash
npm test   # runs the test suite against a simulated Replicate API (no token needed)
```

Code layout: `bin/video-studio.mjs` (entry point), `src/cli.mjs` (commands),
`src/inputs.mjs` (matching options to model settings), `src/replicate.mjs` (API client),
`src/presets.mjs` (model list).
