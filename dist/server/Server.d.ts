import Http, { IncomingMessage, ServerResponse } from 'http';
interface ServerOptions {
    port?: number;
    host?: string;
}
export default class Server {
    #private;
    constructor({ port, host }: ServerOptions | undefined, requestHandler: (req: IncomingMessage, res: ServerResponse) => void);
    get server(): Http.Server | null;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=Server.d.ts.map