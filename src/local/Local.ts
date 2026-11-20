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
 * import { Local } from '@designofadecade/server';
 *
 * const localHandler = Local.EventFunctionProxy(handler, {
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
import { logger } from '../logger/Logger.js';
import type { IncomingMessage, ServerResponse } from 'http';

export interface EventFunctionProxyOptions {
  requestContext?: Record<string, unknown>;
  event?: Record<string, unknown>;
  /**
   * Cross-origin access to the local backend.
   *
   * - omitted (default): CORS is granted only to loopback origins (`http` or
   *   `https`, host `localhost`, `*.localhost`, `127.0.0.0/8` or `[::1]`, any
   *   port). The Origin is reflected with `Vary: Origin` and no
   *   `Access-Control-Allow-Credentials`; any other origin gets no
   *   `Access-Control-Allow-Origin`.
   * - `false`: no CORS headers at all.
   * - `string[]`: the router's allowlist semantics: exact-match origins are
   *   reflected *with* `Access-Control-Allow-Credentials: true`.
   * - `true`: `Access-Control-Allow-Origin: *`. SECURITY: every website the
   *   developer visits can then call the local backend and read the
   *   responses, under whatever authorizer the proxy injects. Opt in only
   *   when nothing sensitive is reachable.
   */
  cors?: boolean | string[];
  /**
   * Host names accepted in the `Host` header, besides loopback ones.
   *
   * By default a request is refused with 403 unless its Host is `localhost`,
   * `*.localhost`, a `127.0.0.0/8` address or `[::1]`. That blocks DNS
   * rebinding, where an attacker's domain is re-pointed at 127.0.0.1 so the
   * browser treats the local backend as same-origin with the attacker page.
   * List extra names here for a LAN address or a tunnel
   * (`['192.168.1.20', 'dev.example.test']`): matched case-insensitively,
   * port ignored. `true` disables the check.
   */
  allowedHosts?: string[] | true;
}

/**
 * Normalises a Host-like value (`name`, `name:port`, `[v6]:port`) to its
 * lowercase hostname, or `null` when it does not parse as one. Anything that
 * would make `URL` read part of it as userinfo or a path is rejected first.
 */
function hostnameOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\s@/\\?#]/.test(trimmed)) return null;
  // A bare IPv6 literal (`::1`) has to be bracketed to parse as a host.
  const candidate =
    !trimmed.startsWith('[') && trimmed.split(':').length > 2 ? `[${trimmed}]` : trimmed;
  try {
    const hostname = new URL(`http://${candidate}`).hostname.toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * `localhost`, `*.localhost`, `127.0.0.0/8` or `[::1]`. Expects a hostname as
 * `URL` normalises it (lowercase, IPv4 in dotted-quad, IPv6 bracketed).
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    (hostname.endsWith('.localhost') && hostname.length > '.localhost'.length) ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === '[::1]'
  );
}

/**
 * Whether an Origin header names a loopback origin. Parsed defensively: a
 * malformed value, the opaque `null` origin, a non-http(s) scheme or anything
 * that is not exactly a serialised origin (path, userinfo, a joined pair of
 * headers) counts as not loopback.
 */
function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin !== origin) return false;
  return isLoopbackHostname(url.hostname);
}

/**
 * The event `EventFunctionProxy` synthesises, shaped as an API Gateway HTTP API
 * (payload format 2.0) event.
 *
 * Every field AWS marks required is present, because the wrapped handler is
 * usually typed with `APIGatewayProxyEventV2` from `@types/aws-lambda` and
 * function parameters are checked contravariantly: this type has to be
 * assignable *to* AWS's, not merely resemble it. It previously omitted
 * `version`, `routeKey`, `rawQueryString` and `isBase64Encoded`, so passing a
 * conventionally typed handler was a type error.
 */
export interface EventFunctionProxyEvent {
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
   * Emitting an object here meant a wrapped `Router.eventFunction` handler ran
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
 * `EventFunctionProxy` accepts `EventFunctionProxyResult | string`; see there for the bare
 * string return format 2.0 also permits.
 */
export interface EventFunctionProxyResult {
  statusCode?: number;
  headers?: Record<string, string | number | boolean>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}

export default class Local {
  /**
   * Runs a Lambda Event Function handler locally.
   *
   * Wraps a handler written for API Gateway HTTP API (payload format 2.0) so a
   * plain Node.js HTTP server can drive it. A Web Function needs none of this:
   * it already is an HTTP server and runs locally as-is. Automatically converts between
   * HTTP requests and Lambda event format.
   *
   * @param {Function} eventFunctionHandler - AWS Lambda handler function
   * @param {Object} options - Configuration options
   * @param {Object} options.requestContext - Additional requestContext fields for Lambda event
   * @param {Object} options.event - Additional event fields for Lambda event
   * @param {boolean|string[]} options.cors - Cross-origin access. Default:
   *   loopback origins only (reflected, `Vary: Origin`, no credentials).
   *   `false` sends no CORS headers, `string[]` is an exact-origin allowlist
   *   (with credentials, as the router does), `true` is a wildcard: any site
   *   the developer visits can then read the local API.
   * @param {string[]|true} options.allowedHosts - Extra `Host` names to accept
   *   (LAN address, tunnel). By default only loopback hosts are served and
   *   anything else gets 403, which blocks DNS rebinding. `true` disables the
   *   check.
   * @returns {Object} Object with request method for handling HTTP requests
   *
   * @example
   * const handler = Local.EventFunctionProxy(
   *     async (event) => {
   *         return {
   *             statusCode: 200,
   *             body: JSON.stringify({ message: 'Hello!' })
   *         };
   *     },
   *     { requestContext: { stage: 'local' } }
   * );
   *
   * SECURITY: an `authorizer` injected through `requestContext` (or derived
   * from a JWT) applies to every caller that reaches the proxy, not only to
   * the developer's own frontend. The loopback-only CORS and Host defaults
   * are what keep other websites out; widen them deliberately.
   */
  static EventFunctionProxy(
    eventFunctionHandler: (
      event: EventFunctionProxyEvent
    ) => Promise<EventFunctionProxyResult | string>,
    options: EventFunctionProxyOptions = {}
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
                const proxyOptions =
                  (request.proxyOptions as {
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

                const result: EventFunctionProxyResult | string = await eventFunctionHandler({
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
                      // The socket address, as API Gateway reports the TCP
                      // peer. The first X-Forwarded-For value is whatever the
                      // client chose to send, so it never stands in for this.
                      sourceIp: request.clientIp || '127.0.0.1',
                      userAgent: headers['user-agent'] ?? '',
                    },
                    requestId: request.requestId,
                    routeKey: `${request.method} ${request.path}`,
                    stage: '$default',
                    time: now.toISOString(),
                    timeEpoch: now.getTime(),
                    authorizer: request.authorizer || null,
                    ...(proxyOptions.requestContext || {}),
                  } as EventFunctionProxyEvent['requestContext'],
                  body: request.body ? JSON.stringify(request.body) : undefined,
                  isBase64Encoded: false,
                  ...(proxyOptions.event || {}),
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

    const allowedHosts = options.allowedHosts;

    // SECURITY: both opt-outs expose the local backend, and its injected
    // authorizer, beyond this machine's own pages. Say so once, at startup.
    if (options.cors === true) {
      logger.warn(
        'EventFunctionProxy cors: true sends Access-Control-Allow-Origin: * — any website can call this local backend and read its responses',
        { code: 'LOCAL_CORS_WILDCARD', source: 'Local.EventFunctionProxy' }
      );
    }
    if (allowedHosts === true) {
      logger.warn(
        'EventFunctionProxy allowedHosts: true disables the Host check — DNS rebinding can reach this local backend',
        { code: 'LOCAL_HOST_CHECK_DISABLED', source: 'Local.EventFunctionProxy' }
      );
    }
    const extraHosts = new Set<string>(
      Array.isArray(allowedHosts)
        ? allowedHosts
            .map((entry) => hostnameOf(entry))
            .filter((entry): entry is string => entry !== null)
        : []
    );

    return {
      request: (
        req: IncomingMessage,
        res: ServerResponse,
        requestOptions: {
          requestContext?: Record<string, unknown>;
          event?: Record<string, unknown>;
        } = {}
      ) => {
        // SECURITY (DNS rebinding): a browser sends the attacker's own name
        // as Host after re-pointing it at 127.0.0.1, so only loopback names
        // (plus any the developer listed) are served.
        if (allowedHosts !== true) {
          const rawHost = req.headers.host;
          const hostname = typeof rawHost === 'string' ? hostnameOf(rawHost) : null;
          if (!hostname || !(isLoopbackHostname(hostname) || extraHosts.has(hostname))) {
            logger.warn('Rejected request with a non-allowed Host header', {
              code: 'LOCAL_HOST_NOT_ALLOWED',
              source: 'Local.EventFunctionProxy',
              host: rawHost,
            });
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: { code: 'HOST_NOT_ALLOWED', message: 'Host not allowed' },
              })
            );
            return Promise.resolve();
          }
        }

        // Default CORS: reflect loopback origins only, without credentials.
        // The router's own modes are wildcard (`true`) or a credentialed
        // allowlist, neither of which fits, so the headers are set here and
        // the router is told to add none.
        if (options.cors === undefined) {
          res.setHeader('Vary', 'Origin');
          const origin = req.headers.origin;
          if (typeof origin === 'string' && isLoopbackOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            res.setHeader(
              'Access-Control-Allow-Headers',
              'Content-Type, Authorization, X-Requested-With'
            );
            res.setHeader('Access-Control-Max-Age', '86400');
          }
        }

        return router.nodeJSRequest(req, res, {
          cors: options.cors === undefined ? false : options.cors,
          proxyOptions: {
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
