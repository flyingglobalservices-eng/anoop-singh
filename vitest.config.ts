import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // video-studio is a separate tool with its own node:test suite
    exclude: [...configDefaults.exclude, 'video-studio/**'],
  },
});
