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

import WebSocketMessageFormatter from '../websocket/WebSocketMessageFormatter.js';
import { logger } from '../logger/Logger.js';
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
  #wss: any;
  #events = new Map<string, ((parsedMessage: ParsedMessage) => void | Promise<void>)[]>();
  #messageListener: ((parsedMessage: ParsedMessage) => Promise<void>) | null = null;

  constructor({ registerWebSocketServer = null, initEvents = [] }: EventsManagerOptions = {}) {
    if (Array.isArray(initEvents) && initEvents.length > 0)
      this.registerEvents(
        initEvents.map((EventClass) => new EventClass(this).managerEvents).flat()
      );

    if (registerWebSocketServer) this.#registerWebSocketServer(registerWebSocketServer);
  }

  registerEvents(
    events: { type: string; handler: (parsedMessage: ParsedMessage) => void | Promise<void> }[]
  ): void {
    if (!Array.isArray(events)) {
      throw new Error('Events must be an array');
    }

    events.forEach((event) => {
      // Validate event structure
      if (!event || !event.type || typeof event.handler !== 'function') {
        logger.warn('Invalid event registration', {
          code: 'EVENT_INVALID_REGISTRATION',
          source: 'EventsManager.registerEvents',
          event,
        });
        return;
      }

      if (!this.#events.has(event.type)) {
        this.#events.set(event.type, []);
      }

      this.#events.get(event.type)!.push(event.handler);
    });
  }

  broadcast(type: string, message: any): void {
    if (!this.#wss) {
      logger.warn('Cannot broadcast: WebSocket server not registered', {
        code: 'EVENT_NO_WEBSOCKET',
        source: 'EventsManager.broadcast',
        messageType: type,
      });
      return;
    }

    if (typeof type !== 'string') {
      throw new Error('Broadcast type must be a string');
    }

    try {
      this.#wss.broadcast(WebSocketMessageFormatter.format(type, message));
    } catch (error: any) {
      logger.error('Broadcast error', {
        code: 'EVENT_BROADCAST_ERROR',
        source: 'EventsManager.broadcast',
        messageType: type,
        error,
      });
    }
  }

  #registerWebSocketServer(wss: any): void {
    this.#wss = wss;

    this.#messageListener = async (parsedMessage: ParsedMessage) => {
      try {
        // Message is already parsed from WebSocketServer
        logger.debug('Received message', {
          source: 'EventsManager.onMessage',
          type: parsedMessage.type,
          id: parsedMessage.id,
        });

        if (this.#events.has(parsedMessage.type)) {
          const handlers = this.#events.get(parsedMessage.type)!;

          // Execute handlers with proper error handling
          await Promise.allSettled(handlers.map((handler) => handler(parsedMessage))).then(
            (results) => {
              results.forEach((result, index) => {
                if (result.status === 'rejected') {
                  logger.error('Event handler failed', {
                    code: 'EVENT_HANDLER_ERROR',
                    source: 'EventsManager.onMessage',
                    handlerIndex: index,
                    messageType: parsedMessage.type,
                    error: result.reason,
                  });
                }
              });
            }
          );
          return;
        }

        logger.warn('No handlers registered for event type', {
          code: 'EVENT_NO_HANDLERS',
          source: 'EventsManager.onMessage',
          eventType: parsedMessage.type,
        });
      } catch (error: any) {
        logger.error('Error processing WebSocket message', {
          code: 'EVENT_PROCESSING_ERROR',
          source: 'EventsManager.onMessage',
          messageType: parsedMessage.type,
          error,
        });
      }
    };

    wss.on('message', this.#messageListener);
  }

  close(): void {
    // Cleanup
    if (this.#wss && this.#messageListener) {
      this.#wss.off('message', this.#messageListener);
    }
    this.#events.clear();
    logger.info('Events manager closed', {
      source: 'EventsManager.close',
    });
  }
}
