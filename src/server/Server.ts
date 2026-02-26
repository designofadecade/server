import Http, { IncomingMessage, ServerResponse } from 'http';

interface ServerOptions {
    port?: number;
    host?: string;
}

export default class Server {

    #server: Http.Server | null = null;

    #initPort: number = 3000;
    #initHost: string = '0.0.0.0';
    #requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

    constructor({ port = 3000, host = '0.0.0.0' }: ServerOptions = {}, requestHandler: (req: IncomingMessage, res: ServerResponse) => void) {

        // Validate port
        if (isNaN(port) || port < 1 || port > 65535) {
            throw new Error(`Port ${port} is invalid. Must be between 1 and 65535.`);
        }

        // Validate request handler
        if (typeof requestHandler !== 'function') {
            throw new Error('Request handler must be a function');
        }

        this.#initPort = port;
        this.#initHost = host;
        this.#requestHandler = requestHandler;

        this.#start();

    }

    get server(): Http.Server | null {
        return this.#server;
    }

    #start(): void {

        this.#server = Http.createServer(this.#requestHandler!);

        // Attach error handler before listen to avoid race conditions
        this.#server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`✗ Port ${this.#initPort} is already in use`);
                process.exit(1);
            }
            console.error('✗ HTTP Server error:', error);
            process.exit(1);
        });

        this.#server.listen(this.#initPort, this.#initHost, () => {
            console.log(`✓ HTTP Server listening on ${this.#initHost}:${this.#initPort}`);
        });

    }

    close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.#server) {
                this.#server.close((error?: Error) => {
                    if (error) {
                        console.error('✗ Error closing HTTP Server:', error);
                        reject(error);
                    } else {
                        console.log('✓ HTTP Server closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

}
