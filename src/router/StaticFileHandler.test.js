import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import StaticFileHandler from './StaticFileHandler.ts';
import fs from 'fs/promises';
import path from 'path';

vi.mock('fs/promises');

describe('StaticFileHandler', () => {
    let handler;
    const baseDir = '/test/public';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should create a StaticFileHandler instance', () => {
            handler = new StaticFileHandler(baseDir);
            expect(handler).toBeInstanceOf(StaticFileHandler);
        });

        it('should throw error if baseDir is not provided', () => {
            expect(() => {
                new StaticFileHandler();
            }).toThrow('baseDir must be a non-empty string');
        });

        it('should throw error if baseDir is empty string', () => {
            expect(() => {
                new StaticFileHandler('');
            }).toThrow('baseDir must be a non-empty string');
        });

        it('should throw error if baseDir is not a string', () => {
            expect(() => {
                new StaticFileHandler(123);
            }).toThrow('baseDir must be a non-empty string');
        });

        it('should accept custom cache control', () => {
            handler = new StaticFileHandler(baseDir, {
                cacheControl: 'no-cache'
            });
            expect(handler).toBeInstanceOf(StaticFileHandler);
        });

        it('should resolve baseDir to absolute path', () => {
            handler = new StaticFileHandler('./relative/path');
            expect(handler).toBeInstanceOf(StaticFileHandler);
        });
    });

    describe('Static MIME_TYPES', () => {
        it('should have MIME types defined', () => {
            expect(StaticFileHandler.MIME_TYPES).toBeDefined();
            expect(typeof StaticFileHandler.MIME_TYPES).toBe('object');
        });

        it('should include common MIME types', () => {
            expect(StaticFileHandler.MIME_TYPES['.html']).toBe('text/html');
            expect(StaticFileHandler.MIME_TYPES['.css']).toBe('text/css');
            expect(StaticFileHandler.MIME_TYPES['.js']).toBe('text/javascript');
            expect(StaticFileHandler.MIME_TYPES['.json']).toBe('application/json');
            expect(StaticFileHandler.MIME_TYPES['.png']).toBe('image/png');
        });
    });

    describe('serve', () => {
        beforeEach(() => {
            handler = new StaticFileHandler(baseDir);
        });

        it('should serve a file successfully', async () => {
            const fileContent = Buffer.from('body { color: red; }');
            const filePath = path.join(baseDir, 'style.css');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/style.css');

            expect(response.status).toBe(200);
            expect(response.headers['Content-Type']).toContain('text/css');
            expect(response.body).toBe(fileContent);
        });

        it('should prevent directory traversal attacks', async () => {
            const response = await handler.serve('/../../../etc/passwd');

            expect(response.status).toBe(403);
            expect(response.body).toBe('Forbidden');
        });

        it('should filter out .. in paths', async () => {
            const fileContent = Buffer.from('test');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/safe/../file.txt');

            expect(response.status).toBe(200);
        });

        it('should return 404 for non-existent files', async () => {
            fs.stat.mockRejectedValue({ code: 'ENOENT' });

            const response = await handler.serve('/nonexistent.txt');

            expect(response.status).toBe(404);
            expect(response.body).toBe('Not Found');
        });

        it('should serve index.html for directories', async () => {
            const fileContent = Buffer.from('<!DOCTYPE html><html></html>');

            fs.stat
                .mockResolvedValueOnce({
                    isFile: () => false,
                    isDirectory: () => true
                })
                .mockResolvedValueOnce({
                    isFile: () => true,
                    isDirectory: () => false,
                    size: fileContent.length,
                    mtime: new Date()
                });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/docs/');

            expect(response.status).toBe(200);
            expect(response.headers['Content-Type']).toContain('text/html');
        });

        it('should return 404 if directory has no index.html', async () => {
            fs.stat
                .mockResolvedValueOnce({
                    isFile: () => false,
                    isDirectory: () => true
                })
                .mockRejectedValueOnce({ code: 'ENOENT' });

            const response = await handler.serve('/docs/');

            expect(response.status).toBe(404);
            expect(response.body).toBe('Not Found');
        });

        it('should return 404 if path is not a file', async () => {
            fs.stat.mockResolvedValue({
                isFile: () => false,
                isDirectory: () => false
            });

            const response = await handler.serve('/socket');

            expect(response.status).toBe(404);
        });

        it('should set correct MIME type for HTML files', async () => {
            const fileContent = Buffer.from('<html></html>');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/index.html');

            expect(response.headers['Content-Type']).toContain('text/html');
            expect(response.headers['Content-Type']).toContain('charset=utf-8');
        });

        it('should set correct MIME type for JavaScript files', async () => {
            const fileContent = Buffer.from('console.log("test");');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/script.js');

            expect(response.headers['Content-Type']).toContain('text/javascript');
            expect(response.headers['Content-Type']).toContain('charset=utf-8');
        });

        it('should set correct MIME type for JSON files', async () => {
            const fileContent = Buffer.from('{"key": "value"}');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/data.json');

            expect(response.headers['Content-Type']).toContain('application/json');
            expect(response.headers['Content-Type']).toContain('charset=utf-8');
        });

        it('should set correct MIME type for images', async () => {
            const fileContent = Buffer.from('fake-image-data');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/image.png');

            expect(response.headers['Content-Type']).toBe('image/png');
        });

        it('should use default MIME type for unknown extensions', async () => {
            const fileContent = Buffer.from('unknown content');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/file.unknown');

            expect(response.headers['Content-Type']).toBe('application/octet-stream');
        });

        it('should include cache control headers', async () => {
            const fileContent = Buffer.from('test');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/test.txt');

            expect(response.headers['Cache-Control']).toBe('public, max-age=3600');
        });

        it('should use custom cache control if provided', async () => {
            handler = new StaticFileHandler(baseDir, {
                cacheControl: 'no-cache, no-store'
            });

            const fileContent = Buffer.from('test');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/test.txt');

            expect(response.headers['Cache-Control']).toBe('no-cache, no-store');
        });

        it('should include Content-Length header', async () => {
            const fileContent = Buffer.from('test content');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/test.txt');

            expect(response.headers['Content-Length']).toBe(fileContent.length.toString());
        });

        it('should include Last-Modified header', async () => {
            const mtime = new Date('2024-01-01T00:00:00Z');
            const fileContent = Buffer.from('test');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: mtime
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/test.txt');

            expect(response.headers['Last-Modified']).toBe(mtime.toUTCString());
        });

        it('should include X-Content-Type-Options header', async () => {
            const fileContent = Buffer.from('test');

            fs.stat.mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                size: fileContent.length,
                mtime: new Date()
            });

            fs.readFile.mockResolvedValue(fileContent);

            const response = await handler.serve('/test.txt');

            expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
        });

        it('should return 500 for unexpected errors', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            fs.stat.mockRejectedValue(new Error('Unexpected error'));

            const response = await handler.serve('/test.txt');

            expect(response.status).toBe(500);
            expect(response.body).toBe('Internal Server Error');
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });

        it('should handle various image formats', async () => {
            const formats = [
                ['.jpg', 'image/jpeg'],
                ['.jpeg', 'image/jpeg'],
                ['.gif', 'image/gif'],
                ['.svg', 'image/svg+xml'],
                ['.webp', 'image/webp']
            ];

            for (const [ext, mimeType] of formats) {
                const fileContent = Buffer.from('image-data');

                fs.stat.mockResolvedValue({
                    isFile: () => true,
                    isDirectory: () => false,
                    size: fileContent.length,
                    mtime: new Date()
                });

                fs.readFile.mockResolvedValue(fileContent);

                const response = await handler.serve(`/image${ext}`);

                expect(response.headers['Content-Type']).toBe(mimeType);
            }
        });

        it('should handle font files', async () => {
            const formats = [
                ['.woff', 'font/woff'],
                ['.woff2', 'font/woff2'],
                ['.ttf', 'font/ttf'],
                ['.otf', 'font/otf']
            ];

            for (const [ext, mimeType] of formats) {
                const fileContent = Buffer.from('font-data');

                fs.stat.mockResolvedValue({
                    isFile: () => true,
                    isDirectory: () => false,
                    size: fileContent.length,
                    mtime: new Date()
                });

                fs.readFile.mockResolvedValue(fileContent);

                const response = await handler.serve(`/font${ext}`);

                expect(response.headers['Content-Type']).toBe(mimeType);
            }
        });

        it('should handle media files', async () => {
            const formats = [
                ['.mp4', 'video/mp4'],
                ['.webm', 'video/webm'],
                ['.mp3', 'audio/mpeg'],
                ['.wav', 'audio/wav']
            ];

            for (const [ext, mimeType] of formats) {
                const fileContent = Buffer.from('media-data');

                fs.stat.mockResolvedValue({
                    isFile: () => true,
                    isDirectory: () => false,
                    size: fileContent.length,
                    mtime: new Date()
                });

                fs.readFile.mockResolvedValue(fileContent);

                const response = await handler.serve(`/media${ext}`);

                expect(response.headers['Content-Type']).toBe(mimeType);
            }
        });
    });
});
