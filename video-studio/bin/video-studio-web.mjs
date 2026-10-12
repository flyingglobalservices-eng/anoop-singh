#!/usr/bin/env node
// Starts the Video Studio web app on this computer and opens it in the browser.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadToken } from '../src/cli.mjs';
import { createStudioServer } from '../src/server.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '3210' },
    out: { type: 'string', short: 'o', default: 'videos' },
    'no-open': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (opts.help) {
  console.log(`video-studio-web: Video Studio in your browser

Usage: video-studio-web [--port 3210] [--out videos] [--no-open]

  -p, --port <n>     Port to use (the next free one is tried if it's busy)
  -o, --out <dir>    Folder for videos (shared with the command-line tool). Default: ./videos
      --no-open      Don't open the browser automatically`);
  process.exit(0);
}

const outDir = path.resolve(opts.out);
const server = createStudioServer({
  token: await loadToken(process.env, process.cwd()),
  envFile: path.join(APP_DIR, '.env'),
  outDir,
});

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref();
}

let port = Number(opts.port);
const lastPort = port + 10;
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && port < lastPort) {
    server.listen(++port, '127.0.0.1');
  } else {
    console.error(`Could not start the server: ${err.message}`);
    process.exit(1);
  }
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`🎬 Video Studio is running at ${url}`);
  console.log(`   Videos are saved in ${outDir}`);
  console.log('   Keep this window open while you use it. Press Ctrl+C to stop.');
  if (!opts['no-open']) openBrowser(url);
});
server.listen(port, '127.0.0.1');
