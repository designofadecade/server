import Http from 'http';
export default class Server {
    #server = null;
    #initPort = 3000;
    #initHost = '0.0.0.0';
    #requestHandler = null;
    constructor({ port = 3000, host = '0.0.0.0' } = {}, requestHandler) {
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
    get server() {
        return this.#server;
    }
    #start() {
        this.#server = Http.createServer(this.#requestHandler);
        // Attach error handler before listen to avoid race conditions
        this.#server.on('error', (error) => {
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
    close() {
        return new Promise((resolve, reject) => {
            if (this.#server) {
                this.#server.close((error) => {
                    if (error) {
                        console.error('✗ Error closing HTTP Server:', error);
                        reject(error);
                    }
                    else {
                        console.log('✓ HTTP Server closed');
                        resolve();
                    }
                });
            }
            else {
                resolve();
            }
        });
    }
}
//# sourceMappingURL=Server.js.map