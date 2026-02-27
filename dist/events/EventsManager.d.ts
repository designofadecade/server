/**
 * WebSocket event management system
 *
 * Manages WebSocket event handlers and message broadcasting.
 * Integrates with WebSocketServer to handle incoming messages
 * and provides organized event handling through Events classes.
 *
 * @class EventsManager
 * @example
 * const eventsManager = new EventsManager({
 *     registerWebSocketServer: wss,
 *     initEvents: [UserEvents, ChatEvents]
 * });
 *
 * // Broadcast to all connected clients
 * eventsManager.broadcast('notification', { message: 'Hello!' });
 *
 * @example
 * // Register individual events
 * eventsManager.registerEvents([
 *     { type: 'ping', handler: async (msg) => console.log('Ping!') },
 *     { type: 'update', handler: async (msg) => handleUpdate(msg) }
 * ]);
 */
import type Events from './Events.js';
interface ParsedMessage {
  id?: string;
  type: string;
  payload: any;
}
interface EventsManagerOptions {
  registerWebSocketServer?: any;
  initEvents?: (new (manager: EventsManager) => Events)[];
}
export default class EventsManager {
  #private;
  constructor({ registerWebSocketServer, initEvents }?: EventsManagerOptions);
  registerEvents(
    events: {
      type: string;
      handler: (parsedMessage: ParsedMessage) => void | Promise<void>;
    }[]
  ): void;
  broadcast(type: string, message: any): void;
  close(): void;
}
export {};
//# sourceMappingURL=EventsManager.d.ts.map
