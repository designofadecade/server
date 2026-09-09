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
   * Custom upgrade gate. Return false to refuse the connection. Runs after the
   * `allowedOrigins` check when both are supplied.
   */
  verifyClient?: (info: WebSocketUpgradeInfo) => boolean | Promise<boolean>;
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

export default class WebSocketServer extends EventEmitter {
  #wss!: WebSocketServerLibrary;

  #allowedOrigins: string[] | null = null;
  #verifyClient: WebSocketServerOptions['verifyClient'] = undefined;
  #exitOnError: boolean = false;

  constructor({
    port = 8080,
    host = '0.0.0.0',
    maxPayload = DEFAULT_MAX_PAYLOAD,
    allowedOrigins,
    verifyClient,
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

    this.#allowedOrigins = allowedOrigins ?? null;
    this.#verifyClient = verifyClient;
    this.#exitOnError = exitOnError;

    this.#init(port, host, maxPayload);
  }

  /**
   * Decides whether a pending upgrade may proceed. Refusals are logged with the
   * offending origin so hijacking attempts are visible.
   */
  async #shouldAccept(info: WebSocketUpgradeInfo): Promise<boolean> {
    if (this.#allowedOrigins) {
      const { origin } = info;

      if (!origin || !this.#allowedOrigins.includes(origin)) {
        logger.warn('WebSocket upgrade refused: origin not allowed', {
          code: 'WEBSOCKET_ORIGIN_REFUSED',
          source: 'WebSocketServer.verifyClient',
          origin: origin ?? null,
        });
        return false;
      }
    }

    if (this.#verifyClient) {
      try {
        if (!(await this.#verifyClient(info))) {
          logger.warn('WebSocket upgrade refused by verifyClient', {
            code: 'WEBSOCKET_UPGRADE_REFUSED',
            source: 'WebSocketServer.verifyClient',
          });
          return false;
        }
      } catch (error: unknown) {
        logger.error('WebSocket verifyClient threw, refusing upgrade', {
          code: 'WEBSOCKET_VERIFY_CLIENT_ERROR',
          source: 'WebSocketServer.verifyClient',
          error: error instanceof Error ? error : String(error),
        });
        return false;
      }
    }

    return true;
  }

  get clientCount(): number {
    return this.#wss.clients.size;
  }

  #init(port: number, host: string, maxPayload: number): void {
    const needsGate = this.#allowedOrigins !== null || this.#verifyClient !== undefined;

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
              }).then((accepted) => (accepted ? done(true) : done(false, 403, 'Forbidden')));
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
      logger.info('WebSocket client connected', {
        source: 'WebSocketServer.connection',
        clientCount: this.clientCount,
      });

      // Re-emitted with the upgrade request so consumers can read headers and
      // cookies for their own authentication.
      this.emit('connection', ws, req);

      ws.send(
        WebSocketMessageFormatter.format('ws:connected', {
          message: 'WebSocket connection established',
        })
      );

      ws.on('message', async (message: Buffer) => {
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

          this.emit('message', parsed);
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
