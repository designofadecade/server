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
  /**
   * Largest request body, in bytes, a client may start sending after
   * `Expect: 100-continue`. When set, such a request whose `Content-Length`
   * is over the limit is answered `413 PAYLOAD_TOO_LARGE` (with
   * `Connection: close`) instead of `100 Continue`, so the client never
   * uploads it; any other `Expect: 100-continue` request gets its
   * `100 Continue` and reaches the handler as usual. Unset (the default),
   * Node answers `100 Continue` to everything. `WebFunction.serve` sets it to
   * the router's `maxBodyBytes`. The handler still enforces the limit on the
   * bytes actually read.
   */
  maxBodyBytes?: number;
  /**
   * Milliseconds a client has to send the whole request (headers and body)
   * before Node answers `408` and closes the connection: the defence against
   * slow uploads holding sockets open. It does not limit how long a handler
   * runs. Default `30000` on a plain Node host; `0` disables it.
   *
   * In a Lambda Web Function the default is Node's own (300 s): the only
   * client is Lambda, which delivers each request whole and enforces the
   * function's `timeoutSeconds` itself. An explicit value applies there too.
   * Node checks this every 30 s, so a request can outlive it by up to that.
   */
  requestTimeout?: number;
  /**
   * Milliseconds a client has to send the complete request headers. Default
   * `10000` on a plain Node host, Node's own (60 s) in a Web Function; must
   * not exceed a non-zero `requestTimeout`.
   */
  headersTimeout?: number;
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

  /** Default `requestTimeout` off a Web Function, in milliseconds. */
  static readonly DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
  /** Default `headersTimeout` off a Web Function, in milliseconds. */
  static readonly DEFAULT_HEADERS_TIMEOUT_MS = 10_000;

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
  #maxBodyBytes: number | undefined;
  #timeouts: { requestTimeout?: number; headersTimeout?: number };
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
      maxBodyBytes,
      requestTimeout,
      headersTimeout,
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

    if (maxBodyBytes !== undefined && (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1)) {
      throw new Error('maxBodyBytes must be a positive integer');
    }
    for (const [name, value] of Object.entries({ requestTimeout, headersTimeout })) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`${name} must be a non-negative integer (milliseconds)`);
      }
    }

    const webFunction = Server.isWebFunction();
    // Slow-client limits. Off a Web Function the defaults are tight (30 s for
    // the whole request, 10 s for its headers); in one, Lambda is the only
    // client and delivers requests whole, so Node's defaults stay unless the
    // caller sets them.
    const timeouts = webFunction
      ? { requestTimeout, headersTimeout }
      : {
          requestTimeout: requestTimeout ?? Server.DEFAULT_REQUEST_TIMEOUT_MS,
          headersTimeout:
            headersTimeout ??
            (requestTimeout !== undefined && requestTimeout > 0
              ? Math.min(Server.DEFAULT_HEADERS_TIMEOUT_MS, requestTimeout)
              : Server.DEFAULT_HEADERS_TIMEOUT_MS),
        };
    if (
      timeouts.requestTimeout !== undefined &&
      timeouts.requestTimeout > 0 &&
      timeouts.headersTimeout !== undefined &&
      timeouts.headersTimeout > timeouts.requestTimeout
    ) {
      throw new Error('headersTimeout must not exceed requestTimeout');
    }
    this.#timeouts = Object.fromEntries(
      Object.entries(timeouts).filter(([, value]) => value !== undefined)
    );
    this.#maxBodyBytes = maxBodyBytes;

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
    const server = Http.createServer(this.#timeouts, this.#requestHandler);
    this.#server = server;

    const maxBodyBytes = this.#maxBodyBytes;
    if (maxBodyBytes !== undefined) {
      // With a 'checkContinue' listener Node no longer answers
      // `100 Continue` by itself, so a client announcing an oversized body
      // can be refused before it sends a byte of it.
      server.on('checkContinue', (req: IncomingMessage, res: ServerResponse) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
          logger.warn('Refused request body over the size limit', {
            code: 'SERVER_PAYLOAD_TOO_LARGE',
            source: 'Server.checkContinue',
            method: req.method,
            maxBodyBytes,
          });
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Connection', 'close');
          res.end(
            JSON.stringify({
              success: false,
              error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
            })
          );
          return;
        }
        res.writeContinue();
        server.emit('request', req, res);
      });
    }

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
