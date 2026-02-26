import { EventEmitter } from 'events';
interface WebSocketServerOptions {
    port?: number;
    host?: string;
}
export default class WebSocketServer extends EventEmitter {
    #private;
    constructor({ port, host }?: WebSocketServerOptions);
    get clientCount(): number;
    broadcast(message: string): void;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=WebSocketServer.d.ts.map