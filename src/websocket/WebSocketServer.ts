import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { WebSocketServer as WebSocketServerLibrary, WebSocket } from 'ws';
import { logger } from '../logger/Logger.js';
import WebSocketMessageFormatter from './WebSocketMessageFormatter.js';

/** Details of a pending upgrade, passed to `verifyClient`. */
export interface WebSocketUpgradeInfo {
  origin?: string;
  secure: boolean;
  req: IncomingMessage;
}

export interface WebSocketServerOptions {
  port?: number;
  host?: string;
  /**
   * Largest accepted frame, in bytes. Defaults to 1 MiB.
   *
   * SECURITY: `ws` defaults to 100 MiB, and every frame is buffered in full
   * before it reaches a handler, so a handful of connections sending maximum
   * sized frames can exhaust memory.
   */
  maxPayload?: number;
  /**
   * Origins permitted to open a connection. When set, an upgrade whose `Origin`
   * is missing or unlisted is refused with 403.
   *
   * SECURITY: browsers do not apply the same-origin policy to WebSockets and
   * they do send cookies with the upgrade, so without an origin check any site
   * can open an authenticated socket on a visitor's behalf and read what it
   * publishes (cross-site WebSocket hijacking). Non-browser clients send no
   * `Origin` at all - gate those with `verifyClient` instead.
   */
  allowedOrigins?: string[];
  /**
   * Custom upgrade gate. Return false to refuse the connection with 403. Runs
   * after the `allowedOrigins` check when both are supplied. A throw, or not
   * settling within `upgradeTimeoutMs`, also refuses with 403.
   */
  verifyClient?: (info: WebSocketUpgradeInfo) => boolean | Promise<boolean>;
  /**
   * Authenticates a pending upgrade. Runs after `allowedOrigins` and
   * `verifyClient`, before the socket exists. A falsy result, a throw or
   * running past `upgradeTimeoutMs` refuses the upgrade with 401, so no
   * socket opens and no frame is ever dispatched. A truthy result is kept for
   * the connection: it is passed as the fourth argument of every `message`
   * event (and the third of `connection`), and `getAuth(ws)` returns it.
   *
   * SECURITY: this is the enforcement point for authentication. Do not
   * authenticate asynchronously in the `connection` handler: frames that arrive
   * while such a check is pending are dispatched.
   */
  authenticate?: (req: IncomingMessage) => unknown;
  /**
   * How long the whole upgrade gate (`verifyClient` then `authenticate`) may
   * take, in milliseconds. Past it the upgrade is refused: 403 while
   * `verifyClient` is pending, 401 while `authenticate` is. Defaults to 10 000.
   *
   * SECURITY: without a deadline, a check that never settles holds the
   * pending socket open indefinitely.
   */
  upgradeTimeoutMs?: number;
  /**
   * Terminate the process with `process.exit(1)` when the server errors.
   * Defaults to false.
   *
   * A library has no business deciding to kill its host process. Errors are
   * emitted as an `error` event instead; set this only if you want the old
   * fail-fast behaviour.
   */
  exitOnError?: boolean;
}

/** Frames larger than this are rejected unless `maxPayload` overrides it. */
const DEFAULT_MAX_PAYLOAD = 1024 * 1024;

/** The upgrade gate is abandoned, and the upgrade refused, after this long. */
const DEFAULT_UPGRADE_TIMEOUT_MS = 10_000;

/** The outcome of the upgrade gate: accepted, or refused with an HTTP status. */
type GateResult = { accepted: true } | { accepted: false; code: 401 | 403; message: string };

const FORBIDDEN: GateResult = { accepted: false, code: 403, message: 'Forbidden' };
const UNAUTHORIZED: GateResult = { accepted: false, code: 401, message: 'Unauthorized' };

class UpgradeTimeoutError extends Error {}

export default class WebSocketServer extends EventEmitter {
  #wss!: WebSocketServerLibrary;

  #allowedOrigins: string[] | null = null;
  #verifyClient: WebSocketServerOptions['verifyClient'] = undefined;
  #exitOnError: boolean = false;
  #authenticate: WebSocketServerOptions['authenticate'] = undefined;
  #upgradeTimeoutMs: number = DEFAULT_UPGRADE_TIMEOUT_MS;

  /** `authenticate` results, recorded at upgrade time against the request. */
  #pendingAuth = new WeakMap<IncomingMessage, unknown>();
  /** `authenticate` results of open connections. */
  #auth = new WeakMap<WebSocket, unknown>();

  constructor({
    port = 8080,
    host = '0.0.0.0',
    maxPayload = DEFAULT_MAX_PAYLOAD,
    allowedOrigins,
    verifyClient,
    authenticate,
    upgradeTimeoutMs = DEFAULT_UPGRADE_TIMEOUT_MS,
    exitOnError = false,
  }: WebSocketServerOptions = {}) {
    super();

    // Validate port
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
    }

    if (maxPayload <= 0) {
      throw new Error(`maxPayload ${maxPayload} is invalid. Must be greater than 0.`);
    }

    if (authenticate !== undefined && typeof authenticate !== 'function') {
      throw new Error('authenticate must be a function.');
    }

    if (!Number.isFinite(upgradeTimeoutMs) || upgradeTimeoutMs <= 0) {
      throw new Error(`upgradeTimeoutMs ${upgradeTimeoutMs} is invalid. Must be greater than 0.`);
    }

    this.#allowedOrigins = allowedOrigins ?? null;
    this.#authenticate = authenticate;
    this.#upgradeTimeoutMs = upgradeTimeoutMs;
    this.#verifyClient = verifyClient;
    this.#exitOnError = exitOnError;

    this.#init(port, host, maxPayload);
  }

  /**
   * Decides whether a pending upgrade may proceed. Refusals are logged with the
   * offending origin so hijacking attempts are visible.
   */
  async #shouldAccept(info: WebSocketUpgradeInfo): Promise<GateResult> {
    if (this.#allowedOrigins) {
      const { origin } = info;

      if (!origin || !this.#allowedOrigins.includes(origin)) {
        logger.warn('WebSocket upgrade refused: origin not allowed', {
          code: 'WEBSOCKET_ORIGIN_REFUSED',
          source: 'WebSocketServer.verifyClient',
          origin: origin ?? null,
        });
        return FORBIDDEN;
      }
    }

    // One deadline covers every asynchronous stage of the gate, so a check
    // that never settles refuses the upgrade instead of holding the socket.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new UpgradeTimeoutError()), this.#upgradeTimeoutMs);
      timer.unref?.();
    });
    // Rejections of an abandoned race are expected; never let them surface.
    deadline.catch(() => {});
    // Promise.resolve().then() turns a synchronous throw into a rejection.
    const withinDeadline = <T>(check: () => T): Promise<Awaited<T>> =>
      Promise.race([Promise.resolve().then(check), deadline]);

    try {
      if (this.#verifyClient) {
        const result = await this.#runVerifyClient(info, withinDeadline);
        if (!result.accepted) return result;
      }

      if (this.#authenticate) {
        const result = await this.#runAuthenticate(info.req, withinDeadline);
        if (!result.accepted) return result;
      }

      return { accepted: true };
    } finally {
      clearTimeout(timer);
    }
  }

  #logTimeout(stage: 'verifyClient' | 'authenticate'): void {
    logger.warn(`WebSocket ${stage} timed out, refusing upgrade`, {
      code: 'WEBSOCKET_UPGRADE_TIMEOUT',
      source: `WebSocketServer.${stage}`,
      timeoutMs: this.#upgradeTimeoutMs,
    });
  }

  async #runVerifyClient(
    info: WebSocketUpgradeInfo,
    withinDeadline: <T>(check: () => T) => Promise<Awaited<T>>
  ): Promise<GateResult> {
    try {
      if (!(await withinDeadline(() => this.#verifyClient!(info)))) {
        logger.warn('WebSocket upgrade refused by verifyClient', {
          code: 'WEBSOCKET_UPGRADE_REFUSED',
          source: 'WebSocketServer.verifyClient',
        });
        return FORBIDDEN;
      }
      return { accepted: true };
    } catch (error: unknown) {
      if (error instanceof UpgradeTimeoutError) {
        this.#logTimeout('verifyClient');
      } else {
        logger.error('WebSocket verifyClient threw, refusing upgrade', {
          code: 'WEBSOCKET_VERIFY_CLIENT_ERROR',
          source: 'WebSocketServer.verifyClient',
          error: error instanceof Error ? error : String(error),
        });
      }
      return FORBIDDEN;
    }
  }

  /**
   * Runs `authenticate` within the upgrade deadline and records a truthy
   * result against the request, where the `connection` listener picks it up.
   */
  async #runAuthenticate(
    req: IncomingMessage,
    withinDeadline: <T>(check: () => T) => Promise<Awaited<T>>
  ): Promise<GateResult> {
    try {
      const auth = await withinDeadline(() => this.#authenticate!(req));

      if (!auth) {
        logger.warn('WebSocket upgrade refused by authenticate', {
          code: 'WEBSOCKET_UNAUTHENTICATED',
          source: 'WebSocketServer.authenticate',
        });
        return UNAUTHORIZED;
      }

      this.#pendingAuth.set(req, auth);
      return { accepted: true };
    } catch (error: unknown) {
      if (error instanceof UpgradeTimeoutError) {
        this.#logTimeout('authenticate');
      } else {
        logger.error('WebSocket authenticate threw, refusing upgrade', {
          code: 'WEBSOCKET_AUTHENTICATE_ERROR',
          source: 'WebSocketServer.authenticate',
          error: error instanceof Error ? error : String(error),
        });
      }
      return UNAUTHORIZED;
    }
  }

  /**
   * The `authenticate` result of an open connection, or undefined when the
   * socket is unknown or no `authenticate` option is set.
   */
  getAuth(ws: WebSocket): unknown {
    return this.#auth.get(ws);
  }

  get clientCount(): number {
    return this.#wss.clients.size;
  }

  #init(port: number, host: string, maxPayload: number): void {
    const needsGate =
      this.#allowedOrigins !== null ||
      this.#verifyClient !== undefined ||
      this.#authenticate !== undefined;

    this.#wss = new WebSocketServerLibrary({
      port,
      host,
      maxPayload,
      ...(needsGate
        ? {
            verifyClient: (
              info: { origin: string; secure: boolean; req: IncomingMessage },
              done: (verified: boolean, code?: number, message?: string) => void
            ): void => {
              void this.#shouldAccept({
                origin: info.origin,
                secure: info.secure,
                req: info.req,
              }).then((result) =>
                result.accepted ? done(true) : done(false, result.code, result.message)
              );
            },
          }
        : {}),
    });

    // Error handler for the WebSocket server itself
    this.#wss.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('WebSocket port is already in use', {
          code: 'WEBSOCKET_PORT_IN_USE',
          source: 'WebSocketServer.init',
          port,
          error,
        });
      } else {
        logger.error('WebSocket Server error', {
          code: 'WEBSOCKET_SERVER_ERROR',
          source: 'WebSocketServer.init',
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

    this.#wss.on('listening', () => {
      logger.info('WebSocket Server listening', {
        source: 'WebSocketServer.init',
        host,
        port,
      });
    });

    this.#wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // With `authenticate`, every connection reaching here passed it, and its
      // result travels with the connection's events as a trailing argument.
      // Without it the events keep their original arity.
      const authenticated = this.#authenticate !== undefined;
      // Fail closed: a socket that did not come through the gate with a
      // recorded result is dropped at once. terminate(), not close(), so a
      // peer that never answers a close frame cannot linger.
      if (authenticated && !this.#pendingAuth.has(req)) {
        logger.error('WebSocket connection without an authenticate result, terminating', {
          code: 'WEBSOCKET_UNAUTHENTICATED_CONNECTION',
          source: 'WebSocketServer.connection',
        });
        ws.terminate();
        return;
      }
      const auth = authenticated ? this.#pendingAuth.get(req) : undefined;
      if (authenticated) {
        this.#pendingAuth.delete(req);
        this.#auth.set(ws, auth);
      }
      const authArgs: unknown[] = authenticated ? [auth] : [];

      logger.info('WebSocket client connected', {
        source: 'WebSocketServer.connection',
        clientCount: this.clientCount,
      });

      // Re-emitted with the upgrade request so consumers can read headers and
      // cookies. A listener that refuses the client must terminate it
      // synchronously: frames that arrive while an asynchronous check here is
      // pending are still delivered, so authentication belongs in the
      // `authenticate` option, which runs before the socket exists.
      this.emit('connection', ws, req, ...authArgs);

      ws.send(
        WebSocketMessageFormatter.format('ws:connected', {
          message: 'WebSocket connection established',
        })
      );

      ws.on('message', async (message: Buffer) => {
        // SECURITY: a socket that is closing - refused by the application's
        // 'connection' handler, for example - must not reach message handlers.
        // `ws` keeps emitting frames after close() until the peer answers the
        // close frame (up to 30 s), and a hostile peer never answers.
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const messageString = message.toString();

        if (messageString.includes('ws:ping')) {
          ws.send(WebSocketMessageFormatter.format('ws:pong', {}));
          return;
        }

        try {
          const parsed = WebSocketMessageFormatter.parse(messageString);

          if (!parsed) {
            ws.send(
              WebSocketMessageFormatter.format('ws:error', {
                error: 'Invalid message format',
              })
            );
            return;
          }

          // The sending socket and its upgrade request travel with every
          // message, so handlers can tell connections apart and authorize the
          // sender instead of acting on any client's frame.
          this.emit('message', parsed, ws, req, ...authArgs);
        } catch (error: any) {
          logger.error('Message handling error', {
            code: 'WEBSOCKET_MESSAGE_ERROR',
            source: 'WebSocketServer.onMessage',
            error,
          });
          ws.send(
            WebSocketMessageFormatter.format('ws:error', {
              error: error.message,
            })
          );
        }
      });

      ws.on('close', () => {
        this.#auth.delete(ws);
        logger.info('WebSocket client disconnected', {
          source: 'WebSocketServer.onClose',
          clientCount: this.clientCount,
        });
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocket error', {
          code: 'WEBSOCKET_CLIENT_ERROR',
          source: 'WebSocketServer.onError',
          error,
        });
      });
    });
  }

  broadcast(message: string): void {
    this.#wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error: any) {
          logger.error('Broadcast send error', {
            code: 'WEBSOCKET_BROADCAST_ERROR',
            source: 'WebSocketServer.broadcast',
            error,
          });
        }
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#wss) {
        this.#wss.close((error?: Error) => {
          if (error) {
            logger.error('Error closing WebSocket Server', {
              code: 'WEBSOCKET_CLOSE_ERROR',
              source: 'WebSocketServer.close',
              error,
            });
            reject(error);
          } else {
            logger.info('WebSocket Server closed', {
              source: 'WebSocketServer.close',
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
