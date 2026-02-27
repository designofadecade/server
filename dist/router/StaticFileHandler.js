import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger/Logger.js';
/**
 * StaticFileHandler - Serves static files with security and proper MIME types
 *
 * Handles serving static files from a base directory with directory traversal
 * protection, proper content types, and caching headers.
 *
 * @example
 * const handler = new StaticFileHandler('./public');
 * const response = await handler.serve('/assets/style.css');
 */
export default class StaticFileHandler {
    static MIME_TYPES = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.eot': 'application/vnd.ms-fontobject',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        '.xml': 'application/xml',
        '.txt': 'text/plain',
        '.wasm': 'application/wasm',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.zip': 'application/zip',
    };
    #baseDir;
    #cacheControl;
    /**
     * Create a new StaticFileHandler
     *
     * @param {string} baseDir - Base directory to serve files from (absolute path)
     * @param {Object} options - Configuration options
     * @param {string} [options.cacheControl='public, max-age=3600'] - Cache-Control header value
     * @throws {Error} If baseDir is not a non-empty string
     */
    constructor(baseDir, options = {}) {
        if (!baseDir || typeof baseDir !== 'string') {
            throw new Error('baseDir must be a non-empty string');
        }
        this.#baseDir = path.resolve(baseDir);
        this.#cacheControl = options.cacheControl || 'public, max-age=3600';
    }
    /**
     * Serve a static file
     *
     * @param {string} requestPath - The requested file path
     * @returns {Promise<Object>} Response object with status, headers, and body
     *
     * @example
     * const response = await handler.serve('/assets/style.css');
     * // Returns: { status: 200, headers: {...}, body: Buffer }
     */
    async serve(requestPath) {
        try {
            // Security: prevent directory traversal
            // Resolve the full path and ensure it's within the base directory
            const filePath = path.resolve(this.#baseDir, '.' + requestPath);
            // Ensure file is within base directory (using resolve to handle .. properly)
            const resolvedBase = path.resolve(this.#baseDir);
            if (!filePath.startsWith(resolvedBase + path.sep) && filePath !== resolvedBase)
                return {
                    status: 403,
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'Forbidden',
                };
            let stats = await fs.stat(filePath);
            // Support index.html for directories
            let finalPath = filePath;
            if (stats.isDirectory()) {
                finalPath = path.join(filePath, 'index.html');
                try {
                    stats = await fs.stat(finalPath);
                }
                catch {
                    return {
                        status: 404,
                        headers: { 'Content-Type': 'text/plain' },
                        body: 'Not Found',
                    };
                }
            }
            if (!stats.isFile())
                return {
                    status: 404,
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'Not Found',
                };
            const content = await fs.readFile(finalPath);
            const ext = path.extname(finalPath).toLowerCase();
            const contentType = StaticFileHandler.MIME_TYPES[ext] || 'application/octet-stream';
            // Add charset for text-based content
            const fullContentType = contentType.startsWith('text/') ||
                contentType.includes('javascript') ||
                contentType.includes('json')
                ? `${contentType}; charset=utf-8`
                : contentType;
            return {
                status: 200,
                headers: {
                    'Content-Type': fullContentType,
                    'Cache-Control': this.#cacheControl,
                    'Content-Length': stats.size.toString(),
                    'Last-Modified': stats.mtime.toUTCString(),
                    'X-Content-Type-Options': 'nosniff',
                },
                body: content,
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    status: 404,
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'Not Found',
                };
            }
            logger.error('Static file error', { error: error.message, code: error.code });
            return {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
                body: 'Internal Server Error',
            };
        }
    }
}
//# sourceMappingURL=StaticFileHandler.js.map