import { EventEmitter } from 'events';
import { WebSocketServer as WebSocketServerLibrary, WebSocket } from 'ws';
import { logger } from '../logger/Logger.js';
import WebSocketMessageFormatter from './WebSocketMessageFormatter.js';

interface WebSocketServerOptions {
  port?: number;
  host?: string;
}

export default class WebSocketServer extends EventEmitter {
  #wss!: WebSocketServerLibrary;

  constructor({ port = 8080, host = '0.0.0.0' }: WebSocketServerOptions = {}) {
    super();

    // Validate port
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
    }

    this.#init(port, host);
  }

  get clientCount(): number {
    return this.#wss.clients.size;
  }

  #init(port: number, host: string): void {
    this.#wss = new WebSocketServerLibrary({ port, host });

    // Error handler for the WebSocket server itself
    this.#wss.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('WebSocket port is already in use', { port });
        process.exit(1);
      }
      logger.error('WebSocket Server error', { error: error.message, code: error.code });
      process.exit(1);
    });

    this.#wss.on('listening', () => {
      logger.info('WebSocket Server listening', { host, port });
    });

    this.#wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');

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
          logger.error('Message handling error', { error: error.message });
          ws.send(
            WebSocketMessageFormatter.format('ws:error', {
              error: error.message,
            })
          );
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    });
  }

  broadcast(message: string): void {
    this.#wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error: any) {
          logger.error('Broadcast send error', { error: error.message });
        }
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#wss) {
        this.#wss.close((error?: Error) => {
          if (error) {
            logger.error('Error closing WebSocket Server', { error: error.message });
            reject(error);
          } else {
            logger.info('WebSocket Server closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}
