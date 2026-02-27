import { EventEmitter } from 'events';
import { WebSocketServer as WebSocketServerLibrary, WebSocket } from 'ws';
import { logger } from '../logger/Logger.js';
import WebSocketMessageFormatter from './WebSocketMessageFormatter.js';
export default class WebSocketServer extends EventEmitter {
    #wss;
    constructor({ port = 8080, host = '0.0.0.0' } = {}) {
        super();
        // Validate port
        if (isNaN(port) || port < 1 || port > 65535) {
            throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
        }
        this.#init(port, host);
    }
    get clientCount() {
        return this.#wss.clients.size;
    }
    #init(port, host) {
        this.#wss = new WebSocketServerLibrary({ port, host });
        // Error handler for the WebSocket server itself
        this.#wss.on('error', (error) => {
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
        this.#wss.on('connection', (ws) => {
            logger.info('WebSocket client connected');
            ws.send(WebSocketMessageFormatter.format('ws:connected', {
                message: 'WebSocket connection established',
            }));
            ws.on('message', async (message) => {
                const messageString = message.toString();
                if (messageString.includes('ws:ping')) {
                    ws.send(WebSocketMessageFormatter.format('ws:pong', {}));
                    return;
                }
                try {
                    const parsed = WebSocketMessageFormatter.parse(messageString);
                    if (!parsed) {
                        ws.send(WebSocketMessageFormatter.format('ws:error', {
                            error: 'Invalid message format',
                        }));
                        return;
                    }
                    this.emit('message', parsed);
                }
                catch (error) {
                    logger.error('Message handling error', { error: error.message });
                    ws.send(WebSocketMessageFormatter.format('ws:error', {
                        error: error.message,
                    }));
                }
            });
            ws.on('close', () => {
                logger.info('WebSocket client disconnected');
            });
            ws.on('error', (error) => {
                logger.error('WebSocket error', { error: error.message });
            });
        });
    }
    broadcast(message) {
        this.#wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                }
                catch (error) {
                    logger.error('Broadcast send error', { error: error.message });
                }
            }
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            if (this.#wss) {
                this.#wss.close((error) => {
                    if (error) {
                        logger.error('Error closing WebSocket Server', { error: error.message });
                        reject(error);
                    }
                    else {
                        logger.info('WebSocket Server closed');
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
//# sourceMappingURL=WebSocketServer.js.map