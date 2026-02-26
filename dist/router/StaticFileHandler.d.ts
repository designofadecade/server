interface ServeResponse {
    status: number;
    headers: Record<string, string>;
    body: string | Buffer;
}
interface StaticFileHandlerOptions {
    cacheControl?: string;
}
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
    #private;
    static MIME_TYPES: Record<string, string>;
    /**
     * Create a new StaticFileHandler
     *
     * @param {string} baseDir - Base directory to serve files from (absolute path)
     * @param {Object} options - Configuration options
     * @param {string} [options.cacheControl='public, max-age=3600'] - Cache-Control header value
     * @throws {Error} If baseDir is not a non-empty string
     */
    constructor(baseDir: string, options?: StaticFileHandlerOptions);
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
    serve(requestPath: string): Promise<ServeResponse>;
}
export {};
//# sourceMappingURL=StaticFileHandler.d.ts.map