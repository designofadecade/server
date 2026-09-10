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

/**
 * The structured response a handler may return, shaped as API Gateway HTTP API
 * (payload format 2.0) accepts it.
 *
 * Return types are checked covariantly, so this has to be a type AWS's own
 * `APIGatewayProxyStructuredResultV2` is assignable *to*. That forces two
 * fields wider than they look:
 *
 * - `statusCode` is optional, because format 2.0 infers `200` when a handler
 *   omits it. Declaring it required rejected every handler typed with the AWS
 *   result type.
 * - header values are `string | number | boolean`, which is what AWS permits.
 *   `Record<string, string>` was a second rejection hiding behind the first —
 *   TypeScript only reports the earliest mismatched property, so fixing
 *   `statusCode` alone would just have moved the error one field over.
 *
 * `LambdaProxyRouter` accepts `LambdaResponse | string`; see there for the bare
 * string return format 2.0 also permits.
 */
export interface LambdaResponse {
  statusCode?: number;
  headers?: Record<string, string | number | boolean>;
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
    LambdaHandler: (event: LambdaEvent) => Promise<LambdaResponse | string>,
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

                const result: LambdaResponse | string = await LambdaHandler({
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

                // Format 2.0 lets a handler skip the response envelope: return
                // anything without a `statusCode` and API Gateway infers
                // `200`, a JSON content type, and the return value itself as
                // the body. `APIGatewayProxyResultV2` permits a bare string for
                // exactly this reason, so local dev has to infer the same way
                // or a conforming handler silently loses its body here.
                if (typeof result !== 'object' || result === null || result.statusCode == null) {
                  return {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                    body: typeof result === 'string' ? result : JSON.stringify(result),
                    isBase64Encoded: false,
                  };
                }

                // AWS permits numeric and boolean header values; Node's
                // `setHeader` does not accept booleans, and the router types
                // headers as strings, so collapse them here. `set-cookie` is
                // matched case-insensitively because header names are.
                const responseHeaders: Record<string, string | string[]> = {};
                const setCookie: string[] = [];

                for (const [name, value] of Object.entries(result.headers ?? {})) {
                  if (name.toLowerCase() === 'set-cookie') {
                    setCookie.push(String(value));
                    continue;
                  }
                  responseHeaders[name] = String(value);
                }

                // API Gateway emits every entry of the format 2.0 `cookies`
                // field as its own `set-cookie` header. Discarding it meant a
                // handler's cookies — sessions, auth — silently vanished
                // locally while working deployed.
                setCookie.push(...(result.cookies ?? []));
                if (setCookie.length > 0) responseHeaders['set-cookie'] = setCookie;

                // The body is passed through byte for byte, as API Gateway
                // does. Decoding JSON here and letting the router re-encode it
                // was a no-op for compact JSON and a silent rewrite for
                // everything else: indentation collapsed, `\uXXXX` escapes were
                // expanded and number formatting was normalised, so what a
                // developer saw locally was not what the deployed API sends.
                return {
                  status: result.statusCode,
                  headers: responseHeaders,
                  body: result.body ?? null,
                  isBase64Encoded: result.isBase64Encoded || false,
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
