import Http, { IncomingMessage, ServerResponse } from 'http';
import { logger } from '../logger/Logger.js';

interface ServerOptions {
  port?: number;
  host?: string;
}

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
  #server: Http.Server | null = null;

  #initPort: number = 3000;
  #initHost: string = '0.0.0.0';
  #requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

  constructor(
    { port = 3000, host = '0.0.0.0' }: ServerOptions = {},
    requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  ) {
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

  get server(): Http.Server | null {
    return this.#server;
  }

  #start(): void {
    this.#server = Http.createServer(this.#requestHandler!);

    // Attach error handler before listen to avoid race conditions
    this.#server.on('error', (error: NodeJS.ErrnoException) => {
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

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#server) {
        this.#server.close((error?: Error) => {
          if (error) {
            logger.error('Error closing HTTP Server', { error: error.message });
            reject(error);
          } else {
            logger.info('HTTP Server closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}
