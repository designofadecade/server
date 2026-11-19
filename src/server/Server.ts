import { EventEmitter } from 'events';
import Http, { IncomingMessage, ServerResponse } from 'http';
import { logger } from '../logger/Logger.js';

export interface ServerOptions {
  /**
   * Port to listen on. Default `3000`.
   *
   * Ignored when running as a Lambda Web Function: Lambda dictates the address
   * through `AWS_LAMBDA_HTTP_ENDPOINT`, and binding anywhere else means the
   * function never receives a request and fails its 10-second init check.
   */
  port?: number;
  /** Host to bind to. Default `'0.0.0.0'`. Ignored as a Web Function, as `port`. */
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
  /**
   * Drain and close the server on `SIGTERM`. Defaults to `true` when running as
   * a Lambda Web Function — Lambda sends `SIGTERM` and allows one second before
   * it kills the environment — and `false` otherwise, so a local process keeps
   * Node's default signal behaviour unless asked.
   */
  handleSignals?: boolean;
  /**
   * How long `close()` waits for in-flight requests before cutting the
   * remaining connections. Default `800` ms, which fits inside the one-second
   * window Lambda gives a Web Function after `SIGTERM`.
   */
  shutdownTimeoutMs?: number;
}

/** Where a server ended up listening. */
export interface ServerAddress {
  host: string;
  port: number;
}

/**
 * HTTP server wrapper around Node's `http` module.
 *
 * Runs unchanged in two of the package's three deployment modes:
 *
 * - **Local / any Node host** — listens on `port`/`host`.
 * - **AWS Lambda Web Function** — detected through `AWS_LAMBDA_HTTP_ENDPOINT`,
 *   which then decides the address; `SIGTERM` drains the server.
 *
 * (The third mode, a Lambda Event Function, has no server at all: it calls
 * `router.eventFunction(event)` from the handler.)
 *
 * @example
 * const server = new Server({ port: 3000 }, (req, res) => router.nodeJSRequest(req, res));
 * server.on('error', (error) => console.error('server failed', error));
 * await server.ready;
 * await server.close();
 */
export default class Server extends EventEmitter {
  /** Environment variable Lambda sets, as `host:port`, in a Web Function. */
  static readonly WEB_FUNCTION_ENDPOINT_ENV = 'AWS_LAMBDA_HTTP_ENDPOINT';

  /** True when this process runs as an AWS Lambda Web Function. */
  static isWebFunction(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env[Server.WEB_FUNCTION_ENDPOINT_ENV]);
  }

  /**
   * Parses a `host:port` endpoint. Accepts a bracketed IPv6 host
   * (`[::1]:8080`). Throws on anything else rather than guessing, because a
   * wrong guess binds an address Lambda never routes to.
   */
  static parseEndpoint(value: string): ServerAddress {
    const match = /^(?:\[([^\]]+)\]|([^:\s]+)):(\d{1,5})$/.exec(value.trim());
    const port = match ? Number(match[3]) : NaN;
    if (!match || port < 1 || port > 65535) {
      throw new Error(
        `${Server.WEB_FUNCTION_ENDPOINT_ENV} must be "host:port", got ${JSON.stringify(value)}`
      );
    }
    return { host: match[1] ?? match[2], port };
  }

  #server: Http.Server | null = null;
  #exitOnError: boolean = false;
  #shutdownTimeoutMs: number = 800;
  #address: ServerAddress;
  #requestHandler: (req: IncomingMessage, res: ServerResponse) => void;
  #signalHandler: (() => void) | null = null;
  #closing: Promise<void> | null = null;
  #listening = false;

  /** Resolves once the server is listening; rejects if it fails to start. */
  readonly ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;

  constructor(
    {
      port = 3000,
      host = '0.0.0.0',
      exitOnError = false,
      handleSignals,
      shutdownTimeoutMs = 800,
    }: ServerOptions = {},
    requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  ) {
    super();

    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
    }

    if (typeof requestHandler !== 'function') {
      throw new Error('Request handler must be a function');
    }

    const webFunction = Server.isWebFunction();
    this.#address = webFunction
      ? Server.parseEndpoint(process.env[Server.WEB_FUNCTION_ENDPOINT_ENV]!)
      : { host, port };
    this.#requestHandler = requestHandler;
    this.#exitOnError = exitOnError;
    this.#shutdownTimeoutMs = Math.max(0, shutdownTimeoutMs);

    this.ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    // `ready` is optional to await. Without this, a startup failure in an
    // application that never looked at it would also surface as an unhandled
    // rejection, on top of the `error` event that already reports it.
    this.ready.catch(() => {});

    if (handleSignals ?? webFunction) {
      this.#signalHandler = () => {
        logger.info('SIGTERM received, draining HTTP Server', { source: 'Server.signal' });
        this.close().catch(() => {});
      };
      process.once('SIGTERM', this.#signalHandler);
    }

    this.#start(webFunction);
  }

  get server(): Http.Server | null {
    return this.#server;
  }

  /** The address the server binds — Lambda's endpoint when a Web Function. */
  get address(): ServerAddress {
    return { ...this.#address };
  }

  #start(webFunction: boolean): void {
    this.#server = Http.createServer(this.#requestHandler);

    // Attach error handler before listen to avoid race conditions
    this.#server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('Port is already in use', {
          code: 'SERVER_PORT_IN_USE',
          source: 'Server.start',
          port: this.#address.port,
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

      if (!this.#listening) {
        // Startup failed: there is nothing left to drain, so stop holding a
        // SIGTERM listener for a server that never came up.
        this.#removeSignalHandler();
        this.#rejectReady(error);
      }

      if (this.#exitOnError) {
        process.exit(1);
      }

      // Standard EventEmitter semantics: an application that listens decides
      // what to do, and one that does not gets an uncaught exception with a
      // stack trace rather than a silent exit code 1.
      this.emit('error', error);
    });

    this.#server.listen(this.#address.port, this.#address.host, () => {
      logger.info('HTTP Server listening', {
        source: 'Server.start',
        host: this.#address.host,
        port: this.#address.port,
        mode: webFunction ? 'web-function' : 'node',
      });
      this.#listening = true;
      this.#resolveReady();
      this.emit('listening', this.address);
    });
  }

  /**
   * Stops accepting connections, lets in-flight requests finish for up to
   * `shutdownTimeoutMs`, then cuts whatever is left. Idle keep-alive sockets
   * are closed at once: they would otherwise hold `close()` open for the
   * full keep-alive timeout while serving nothing.
   *
   * Safe to call repeatedly and concurrently: calls during a close share it,
   * and calls after it resolve at once. Called before the server is listening
   * (a `SIGTERM` during startup), it waits for startup to finish or fail first.
   */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;

    this.#removeSignalHandler();

    const server = this.#server;
    if (!server) return Promise.resolve();

    // A failed start leaves nothing to close; a pending one is finished first,
    // because `server.close()` on a server not yet listening rejects and
    // leaves `ready` hanging for anyone awaiting it.
    const started = this.#listening
      ? Promise.resolve(true)
      : this.ready.then(
          () => true,
          () => false
        );

    const closing = started.then((running) => {
      if (!running) {
        this.#server = null;
        return;
      }
      return this.#closeListening(server);
    });

    // Cleared on settle, not inside the close callback: that callback can run
    // synchronously, before `closing` has been assigned.
    this.#closing = closing;
    closing
      .finally(() => {
        if (this.#closing === closing) this.#closing = null;
      })
      .catch(() => {});

    return closing;
  }

  #removeSignalHandler(): void {
    if (this.#signalHandler) {
      process.removeListener('SIGTERM', this.#signalHandler);
      this.#signalHandler = null;
    }
  }

  #closeListening(server: Http.Server): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => server.closeAllConnections?.(), this.#shutdownTimeoutMs);
      force.unref?.();

      server.close((error?: Error) => {
        clearTimeout(force);
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
          // Later close() calls see no server and resolve immediately,
          // instead of re-closing a stopped server (ERR_SERVER_NOT_RUNNING).
          this.#server = null;
          this.#listening = false;
          this.emit('close');
          resolve();
        }
      });

      server.closeIdleConnections?.();
    });
  }
}
