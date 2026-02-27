/**
 * Event handler registration for EventsManager
 *
 * Abstract base class for organizing event handlers. Extend this class
 * to group related WebSocket event handlers together and register them
 * with the EventsManager.
 *
 * @class Events
 * @example
 * class ChatEvents extends Events {
 *     constructor(manager: EventsManager) {
 *         super(manager);
 *
 *         this.addListener('chat:message', async (msg) => {
 *             console.log('Received message:', msg.payload);
 *             manager.broadcast('chat:new', msg.payload);
 *         });
 *     }
 * }
 *
 * // Register with EventsManager
 * const eventsManager = new EventsManager({
 *     registerWebSocketServer: wss,
 *     initEvents: [ChatEvents]
 * });
 */
interface EventRegistration {
  type: string;
  handler: (parsedMessage: any) => void | Promise<void>;
}
export default class Events {
  #private;
  /**
   * Array of nested event classes to register
   * @type {Array}
   */
  static register: (new (manager: any) => Events)[];
  constructor(manager: any);
  get managerEvents(): EventRegistration[];
  /**
   * Returns the events manager instance
   */
  get manager(): any;
  /**
   * Adds an event listener
   * @param {string} type - Event type to listen for
   * @param {Function} handler - Handler function to execute
   */
  addListener(type: string, handler: (parsedMessage: any) => void | Promise<void>): void;
}
export {};
//# sourceMappingURL=Events.d.ts.map
