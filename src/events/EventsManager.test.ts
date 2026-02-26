import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import EventsManager from './EventsManager.ts';
import Events from './Events.ts';

describe('EventsManager', () => {
    let eventsManager;
    let mockWss;

    beforeEach(() => {
        mockWss = {
            broadcast: vi.fn(),
            on: vi.fn(),
            off: vi.fn()
        };
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (eventsManager) {
            eventsManager.close();
        }
    });

    describe('Constructor', () => {
        it('should create an EventsManager instance with no options', () => {
            eventsManager = new EventsManager();
            expect(eventsManager).toBeInstanceOf(EventsManager);
        });

        it('should initialize with event classes', () => {
            class TestEvents extends Events {
                constructor(manager) {
                    super(manager);
                    this.addListener('test:event', () => { });
                }
            }

            eventsManager = new EventsManager({
                initEvents: [TestEvents]
            });

            expect(eventsManager).toBeInstanceOf(EventsManager);
        });

        it('should register WebSocket server if provided', () => {
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            expect(mockWss.on).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should handle empty initEvents array', () => {
            eventsManager = new EventsManager({ initEvents: [] });
            expect(eventsManager).toBeInstanceOf(EventsManager);
        });
    });

    describe('registerEvents', () => {
        beforeEach(() => {
            eventsManager = new EventsManager();
        });

        it('should register valid events', () => {
            const handler = vi.fn();
            eventsManager.registerEvents([
                { type: 'test:event', handler }
            ]);

            // No error should be thrown
            expect(eventsManager).toBeInstanceOf(EventsManager);
        });

        it('should register multiple events', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventsManager.registerEvents([
                { type: 'event1', handler: handler1 },
                { type: 'event2', handler: handler2 }
            ]);

            expect(eventsManager).toBeInstanceOf(EventsManager);
        });

        it('should throw error if events is not an array', () => {
            expect(() => {
                eventsManager.registerEvents('not an array');
            }).toThrow('Events must be an array');
        });

        it('should throw error if events is null', () => {
            expect(() => {
                eventsManager.registerEvents(null);
            }).toThrow('Events must be an array');
        });

        it('should throw error if events is undefined', () => {
            expect(() => {
                eventsManager.registerEvents(undefined);
            }).toThrow('Events must be an array');
        });

        it('should warn and skip invalid event (missing type)', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const handler = vi.fn();

            eventsManager.registerEvents([
                { handler }  // missing type
            ]);

            expect(consoleSpy).toHaveBeenCalledWith('Invalid event registration:', { handler });
            consoleSpy.mockRestore();
        });

        it('should warn and skip invalid event (missing handler)', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            eventsManager.registerEvents([
                { type: 'test:event' }  // missing handler
            ]);

            expect(consoleSpy).toHaveBeenCalledWith('Invalid event registration:', { type: 'test:event' });
            consoleSpy.mockRestore();
        });

        it('should warn and skip invalid event (handler not a function)', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            eventsManager.registerEvents([
                { type: 'test:event', handler: 'not a function' }
            ]);

            expect(consoleSpy).toHaveBeenCalledWith('Invalid event registration:', { type: 'test:event', handler: 'not a function' });
            consoleSpy.mockRestore();
        });

        it('should register multiple handlers for the same event type', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventsManager.registerEvents([
                { type: 'test:event', handler: handler1 },
                { type: 'test:event', handler: handler2 }
            ]);

            expect(eventsManager).toBeInstanceOf(EventsManager);
        });
    });

    describe('broadcast', () => {
        it('should broadcast message when WebSocket server is registered', () => {
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            eventsManager.broadcast('test:event', { data: 'test' });

            expect(mockWss.broadcast).toHaveBeenCalledWith(expect.stringContaining('test:event'));
        });

        it('should warn if WebSocket server is not registered', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            eventsManager = new EventsManager();

            eventsManager.broadcast('test:event', { data: 'test' });

            expect(consoleSpy).toHaveBeenCalledWith('Cannot broadcast: WebSocket server not registered');
            consoleSpy.mockRestore();
        });

        it('should throw error if type is not a string', () => {
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            expect(() => {
                eventsManager.broadcast(123, { data: 'test' });
            }).toThrow('Broadcast type must be a string');
        });

        it('should handle broadcast errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockWss.broadcast = vi.fn(() => {
                throw new Error('Broadcast failed');
            });

            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            eventsManager.broadcast('test:event', { data: 'test' });

            expect(consoleSpy).toHaveBeenCalledWith('Broadcast error:', expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('WebSocket message handling', () => {
        it('should handle incoming WebSocket messages', async () => {
            const handler = vi.fn();
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            eventsManager.registerEvents([
                { type: 'test:event', handler }
            ]);

            // Get the registered message listener
            const messageListener = mockWss.on.mock.calls.find(call => call[0] === 'message')[1];

            // Simulate message reception
            await messageListener({ type: 'test:event', payload: { data: 'test' } });

            expect(handler).toHaveBeenCalledWith({ type: 'test:event', payload: { data: 'test' } });
        });

        it('should warn if no handlers registered for event type', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            const messageListener = mockWss.on.mock.calls.find(call => call[0] === 'message')[1];
            await messageListener({ type: 'unknown:event', payload: {} });

            expect(consoleSpy).toHaveBeenCalledWith('No handlers registered for event type: unknown:event');
            consoleSpy.mockRestore();
        });

        it('should handle handler errors gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const handler = vi.fn(() => {
                throw new Error('Handler error');
            });

            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            eventsManager.registerEvents([
                { type: 'test:event', handler }
            ]);

            const messageListener = mockWss.on.mock.calls.find(call => call[0] === 'message')[1];
            await messageListener({ type: 'test:event', payload: {} });

            expect(handler).toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should execute all handlers for an event type', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            eventsManager.registerEvents([
                { type: 'test:event', handler: handler1 },
                { type: 'test:event', handler: handler2 }
            ]);

            const messageListener = mockWss.on.mock.calls.find(call => call[0] === 'message')[1];
            await messageListener({ type: 'test:event', payload: {} });

            expect(handler1).toHaveBeenCalled();
            expect(handler2).toHaveBeenCalled();
        });
    });

    describe('close', () => {
        it('should clean up resources', () => {
            eventsManager = new EventsManager({
                registerWebSocketServer: mockWss
            });

            const handler = vi.fn();
            eventsManager.registerEvents([
                { type: 'test:event', handler }
            ]);

            eventsManager.close();

            expect(mockWss.off).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should handle close without WebSocket server', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            eventsManager = new EventsManager();

            eventsManager.close();

            expect(consoleSpy).toHaveBeenCalledWith('✓ Events manager closed');
            consoleSpy.mockRestore();
        });
    });
});
