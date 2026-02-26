import WebSocketMessageFormatter from '../websocket/WebSocketMessageFormatter.js';
export default class EventsManager {
    #wss;
    #events = new Map();
    #messageListener = null;
    constructor({ registerWebSocketServer = null, initEvents = [] } = {}) {
        if (Array.isArray(initEvents) && initEvents.length > 0)
            this.registerEvents(initEvents.map(EventClass => new EventClass(this).managerEvents).flat());
        if (registerWebSocketServer)
            this.#registerWebSocketServer(registerWebSocketServer);
    }
    registerEvents(events) {
        if (!Array.isArray(events)) {
            throw new Error('Events must be an array');
        }
        events.forEach(event => {
            // Validate event structure
            if (!event || !event.type || typeof event.handler !== 'function') {
                console.warn('Invalid event registration:', event);
                return;
            }
            if (!this.#events.has(event.type)) {
                this.#events.set(event.type, []);
            }
            this.#events.get(event.type).push(event.handler);
        });
    }
    broadcast(type, message) {
        if (!this.#wss) {
            console.warn('Cannot broadcast: WebSocket server not registered');
            return;
        }
        if (typeof type !== 'string') {
            throw new Error('Broadcast type must be a string');
        }
        try {
            this.#wss.broadcast(WebSocketMessageFormatter.format(type, message));
        }
        catch (error) {
            console.error('Broadcast error:', error);
        }
    }
    #registerWebSocketServer(wss) {
        this.#wss = wss;
        this.#messageListener = async (parsedMessage) => {
            try {
                // Message is already parsed from WebSocketServer
                console.log('Received message:', parsedMessage);
                if (this.#events.has(parsedMessage.type)) {
                    const handlers = this.#events.get(parsedMessage.type);
                    // Execute handlers with proper error handling
                    await Promise.allSettled(handlers.map(handler => handler(parsedMessage))).then(results => {
                        results.forEach((result, index) => {
                            if (result.status === 'rejected') {
                                console.error(`Handler ${index} failed:`, result.reason);
                            }
                        });
                    });
                    return;
                }
                console.warn(`No handlers registered for event type: ${parsedMessage.type}`);
            }
            catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        };
        wss.on('message', this.#messageListener);
    }
    close() {
        // Cleanup
        if (this.#wss && this.#messageListener) {
            this.#wss.off('message', this.#messageListener);
        }
        this.#events.clear();
        console.log('✓ Events manager closed');
    }
}
//# sourceMappingURL=EventsManager.js.map