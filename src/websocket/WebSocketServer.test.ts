import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import WebSocketServer from './WebSocketServer.ts';
import { EventEmitter } from 'events';

// Create a shared mock that will be used by all tests
let sharedMockWss = null;

// Mock the 'ws' module
vi.mock('ws', () => {
    // Create a constructor mock that returns the shared mock
    const MockWebSocketServer = vi.fn(function () {
        // Return the shared mock instance
        return sharedMockWss;
    });

    return {
        WebSocketServer: MockWebSocketServer,
        WebSocket: {
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3
        }
    };
});

// Import after mocking
import { WebSocketServer as WebSocketServerLibraryMock, WebSocket as WebSocketMock } from 'ws';

describe('WebSocketServer', () => {
    let wsServer;
    let mockWss;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            send: vi.fn(),
            on: vi.fn(),
            readyState: WebSocketMock.OPEN
        };

        mockWss = {
            on: vi.fn(),
            clients: new Set([mockClient]),
            close: vi.fn((callback) => {
                if (callback) callback();
            })
        };

        // Set the shared mock so the constructor will return it
        sharedMockWss = mockWss;

        // Clear call history
        WebSocketServerLibraryMock.mockClear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (wsServer) {
            vi.spyOn(console, 'log').mockImplementation(() => { });
            wsServer.close().catch(() => { });
        }
        vi.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should create a WebSocketServer instance with default options', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            expect(wsServer).toBeInstanceOf(WebSocketServer);
            expect(wsServer).toBeInstanceOf(EventEmitter);
            expect(WebSocketServerLibraryMock).toHaveBeenCalledWith({ port: 8080, host: '0.0.0.0' });

            consoleSpy.mockRestore();
        });

        it('should create a WebSocketServer instance with custom port', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 9000 });

            expect(WebSocketServerLibraryMock).toHaveBeenCalledWith({ port: 9000, host: '0.0.0.0' });

            consoleSpy.mockRestore();
        });

        it('should create a WebSocketServer instance with custom host', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ host: 'localhost' });

            expect(WebSocketServerLibraryMock).toHaveBeenCalledWith({ port: 8080, host: 'localhost' });

            consoleSpy.mockRestore();
        });

        it('should create a WebSocketServer instance with custom port and host', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 9000, host: 'localhost' });

            expect(WebSocketServerLibraryMock).toHaveBeenCalledWith({ port: 9000, host: 'localhost' });

            consoleSpy.mockRestore();
        });

        it('should throw error for invalid port (too low)', () => {
            expect(() => {
                wsServer = new WebSocketServer({ port: 0 });
            }).toThrow('Port 0 is invalid. Must be between 1 and 65535.');
        });

        it('should throw error for invalid port (too high)', () => {
            expect(() => {
                wsServer = new WebSocketServer({ port: 65536 });
            }).toThrow('Port 65536 is invalid. Must be between 1 and 65535.');
        });

        it('should throw error for invalid port (negative)', () => {
            expect(() => {
                wsServer = new WebSocketServer({ port: -1 });
            }).toThrow('Port -1 is invalid. Must be between 1 and 65535.');
        });

        it('should throw error for invalid port (NaN)', () => {
            expect(() => {
                wsServer = new WebSocketServer({ port: 'invalid' });
            }).toThrow('Must be between 1 and 65535.');
        });

        it('should register error handler', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            expect(mockWss.on).toHaveBeenCalledWith('error', expect.any(Function));

            consoleSpy.mockRestore();
        });

        it('should register listening handler', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            expect(mockWss.on).toHaveBeenCalledWith('listening', expect.any(Function));

            consoleSpy.mockRestore();
        });

        it('should register connection handler', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));

            consoleSpy.mockRestore();
        });

        it('should log success message when server starts listening', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 8080, host: '0.0.0.0' });

            // Trigger listening event
            const listeningHandler = mockWss.on.mock.calls.find(call => call[0] === 'listening')[1];
            listeningHandler();

            expect(consoleSpy).toHaveBeenCalledWith('✓ WebSocket Server listening on 0.0.0.0:8080');

            consoleSpy.mockRestore();
        });

        it('should handle EADDRINUSE error', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 8080 });

            const errorHandler = mockWss.on.mock.calls.find(call => call[0] === 'error')[1];
            errorHandler({ code: 'EADDRINUSE' });

            expect(consoleSpy).toHaveBeenCalledWith('✗ WebSocket port 8080 is already in use');
            expect(exitSpy).toHaveBeenCalledWith(1);

            consoleSpy.mockRestore();
            exitSpy.mockRestore();
        });

        it('should handle generic errors', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            const errorHandler = mockWss.on.mock.calls.find(call => call[0] === 'error')[1];
            errorHandler(new Error('Generic error'));

            expect(consoleSpy).toHaveBeenCalledWith('✗ WebSocket Server error:', expect.any(Error));
            expect(exitSpy).toHaveBeenCalledWith(1);

            consoleSpy.mockRestore();
            exitSpy.mockRestore();
        });
    });

    describe('clientCount getter', () => {
        it('should return the number of connected clients', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            expect(wsServer.clientCount).toBe(1);

            consoleSpy.mockRestore();
        });

        it('should return 0 when no clients connected', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            mockWss.clients = new Set();
            wsServer = new WebSocketServer();

            expect(wsServer.clientCount).toBe(0);

            consoleSpy.mockRestore();
        });
    });

    describe('Client Connection', () => {
        it('should handle new client connections', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            const connectionHandler = mockWss.on.mock.calls.find(call => call[0] === 'connection')[1];
            const mockWs = {
                send: vi.fn(),
                on: vi.fn()
            };

            connectionHandler(mockWs);

            expect(consoleSpy).toHaveBeenCalledWith('Client connected');
            expect(mockWs.send).toHaveBeenCalled();
            expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));

            consoleSpy.mockRestore();
        });

        it('should send connection confirmation message to new clients', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            const connectionHandler = mockWss.on.mock.calls.find(call => call[0] === 'connection')[1];
            const mockWs = {
                send: vi.fn(),
                on: vi.fn()
            };

            connectionHandler(mockWs);

            expect(mockWs.send).toHaveBeenCalled();
            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ws:connected');
            expect(sentMessage.payload.message).toBe('WebSocket connection established');

            consoleSpy.mockRestore();
        });
    });

    describe('Message Handling', () => {
        let mockWs;
        let messageHandler;

        beforeEach(() => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            mockWs = {
                send: vi.fn(),
                on: vi.fn()
            };

            wsServer = new WebSocketServer();

            const connectionHandler = mockWss.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionHandler(mockWs);

            messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];

            consoleSpy.mockRestore();
        });

        it('should handle ping messages', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            await messageHandler(Buffer.from('ws:ping'));

            expect(mockWs.send).toHaveBeenCalled();
            const response = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0]);
            expect(response.type).toBe('ws:pong');

            consoleSpy.mockRestore();
        });

        it('should parse and emit valid messages', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const emitSpy = vi.spyOn(wsServer, 'emit');

            const message = JSON.stringify({
                type: 'test:event',
                payload: { data: 'test' }
            });

            await messageHandler(Buffer.from(message));

            expect(emitSpy).toHaveBeenCalledWith('message', expect.objectContaining({
                type: 'test:event',
                payload: { data: 'test' }
            }));

            consoleSpy.mockRestore();
        });

        it('should send error for invalid message format', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            await messageHandler(Buffer.from('invalid json'));

            expect(mockWs.send).toHaveBeenCalled();
            const errorMessage = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0]);
            expect(errorMessage.type).toBe('ws:error');

            consoleSpy.mockRestore();
        });

        it('should handle message handling errors', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            // Mock emit to throw error
            wsServer.emit = vi.fn(() => {
                throw new Error('Handler error');
            });

            const message = JSON.stringify({
                type: 'test:event',
                payload: {}
            });

            await messageHandler(Buffer.from(message));

            expect(mockWs.send).toHaveBeenCalled();
            const errorMessage = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0]);
            expect(errorMessage.type).toBe('ws:error');

            consoleSpy.mockRestore();
        });

        it('should handle Buffer messages', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const emitSpy = vi.spyOn(wsServer, 'emit');

            const message = JSON.stringify({
                type: 'buffer:test',
                payload: { data: 'test' }
            });

            await messageHandler(Buffer.from(message));

            expect(emitSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });

    describe('Client Disconnect', () => {
        it('should handle client disconnections', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            const connectionHandler = mockWss.on.mock.calls.find(call => call[0] === 'connection')[1];
            const mockWs = {
                send: vi.fn(),
                on: vi.fn()
            };

            connectionHandler(mockWs);

            const closeHandler = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
            closeHandler();

            expect(consoleSpy).toHaveBeenCalledWith('Client disconnected.');

            consoleSpy.mockRestore();
        });
    });

    describe('Client Errors', () => {
        it('should handle client errors', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            const connectionHandler = mockWss.on.mock.calls.find(call => call[0] === 'connection')[1];
            const mockWs = {
                send: vi.fn(),
                on: vi.fn()
            };

            connectionHandler(mockWs);

            const errorHandler = mockWs.on.mock.calls.find(call => call[0] === 'error')[1];
            errorHandler(new Error('Client error'));

            expect(consoleSpy).toHaveBeenCalledWith('WebSocket error:', expect.any(Error));

            consoleSpy.mockRestore();
        });
    });

    describe('broadcast', () => {
        it('should broadcast message to all connected clients', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            const client1 = { send: vi.fn(), readyState: WebSocket.OPEN };
            const client2 = { send: vi.fn(), readyState: WebSocket.OPEN };
            mockWss.clients = new Set([client1, client2]);

            wsServer = new WebSocketServer();

            wsServer.broadcast('test message');

            expect(client1.send).toHaveBeenCalledWith('test message');
            expect(client2.send).toHaveBeenCalledWith('test message');

            consoleSpy.mockRestore();
        });

        it('should only broadcast to clients with OPEN state', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            const client1 = { send: vi.fn(), readyState: WebSocket.OPEN };
            const client2 = { send: vi.fn(), readyState: WebSocket.CLOSED };
            const client3 = { send: vi.fn(), readyState: WebSocket.CONNECTING };
            mockWss.clients = new Set([client1, client2, client3]);

            wsServer = new WebSocketServer();

            wsServer.broadcast('test message');

            expect(client1.send).toHaveBeenCalledWith('test message');
            expect(client2.send).not.toHaveBeenCalled();
            expect(client3.send).not.toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should handle broadcast errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const client1 = {
                send: vi.fn(() => {
                    throw new Error('Send failed');
                }),
                readyState: WebSocket.OPEN
            };
            mockWss.clients = new Set([client1]);

            wsServer = new WebSocketServer();

            wsServer.broadcast('test message');

            expect(consoleSpy).toHaveBeenCalledWith('Broadcast send error:', expect.any(Error));

            consoleSpy.mockRestore();
        });

        it('should handle empty client list', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            mockWss.clients = new Set();
            wsServer = new WebSocketServer();

            wsServer.broadcast('test message');

            // Should not throw
            expect(wsServer.clientCount).toBe(0);

            consoleSpy.mockRestore();
        });
    });

    describe('close', () => {
        it('should close the WebSocket server successfully', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            await wsServer.close();

            expect(mockWss.close).toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith('✓ WebSocket Server closed');

            consoleSpy.mockRestore();
        });

        it('should handle close errors', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            mockWss.close = vi.fn((callback) => {
                callback(new Error('Close error'));
            });

            wsServer = new WebSocketServer();

            await expect(wsServer.close()).rejects.toThrow('Close error');

            expect(consoleSpy).toHaveBeenCalledWith('✗ Error closing WebSocket Server:', expect.any(Error));

            consoleSpy.mockRestore();
        });

        it('should resolve immediately if server is null', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer();

            // The close method should handle null server gracefully
            await wsServer.close();

            consoleSpy.mockRestore();
        });
    });

    describe('Port Range Validation', () => {
        it('should accept minimum valid port (1)', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 1 });

            expect(wsServer).toBeInstanceOf(WebSocketServer);

            consoleSpy.mockRestore();
        });

        it('should accept maximum valid port (65535)', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 65535 });

            expect(wsServer).toBeInstanceOf(WebSocketServer);

            consoleSpy.mockRestore();
        });

        it('should accept standard WebSocket port (8080)', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 8080 });

            expect(wsServer).toBeInstanceOf(WebSocketServer);

            consoleSpy.mockRestore();
        });

        it('should accept common development port (3001)', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            wsServer = new WebSocketServer({ port: 3001 });

            expect(wsServer).toBeInstanceOf(WebSocketServer);

            consoleSpy.mockRestore();
        });
    });
});
