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
    registerEvents(events: {
        type: string;
        handler: (parsedMessage: ParsedMessage) => void | Promise<void>;
    }[]): void;
    broadcast(type: string, message: any): void;
    close(): void;
}
export {};
//# sourceMappingURL=EventsManager.d.ts.map