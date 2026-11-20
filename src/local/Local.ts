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
   *
   * Except with `true`, a cross-origin request that is not GET (HEAD and
   * OPTIONS preflights included) from an origin the mode does not allow is
   * refused with 403 `CROSS_ORIGIN_FORBIDDEN` before the handler runs: the
   * default and `false` allow loopback origins (any port, so any other local
   * app can write too), `string[]` allows listed origins and same-origin
   * requests (with `allowedHosts: true`, same-origin counts only for a
   * loopback Origin). A request with no `Origin` and no `Sec-Fetch-Site`
   * passes (curl, server-to-server) unless it looks like an older browser's
   * form post: a form `Content-Type` (`application/x-www-form-urlencoded`,
   * `multipart/form-data`, `text/plain`), or a body with no `Content-Type`.
   * Only GET is exempt: a cross-site GET still runs (only reading the reply
   * is blocked), so GET routes must not have side effects.
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
 * Whether a request is same-origin with the backend it reached. A browser's
 * `Sec-Fetch-Site` is authoritative when present; otherwise the Origin's host
 * must equal the Host header. Mirrors the router's same-origin test.
 *
 * With the Host check off (`allowedHosts: true`) neither signal can be
 * trusted for a non-loopback Origin: a DNS-rebinding page is same-origin with
 * the backend as far as its browser knows, and its Origin host equals the Host
 * it sends. Only a loopback Origin can then count as same-origin.
 */
function isSameOriginRequest(req: IncomingMessage, origin: string, hostCheckOff: boolean): boolean {
  if (hostCheckOff && !isLoopbackOrigin(origin)) return false;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite !== undefined) return fetchSite === 'same-origin';
  const host = req.headers.host;
  if (typeof host !== 'string' || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Request body types a page can send cross-site without a CORS preflight
 * (an HTML form, or a `no-cors` fetch). Compared on the MIME essence, as the
 * router does.
 */
const CORS_SAFELISTED_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

function isCorsSafelistedContentType(contentType: string | undefined): boolean {
  if (typeof contentType !== 'string') return false;
  const essence = contentType.split(';', 1)[0].trim().toLowerCase();
  return CORS_SAFELISTED_CONTENT_TYPES.has(essence);
}

function hasRequestBody(req: IncomingMessage): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const length = req.headers['content-length'];
  return length !== undefined && length.trim() !== '0';
}

/**
 * Whether a state-changing (non-GET) request comes from a site that may not
 * write to the local backend. Only GET is exempt: a cross-site HEAD runs the
 * handler just as a POST does, so it is checked too.
 *
 * - default / `cors: false`: loopback origins may write, nothing else.
 * - `cors: string[]`: listed origins, or a same-origin request (with
 *   `allowedHosts: true`, same-origin only for a loopback Origin).
 *
 * A browser that sends `Origin` or a cross-site `Sec-Fetch-Site` is judged by
 * them. With neither header (curl, a server-side client, but also an older
 * browser posting a cross-site form) the request passes only when it could
 * not be a form post: a body typed as something a form cannot send
 * (`application/json`), or no body and no `Content-Type` at all.
 */
function isForbiddenCrossOriginWrite(
  req: IncomingMessage,
  cors: false | string[],
  hostCheckOff: boolean
): boolean {
  if (req.method === 'GET') return false;
  const rawOrigin = req.headers.origin;
  const origin = typeof rawOrigin === 'string' ? rawOrigin : undefined;
  const fetchSite = req.headers['sec-fetch-site'];
  const allowed =
    origin !== undefined &&
    (Array.isArray(cors)
      ? cors.includes(origin) || isSameOriginRequest(req, origin, hostCheckOff)
      : isLoopbackOrigin(origin));
  if (origin !== undefined && !allowed) return true;
  // SECURITY (fail closed): a browser that says the request is cross-site or
  // same-site but sends no Origin we can vouch for is refused as well.
  if ((fetchSite === 'cross-site' || fetchSite === 'same-site') && !allowed) return true;
  // SECURITY (fail closed): with neither header, an older browser's
  // cross-site form post is indistinguishable from curl except by its body.
  // Form bodies (and bodies with no type, which a no-cors fetch can send)
  // are refused; a client that means it sets a non-form Content-Type.
  if (origin === undefined && fetchSite === undefined) {
    const contentType = req.headers['content-type'];
    if (isCorsSafelistedContentType(contentType)) return true;
    if (!contentType && hasRequestBody(req)) return true;
  }
  return false;
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
   * the developer's own frontend. By default other websites cannot read
   * responses (CORS is loopback-only), cannot send anything but GET
   * (403 `CROSS_ORIGIN_FORBIDDEN`), and cannot reach it by DNS rebinding
   * (403 `HOST_NOT_ALLOWED`). A cross-site GET still runs, so GET routes must
   * not have side effects. Any loopback origin on any port may write, so
   * another local app with an XSS hole can drive the proxy; list origins in
   * `cors` to narrow that. Widen the defaults deliberately.
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
        'EventFunctionProxy allowedHosts: true disables the Host check — a DNS-rebinding page can reach this local backend and read GET responses; cross-origin writes are still limited to loopback or listed cors origins',
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
              // Client-controlled: bounded so one header cannot bloat the log.
              host: typeof rawHost === 'string' ? rawHost.slice(0, 200) : rawHost,
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

        // SECURITY (CSRF): withholding CORS headers only stops another site
        // READING the response. A form post or a `no-cors` fetch from a page
        // the developer has open still reaches the handler, with the injected
        // authorizer, so a cross-origin request that is not GET from an
        // origin that is not allowed is refused before the body is read or
        // the handler runs. Preflights (OPTIONS) are refused too, so the
        // browser never sends the real request. `cors: true` is the explicit,
        // startup-warned opt-out.
        if (
          options.cors !== true &&
          isForbiddenCrossOriginWrite(req, options.cors ?? false, allowedHosts === true)
        ) {
          const origin = req.headers.origin;
          const fetchSite = req.headers['sec-fetch-site'];
          logger.warn('Rejected cross-origin request from a non-allowed origin', {
            code: 'LOCAL_CROSS_ORIGIN_BLOCKED',
            source: 'Local.EventFunctionProxy',
            // Client-controlled: bounded so one header cannot bloat the log.
            origin: typeof origin === 'string' ? origin.slice(0, 200) : undefined,
            secFetchSite: typeof fetchSite === 'string' ? fetchSite.slice(0, 32) : undefined,
            method: req.method?.slice(0, 16),
          });
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          if (options.cors === undefined) res.setHeader('Vary', 'Origin');
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'CROSS_ORIGIN_FORBIDDEN',
                message: 'Cross-origin request not allowed',
              },
            })
          );
          return Promise.resolve();
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
