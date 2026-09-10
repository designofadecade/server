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

import Router from '../router/Router.js';
import Routes from '../router/Routes.js';
import type { RouterRequest, RouterResponse } from '../router/Router.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'node:crypto';

interface LambdaProxyRouterOptions {
  requestContext?: Record<string, unknown>;
  event?: Record<string, unknown>;
}

/**
 * The event `LambdaProxyRouter` synthesises, shaped as an API Gateway HTTP API
 * (payload format 2.0) event.
 *
 * Every field AWS marks required is present, because the wrapped handler is
 * usually typed with `APIGatewayProxyEventV2` from `@types/aws-lambda` and
 * function parameters are checked contravariantly: this type has to be
 * assignable *to* AWS's, not merely resemble it. It previously omitted
 * `version`, `routeKey`, `rawQueryString` and `isBase64Encoded`, so passing a
 * conventionally typed handler was a type error.
 */
export interface LambdaEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  /**
   * API Gateway v2 collapses repeated headers into one comma-joined string, so
   * these are `string`, not Node's `string | string[]`. Emitting Node's shape
   * made local dev diverge from deployed behaviour and made this type
   * unassignable to `APIGatewayProxyEventV2`.
   */
  headers: Record<string, string | undefined>;
  queryStringParameters: Record<string, string>;
  /**
   * API Gateway v2 sends cookies as `["name=value", ...]`, not as an object.
   * Emitting an object here meant a wrapped `Router.lambdaEvent` handler ran
   * its array guard, found a non-array, and silently discarded every cookie.
   */
  cookies: string[];
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
    authorizer: unknown;
    [key: string]: unknown;
  };
  /**
   * Omitted when there is no body. API Gateway leaves the field out rather than
   * sending `null`, and AWS's type says `string | undefined` accordingly.
   */
  body?: string;
  isBase64Encoded: boolean;
  [key: string]: unknown;
}

export interface LambdaResponse {
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
    options: LambdaProxyRouterOptions = {}
  ) {
    const router = new Router({
      initRoutes: [
        class LocalRoutes extends Routes {
          constructor(router: Router) {
            super(router);

            this.addRoute(
              '*',
              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
              async (request: RouterRequest): Promise<RouterResponse> => {
                const lambdaOptions =
                  (request.lambdaOptions as {
                    requestContext?: Record<string, unknown>;
                    event?: Record<string, unknown>;
                  }) || {};

                const rawQueryString = new URLSearchParams(request.query).toString();
                const now = new Date();

                // Match API Gateway, which joins repeated headers with ", ".
                const headers: Record<string, string | undefined> = {};
                for (const [name, value] of Object.entries(request.headers)) {
                  headers[name] = Array.isArray(value) ? value.join(', ') : value;
                }

                const LambdaResponse: LambdaResponse = await LambdaHandler({
                  version: '2.0',
                  routeKey: `${request.method} ${request.path}`,
                  rawPath: request.path,
                  rawQueryString,
                  headers,
                  queryStringParameters: request.query,
                  // API Gateway v2 wire format: an array of "name=value" pairs.
                  cookies: Object.entries(request.cookies).map(
                    ([name, value]) => `${name}=${value}`
                  ),
                  requestContext: {
                    // Placeholders for the fields API Gateway would populate.
                    // They exist so a handler typed with the real AWS event can
                    // read them without an undefined surprise; override any of
                    // them via the `requestContext` option.
                    accountId: 'local',
                    apiId: 'local',
                    domainName: headers.host ?? 'localhost',
                    domainPrefix: (headers.host ?? 'localhost').split('.')[0] ?? 'localhost',
                    http: {
                      method: request.method,
                      path: request.path,
                      protocol: 'HTTP/1.1',
                      sourceIp: headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '127.0.0.1',
                      userAgent: headers['user-agent'] ?? '',
                    },
                    requestId: randomUUID(),
                    routeKey: `${request.method} ${request.path}`,
                    stage: '$default',
                    time: now.toISOString(),
                    timeEpoch: now.getTime(),
                    authorizer: request.authorizer || null,
                    ...(lambdaOptions.requestContext || {}),
                  } as LambdaEvent['requestContext'],
                  body: request.body ? JSON.stringify(request.body) : undefined,
                  isBase64Encoded: false,
                  ...(lambdaOptions.event || {}),
                });

                let body = LambdaResponse.body || null;
                if (
                  LambdaResponse.headers?.['content-type']?.includes('application/json') &&
                  body
                ) {
                  try {
                    body = JSON.parse(body);
                  } catch {
                    // Silently fail if body is not valid JSON
                  }
                }

                // Note: Lambda cookies are handled via Set-Cookie headers, not separate cookies property
                return {
                  status: LambdaResponse.statusCode,
                  headers: LambdaResponse.headers,
                  body: body,
                  isBase64Encoded: LambdaResponse.isBase64Encoded || false,
                };
              }
            );
          }
        },
      ],
    });

    return {
      request: (
        req: IncomingMessage,
        res: ServerResponse,
        requestOptions: {
          requestContext?: Record<string, unknown>;
          event?: Record<string, unknown>;
        } = {}
      ) => {
        return router.nodeJSRequest(req, res, {
          cors: true,
          lambdaOptions: {
            requestContext: {
              ...options.requestContext,
              ...requestOptions.requestContext,
            },
            event: {
              ...options.event,
              ...requestOptions.event,
            },
          },
        });
      },
    };
  }
}
