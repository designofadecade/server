import Http, { IncomingMessage, ServerResponse } from 'http';
interface ServerOptions {
  port?: number;
  host?: string;
}
/**
 * HTTP Server wrapper with Node.js http module
 *
 * Provides a simple HTTP server with automatic error handling,
 * port validation, and graceful shutdown capabilities.
 *
 * @class Server
 * @example
 * const server = new Server({ port: 3000 }, (req, res) => {
 *   res.end('Hello World');
 * });
 *
 * // Graceful shutdown
 * await server.close();
 */
export default class Server {
  #private;
  constructor(
    { port, host }: ServerOptions | undefined,
    requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  );
  get server(): Http.Server | null;
  close(): Promise<void>;
}
export {};
//# sourceMappingURL=Server.d.ts.map
