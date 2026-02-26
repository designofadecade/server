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
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'src/**/*.test.{js,ts}',
            ],
        },
    },
});
