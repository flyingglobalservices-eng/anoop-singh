#!/usr/bin/env node
import { run } from '../src/cli.mjs';

// On Ctrl+C, cancel jobs still running on Replicate so they stop costing money.
const running = new Map();
let stopping = false;
process.on('SIGINT', async () => {
  if (stopping) process.exit(130);
  stopping = true;
  process.stderr.write('\nCanceling running jobs… (press Ctrl+C again to quit immediately)\n');
  await Promise.allSettled([...running.values()].map(({ client, prediction }) => client.cancel(prediction)));
  process.exit(130);
});

const code = await run(process.argv.slice(2), {
  onPrediction: (client, prediction) => running.set(prediction.id, { client, prediction }),
});
process.exit(code);
