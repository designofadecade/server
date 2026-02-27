import Http from 'http';
import { logger } from '../logger/Logger.js';
/**
 * HTTP Server wrapper with Node.js http module
 *
 * Provides a simple HTTP server with automatic error handling,
 * port validation, and graceful shutdown capabilities.
 *
 * @class Server
 * @example
 * const server = new Server({ port: 3000 }, (req, res) => {
 *   res.end('Hello World');
 * });
 *
 * // Graceful shutdown
 * await server.close();
 */
export default class Server {
    #server = null;
    #initPort = 3000;
    #initHost = '0.0.0.0';
    #requestHandler = null;
    constructor({ port = 3000, host = '0.0.0.0' } = {}, requestHandler) {
        // Validate port
        if (isNaN(port) || port < 1 || port > 65535) {
            throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
        }
        // Validate request handler
        if (typeof requestHandler !== 'function') {
            throw new Error('Request handler must be a function');
        }
        this.#initPort = port;
        this.#initHost = host;
        this.#requestHandler = requestHandler;
        this.#start();
    }
    get server() {
        return this.#server;
    }
    #start() {
        this.#server = Http.createServer(this.#requestHandler);
        // Attach error handler before listen to avoid race conditions
        this.#server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger.error('Port is already in use', { port: this.#initPort });
                process.exit(1);
            }
            logger.error('HTTP Server error', { error: error.message, code: error.code });
            process.exit(1);
        });
        this.#server.listen(this.#initPort, this.#initHost, () => {
            logger.info('HTTP Server listening', { host: this.#initHost, port: this.#initPort });
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            if (this.#server) {
                this.#server.close((error) => {
                    if (error) {
                        logger.error('Error closing HTTP Server', { error: error.message });
                        reject(error);
                    }
                    else {
                        logger.info('HTTP Server closed');
                        resolve();
                    }
                });
            }
            else {
                resolve();
            }
        });
    }
}
//# sourceMappingURL=Server.js.map