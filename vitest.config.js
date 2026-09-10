import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@designofadecade/router': resolve(__dirname, './src/router'),
      '@designofadecade/events': resolve(__dirname, './src/events'),
      '@designofadecade/local': resolve(__dirname, './src/local'),
      '@designofadecade/logger': resolve(__dirname, './src/logger'),
      '@designofadecade/middleware': resolve(__dirname, './src/middleware'),
      '@designofadecade/notifications': resolve(__dirname, './src/notifications'),
      '@designofadecade/sanitizer': resolve(__dirname, './src/sanitizer'),
      '@designofadecade/server': resolve(__dirname, './src/server'),
      '@designofadecade/state': resolve(__dirname, './src/state'),
      '@designofadecade/utils': resolve(__dirname, './src/utils'),
      '@designofadecade/websocket': resolve(__dirname, './src/websocket'),
      '@designofadecade/client': resolve(__dirname, './src/client'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{js,ts}'],
    // Type-level regression tests. Several defects this package has shipped
    // were invisible to runtime tests because they only affected the .d.ts
    // a consumer sees, so those assertions live in *.test-d.ts and are
    // checked by tsc rather than executed.
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Report every source file, not just the ones a test happened to
      // import. Without this a new file with no tests is silently absent
      // from the report rather than showing up as 0%.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'src/**/*.test.{js,ts}',
        'src/**/*.test-d.ts',
        'src/**/*.bench.{js,ts}',
      ],
    },
  },
  benchmark: {
    include: ['src/**/*.bench.{js,ts}'],
  },
});
