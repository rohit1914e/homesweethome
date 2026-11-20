// Integration tests for the HomeSweetHome API + Socket.IO server.
// Every test file starts the real server in-process (startServer({ port: 0 })) against the
// disposable local test database. Files share that database, so they run one at a time.
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('..', import.meta.url));

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/homesweethome_test';

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    // Applied before any test module (and therefore before server/src/config.ts) is imported.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_SSL: 'false',
      COOKIE_SECURE: 'false',
    },
    globalSetup: ['server/test/globalSetup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    reporters: ['default'],
  },
});
