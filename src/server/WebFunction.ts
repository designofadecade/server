import Server, { type ServerOptions } from './Server.js';
import type Router from '../router/Router.js';

export interface WebFunctionOptions extends ServerOptions {
  /**
   * CORS policy, as for `router.nodeJSRequest`. Lambda adds no CORS headers to
   * a Web Function, so the application has to. Pass an allowlist when browsers
   * send credentials; `true` is anonymous (`*`, no credentials).
   */
  cors?: boolean | string[];
}

/**
 * Entry point for an AWS Lambda Web Function — and, unchanged, for a local or
 * any other Node server.
 *
 * A Web Function is a plain HTTP server: Lambda starts the process, waits up to
 * 10 seconds for it to listen on `AWS_LAMBDA_HTTP_ENDPOINT`, forwards requests
 * over HTTP/1.1, and sends `SIGTERM` one second before stopping it. `Server`
 * handles all of that; this helper only wires a `Router` to it.
 *
 * @example
 * // index.ts — the same file runs locally (port 3000) and deployed.
 * const router = new Router({ initRoutes: [UserRoutes] });
 * const server = WebFunction.serve(router, { port: 3000, cors: ['https://app.example.com'] });
 * await server.ready;
 */
export default class WebFunction {
  static serve(router: Router, { cors, ...serverOptions }: WebFunctionOptions = {}): Server {
    // The router's limit also governs `Expect: 100-continue`, so an
    // oversized upload is refused before the client sends it.
    const options = {
      ...serverOptions,
      maxBodyBytes: serverOptions.maxBodyBytes ?? router.maxBodyBytes,
    };
    return new Server(options, (req, res) => {
      // nodeJSRequest answers every failure itself; this catch only stops a
      // bug in it from becoming an unhandled rejection that kills the
      // environment and every concurrent request in it.
      router.nodeJSRequest(req, res, { cors }).catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });
  }
}
