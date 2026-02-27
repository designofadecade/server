/**
 * Local development utilities for Lambda handlers
 *
 * Provides utilities to run AWS Lambda handlers locally using a Node.js server.
 * Converts HTTP requests to Lambda event format and responses back to HTTP.
 *
 * @class Local
 * @example
 * // Wrap your Lambda handler for local development
 * import { handler } from './lambda/handler.js';
 * import Local from '@designofadecade/local';
 *
 * const localHandler = Local.LambdaProxyRouter(handler, {
 *     requestContext: { stage: 'dev' }
 * });
 *
 * // Use with Node.js http server
 * http.createServer((req, res) => {
 *     localHandler.request(req, res);
 * }).listen(3000);
 */
import type { IncomingMessage, ServerResponse } from 'http';
interface LambdaProxyRouterOptions {
  requestContext?: Record<string, unknown>;
  event?: Record<string, unknown>;
}
interface LambdaEvent {
  rawPath: string;
  headers: Record<string, string | string[] | undefined>;
  queryStringParameters: Record<string, string>;
  cookies: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
    authorizer: unknown;
    [key: string]: unknown;
  };
  body: string | null;
  [key: string]: unknown;
}
interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}
export default class Local {
  /**
   * Lambda proxy router for local development
   *
   * Creates a router that wraps AWS Lambda handlers and allows them to be
   * run locally with a Node.js HTTP server. Automatically converts between
   * HTTP requests and Lambda event format.
   *
   * @param {Function} LambdaHandler - AWS Lambda handler function
   * @param {Object} options - Configuration options
   * @param {Object} options.requestContext - Additional requestContext fields for Lambda event
   * @param {Object} options.event - Additional event fields for Lambda event
   * @returns {Object} Object with request method for handling HTTP requests
   *
   * @example
   * const handler = Local.LambdaProxyRouter(
   *     async (event) => {
   *         return {
   *             statusCode: 200,
   *             body: JSON.stringify({ message: 'Hello!' })
   *         };
   *     },
   *     { requestContext: { stage: 'local' } }
   * );
   */
  static LambdaProxyRouter(
    LambdaHandler: (event: LambdaEvent) => Promise<LambdaResponse>,
    options?: LambdaProxyRouterOptions
  ): {
    request: (
      req: IncomingMessage,
      res: ServerResponse,
      requestOptions?: {
        requestContext?: Record<string, unknown>;
        event?: Record<string, unknown>;
      }
    ) => Promise<void>;
  };
}
export {};
//# sourceMappingURL=Local.d.ts.map
