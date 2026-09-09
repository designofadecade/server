import { EventEmitter } from 'events';
import Http, { IncomingMessage, ServerResponse } from 'http';
import { logger } from '../logger/Logger.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  /**
   * Terminate the process with `process.exit(1)` when the server errors.
   * Defaults to false.
   *
   * A library has no business deciding to kill its host process: doing so gave
   * the application no chance to log, drain, or retry on another port. Errors
   * are emitted as an `error` event instead. Set this only if you actually want
   * the old fail-fast behaviour.
   */
  exitOnError?: boolean;
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
 * // Handle startup and runtime failures (port in use, etc.)
 * server.on('error', (error) => {
 *   console.error('server failed', error);
 * });
 *
 * // Graceful shutdown
 * await server.close();
 */

export default class Server extends EventEmitter {
  #server: Http.Server | null = null;
  #exitOnError: boolean = false;

  #initPort: number = 3000;
  #initHost: string = '0.0.0.0';
  #requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

  constructor(
    { port = 3000, host = '0.0.0.0', exitOnError = false }: ServerOptions = {},
    requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  ) {
    super();

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
    this.#exitOnError = exitOnError;

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
        logger.error('Port is already in use', {
          code: 'SERVER_PORT_IN_USE',
          source: 'Server.start',
          port: this.#initPort,
          error,
        });
      } else {
        logger.error('HTTP Server error', {
          code: 'SERVER_ERROR',
          source: 'Server.start',
          error,
          errorCode: error.code,
        });
      }

      if (this.#exitOnError) {
        process.exit(1);
      }

      // Standard EventEmitter semantics: an application that listens decides
      // what to do, and one that does not gets an uncaught exception with a
      // stack trace rather than a silent exit code 1.
      this.emit('error', error);
    });

    this.#server.listen(this.#initPort, this.#initHost, () => {
      logger.info('HTTP Server listening', {
        source: 'Server.start',
        host: this.#initHost,
        port: this.#initPort,
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#server) {
        this.#server.close((error?: Error) => {
          if (error) {
            logger.error('Error closing HTTP Server', {
              code: 'SERVER_CLOSE_ERROR',
              source: 'Server.close',
              error,
            });
            reject(error);
          } else {
            logger.info('HTTP Server closed', {
              source: 'Server.close',
            });
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}
