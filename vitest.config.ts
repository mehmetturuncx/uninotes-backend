import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 60000,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://disabled:disabled@127.0.0.1:54321/prevent_production_wipe',
    },
  },
});
