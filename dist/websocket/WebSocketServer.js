import { EventEmitter } from 'events';
import { WebSocketServer as WebSocketServerLibrary, WebSocket } from 'ws';
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
                console.error(`✗ WebSocket port ${port} is already in use`);
                process.exit(1);
            }
            console.error('✗ WebSocket Server error:', error);
            process.exit(1);
        });
        this.#wss.on('listening', () => {
            console.log(`✓ WebSocket Server listening on ${host}:${port}`);
        });
        this.#wss.on('connection', (ws) => {
            console.log('Client connected');
            ws.send(WebSocketMessageFormatter.format('ws:connected', {
                message: 'WebSocket connection established'
            }));
            ws.on('message', async (message) => {
                if (message.indexOf("ws:ping") !== -1) {
                    ws.send(WebSocketMessageFormatter.format('ws:pong', {}));
                    return;
                }
                try {
                    const messageString = message.toString();
                    const parsed = WebSocketMessageFormatter.parse(messageString);
                    if (!parsed) {
                        ws.send(WebSocketMessageFormatter.format('ws:error', {
                            error: 'Invalid message format'
                        }));
                        return;
                    }
                    this.emit('message', parsed);
                }
                catch (error) {
                    console.error('Message handling error:', error);
                    ws.send(WebSocketMessageFormatter.format('ws:error', {
                        error: error.message
                    }));
                }
            });
            ws.on('close', () => {
                console.log('Client disconnected.');
            });
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
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
                    console.error('Broadcast send error:', error);
                }
            }
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            if (this.#wss) {
                this.#wss.close((error) => {
                    if (error) {
                        console.error('✗ Error closing WebSocket Server:', error);
                        reject(error);
                    }
                    else {
                        console.log('✓ WebSocket Server closed');
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