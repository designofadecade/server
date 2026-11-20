import { IncomingMessage, ServerResponse } from 'http';
import { isIP } from 'node:net';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger/Logger.js';
import RouteError from './RouteError.js';
import { isCorsSafelistedContentType, isSameOriginRequest } from './origin.js';
import { RAW_BODY } from './internal.js';
import type { ContextLike } from '../context/Context.js';

/**
 * The subset of an API Gateway HTTP API (payload format 2.0) event the router
 * reads. Deliberately structural and permissive so that an event typed with
 * `APIGatewayProxyEventV2` from `@types/aws-lambda` — the documented way to
 * write a Lambda — is assignable to it without a cast.
 *
 * Note the absence of an index signature. `APIGatewayProxyEventV2` is an
 * interface, so it carries no implicit one and could never satisfy a target
 * that declared one; the router reads only the fields below, so requiring it
 * bought nothing and blocked the primary use case.
 */
export interface EventFunctionEvent {
  requestContext: {
    http: {
      method: string;
      path: string;
      /** Client address as API Gateway saw the TCP connection. */
      sourceIp?: string;
    };
    /** API Gateway's request id; becomes `request.requestId`. */
    requestId?: string;
    authorizer?: unknown;
  };
  headers: Record<string, string | string[] | undefined>;
  body?: string | null;
  /** Whether `body` is base64; used to measure its decoded size. */
  isBase64Encoded?: boolean;
  cookies?: string[];
  /**
   * API Gateway omits query parameters that were not supplied, so a lookup
   * yields `string | undefined`. This used to claim `Record<string, string>`,
   * which was both narrower than AWS's own type (making the canonical handler
   * fail to typecheck) and a misstatement of the wire format.
   */
  queryStringParameters?: Record<string, string | undefined>;
}

/** The API Gateway HTTP API (payload format 2.0) response `eventFunction` returns. */
export interface EventFunctionResult {
  statusCode: number;
  headers?: Record<string, string>;
  /**
   * Format 2.0 carries cookies here rather than in `headers`, because a header
   * map cannot hold two values under one name. API Gateway emits one
   * `set-cookie` header per entry. Present only when a route set a cookie.
   */
  cookies?: string[];
  body: string;
  isBase64Encoded?: boolean;
}

export interface RouteRegistration {
  path: string;
  methods: string[];
  pattern: URLPattern;
  handler: (request: RouterRequest) => Promise<RouterResponse>;
  middleware?: RouterMiddleware[];
}

/**
 * Constructor of a route class.
 *
 * `context` is typed `never` on purpose. TypeScript checks constructor
 * parameters contravariantly, so declaring it as `Context` rejected the very
 * pattern this package documents — a route class whose constructor narrows the
 * context to the application's own type:
 *
 * ```ts
 * class UserRoutes extends Routes {
 *   constructor(router: Router, context?: AppContext) { super(router, context); }
 * }
 * new Router({ initRoutes: [UserRoutes] }); // used to be a type error
 * ```
 *
 * `never` is assignable to every type, so any narrowing is accepted. The router
 * casts once at the single call site where it constructs these classes.
 */
export type RoutesConstructor<T = { routerRoutes: RouteRegistration[] }> = new (
  router: Router,
  context?: never
) => T;

export interface RouterRequest {
  path: string;
  method: string;
  body: unknown;
  cookies: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  /**
   * The caller's IP address, from a source that cannot be spoofed by the
   * caller in the current mode:
   *
   * - Event Function: `requestContext.http.sourceIp`, set by API Gateway.
   * - Web Function: the last `X-Forwarded-For` entry, which Lambda appends
   *   itself (earlier entries are client-supplied and ignored), or the entry
   *   `trustedProxies` hops further back when a front door such as CloudFront
   *   sits in front of the endpoint.
   * - Plain Node server: the socket's remote address. `X-Forwarded-For` is
   *   never trusted here, because nothing vouches for it.
   *
   * Empty string when no address is known.
   */
  clientIp: string;
  /**
   * An identifier for this request, for log correlation: API Gateway's request
   * id, Lambda's `lambda-web-request-id`, or a fresh UUID on a plain server.
   */
  requestId: string;
  authorizer?: unknown;
  /** Transport-specific options a proxy (see `Local`) passes to its catch-all route. */
  proxyOptions?: unknown;
  /**
   * The registered path pattern of the route that matched (`/users/:id`),
   * set by the router before middleware runs. Unset when no route matched.
   * Safe to log where the raw `path` is not: it never contains the
   * request's own values (ids, reset tokens). Optional so request objects
   * built by hand, in tests for example, need not supply it.
   */
  route?: string;
}

export interface RouterResponse {
  status?: number;
  /**
   * An array sets a repeated header. This is the only way to send more than one
   * cookie: `set-cookie` may legally appear many times and its values contain
   * commas, so they cannot be folded into one string. Each transport renders an
   * array the way that transport expects — Node repeats the header, API Gateway
   * moves `set-cookie` into the format 2.0 `cookies` field — so a route that
   * sets cookies behaves the same locally and deployed.
   */
  headers?: Record<string, string | string[]>;
  body?: unknown;
  isBase64Encoded?: boolean;
}

/** HMAC algorithms verifiable with the built-in verifier. */
export type JwtHmacAlgorithm = 'HS256' | 'HS384' | 'HS512';

export interface JwtOptions {
  /**
   * Shared secret for HMAC verification. Required unless `verify` is supplied.
   */
  secret?: string;
  /**
   * Algorithms accepted for the built-in verifier. Defaults to `['HS256']`.
   * The token's own `alg` header is only honoured if it appears here, which is
   * what prevents algorithm-confusion attacks (including `alg: none`).
   */
  algorithms?: JwtHmacAlgorithm[];
  /**
   * Custom verifier, for RS256/ES256, JWKS, or an existing JWT library.
   * Must return the decoded claims for a valid token, or `null`/throw for an
   * invalid one. Takes precedence over `secret`.
   */
  verify?: (token: string) => Promise<Record<string, unknown> | null>;
  /** Leeway in seconds applied to `exp` and `nbf`. Defaults to 0. */
  clockToleranceSec?: number;
}

export interface RouterOptions {
  /**
   * Application context handed to each route class. Any object shape is
   * accepted — see `ContextLike`; the router only passes it through.
   */
  context?: ContextLike;
  initRoutes?: RoutesConstructor[];
  bearerToken?: string | null;
  middleware?: RouterMiddleware[];
  /**
   * JWT verification for the Node.js path. When omitted, `request.authorizer`
   * is always `null` — an unverified token is never exposed.
   */
  jwt?: JwtOptions;
  /**
   * Treat Node requests as arriving through a Lambda Web Function endpoint:
   * read `clientIp` from `X-Forwarded-For` and `requestId` from
   * `lambda-web-request-id`. Defaults to whether `AWS_LAMBDA_HTTP_ENDPOINT` is
   * set. Never enable it on a server clients reach directly — those headers
   * are only trustworthy because Lambda strips and rewrites them.
   */
  webFunction?: boolean;
  /**
   * Web Function only: the number of proxies you control in front of the
   * Lambda endpoint (CloudFront in front of the endpoint = 1). Each one
   * appends the address it saw, so the client is that many entries before the
   * last. Default `0`. Has no effect on a plain server or an Event Function.
   *
   * Only safe when the endpoint cannot be reached except through those
   * proxies (for CloudFront: `IamAuth` on the endpoint, with invoke permission
   * granted only to your distribution). If clients can call the endpoint
   * directly they choose the entry this reads.
   */
  trustedProxies?: number;
  /**
   * Also write the raw request path to the router's own error log lines
   * (handler errors, 404s, request failures). Off by default: a path can
   * carry secrets (`/reset-password/<token>`) and personal data
   * (`/users/<email>`), so those lines carry only the matched route pattern
   * (`route`), and no path at all when no route matched. When on, the path is
   * logged without its query string and cut at 256 characters. Same rule as
   * `RequestLogger`'s `logPath`.
   */
  logPath?: boolean;
  /**
   * Largest request body accepted, in bytes, on both transports. Default
   * 1 MiB. A larger body is answered `413 PAYLOAD_TOO_LARGE` before any
   * middleware or route runs: on the Node path as soon as `Content-Length`
   * (or the bytes read so far) exceeds it, on the Event Function path from
   * the decoded size of `event.body`.
   */
  maxBodyBytes?: number;
}

export type RouterMiddleware = (request: RouterRequest) => Promise<RouterResponse | void>;

/** A request body over `maxBodyBytes`; answered 413 by `nodeJSRequest`. */
class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

/** The client went away before its request body was complete. */
class ClientAbortedError extends Error {
  constructor() {
    super('Client aborted the request');
    this.name = 'ClientAbortedError';
  }
}

/**
 * Connections that were answered 413 and are being closed. Node keeps parsing
 * what arrives on them, so a request pipelined behind the refused body would
 * otherwise still reach a route — on a connection already told
 * `Connection: close`.
 */
const refusedConnections = new WeakSet<object>();

export default class Router {
  static MethodsWithBody = ['POST', 'PUT', 'PATCH'];
  static #MAX_CACHE_SIZE = 1000;
  static #DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
  /** Most of a refused upload read (and discarded) so the 413 can land. */
  static #MAX_DRAIN_BYTES = 4 * 1024 * 1024;
  /** How long a refused upload's connection may linger before it is cut. */
  static #REFUSED_UPLOAD_LINGER_MS = 2000;

  #routes = {
    cache: new Map<string, RouteRegistration | null>(),
    static: new Map<string, RouteRegistration>(),
    dynamic: new Map<string, RouteRegistration[]>(),
  };

  #bearerToken: string | null = null;
  #jwt: JwtOptions | null = null;
  #globalMiddleware: RouterMiddleware[] = [];
  #webFunction: boolean;
  #trustedProxies: number;
  #logPath: boolean;
  #maxBodyBytes: number;

  constructor({
    context,
    initRoutes = [],
    bearerToken = null,
    middleware = [],
    jwt,
    webFunction = Boolean(process.env.AWS_LAMBDA_HTTP_ENDPOINT),
    trustedProxies = 0,
    logPath = false,
    maxBodyBytes = Router.#DEFAULT_MAX_BODY_BYTES,
  }: RouterOptions = {}) {
    if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
      throw new Error('maxBodyBytes must be a positive integer');
    }
    this.#maxBodyBytes = maxBodyBytes;
    if (!Number.isInteger(trustedProxies) || trustedProxies < 0) {
      throw new Error('trustedProxies must be a non-negative integer');
    }
    this.#webFunction = webFunction;
    this.#trustedProxies = trustedProxies;
    this.#logPath = logPath === true;
    this.#bearerToken = bearerToken;
    this.#jwt = jwt ?? null;
    this.#globalMiddleware = Array.isArray(middleware) ? middleware : [];

    if (Array.isArray(initRoutes))
      this.#buildRoutesPatterns(
        initRoutes
          // `context` is `ContextLike`; the constructor parameter is `never` so
          // that subclasses may narrow it. See `RoutesConstructor`.
          .map((RoutesClass) => new RoutesClass(this, context as never).routerRoutes)
          .flat()
          .filter((route) => route && route.path && route.handler)
      );
  }

  /**
   * The largest request body this router accepts, in bytes (`maxBodyBytes`).
   * `WebFunction.serve` passes it to `Server`, so an `Expect: 100-continue`
   * upload over the limit is refused before the client sends it.
   */
  get maxBodyBytes(): number {
    return this.#maxBodyBytes;
  }

  #buildRoutesPatterns(routes: RouteRegistration[]): void {
    for (const route of routes) {
      if (typeof route.path !== 'string' || typeof route.handler !== 'function') {
        throw new Error('Each route must have a valid path string and handler function');
      }

      // Normalize: collapse multiple slashes, remove trailing slash (except root)
      let normalizedPath = route.path.replace(/\/+/g, '/');
      normalizedPath = Router.#stripTrailingSlashes(normalizedPath);

      for (const method of route.methods) {
        const pathMethodKey = `${normalizedPath}::${method}`;

        if (this.#routes.dynamic.has(normalizedPath) || this.#routes.static.has(pathMethodKey))
          throw new Error(`Duplicate route detected: ${method} ${normalizedPath}`);

        if (
          normalizedPath.includes(':') ||
          normalizedPath.includes('*') ||
          normalizedPath.includes('(') ||
          normalizedPath.includes('[')
        ) {
          if (!this.#routes.dynamic.has(method)) this.#routes.dynamic.set(method, []);

          this.#routes.dynamic.get(method)!.push(route);
        } else {
          // Store the whole registration. Keeping only the handler silently
          // dropped route-level middleware for every static path, so a route
          // guarded by an auth middleware ran unguarded while the same guard on
          // a dynamic path worked.
          this.#routes.static.set(pathMethodKey, route);
        }
      }
    }
  }

  #findRouteHandler(
    path: string,
    method: string
  ): RouteRegistration | { handler: (request: RouterRequest) => Promise<RouterResponse> } | null {
    // Normalize path: remove trailing slash (except for root "/")
    const normalizedPath = Router.#stripTrailingSlashes(path);

    if (this.#routes.static.has(`${normalizedPath}::${method}`))
      return this.#routes.static.get(`${normalizedPath}::${method}`)!;

    if (this.#routes.cache.has(`${normalizedPath}::${method}`))
      return this.#routes.cache.get(`${normalizedPath}::${method}`)!;

    if (!this.#routes.dynamic.has(method)) return null;

    const route = this.#routes.dynamic.get(method)!.find((route) => {
      if (!route.methods.includes(method)) return false;
      if (route.path === normalizedPath) return true;
      return route.pattern?.test(normalizedPath);
    });

    this.#routes.cache.set(`${normalizedPath}::${method}`, route || null);
    this.#pruneCache();

    return route || null;
  }

  /**
   * Strip trailing slashes, keeping a lone "/" intact.
   *
   * `replace(/\/+$/, '')` looks equivalent but is quadratic: the anchored `+`
   * makes the engine retry from every index in a run of slashes, each time
   * scanning to the end before failing. A path is attacker-controlled, so a
   * request of many slashes turned into O(n^2) work on the event loop.
   */
  static #stripTrailingSlashes(path: string): string {
    let end = path.length;
    while (end > 1 && path.charCodeAt(end - 1) === 47 /* '/' */) end--;
    return end === path.length ? path : path.slice(0, end);
  }

  /** Longest raw path written to an error log line when `logPath` is on. */
  static #MAX_LOGGED_PATH = 256;

  /**
   * Log fields that identify a request without its own values: the matched
   * route pattern when known, and the raw path only when `logPath` is on
   * (query string removed, length capped). See `RouterOptions.logPath`.
   */
  #requestLogFields(path: unknown, route?: string): Record<string, string> {
    const fields: Record<string, string> = {};
    if (typeof route === 'string') fields.route = route.slice(0, Router.#MAX_LOGGED_PATH);
    if (this.#logPath && typeof path === 'string') {
      const bare = path.split('?', 1)[0];
      fields.path =
        bare.length > Router.#MAX_LOGGED_PATH
          ? `${bare.slice(0, Router.#MAX_LOGGED_PATH)}…[truncated, ${bare.length} chars]`
          : bare;
    }
    return fields;
  }

  #pruneCache(): void {
    if (this.#routes.cache.size > Router.#MAX_CACHE_SIZE) {
      const firstKey = this.#routes.cache.keys().next().value;
      if (firstKey) {
        this.#routes.cache.delete(firstKey);
      }
    }
  }

  /**
   * Handles an API Gateway HTTP API (payload format 2.0) event — the Lambda
   * Event Function model. Export it as the Lambda handler:
   *
   * ```ts
   * export const handler = (event: APIGatewayProxyEventV2) => router.eventFunction(event);
   * ```
   */
  async eventFunction(event: EventFunctionEvent): Promise<EventFunctionResult> {
    // Kept outside the try so the error log can name the matched route.
    let routerRequest: RouterRequest | undefined;
    try {
      let body = Router.MethodsWithBody.includes(event.requestContext.http.method)
        ? event.body
        : null;

      // Same limit as the Node path. API Gateway's own payload limit is far
      // higher, so without this an Event Function parsed bodies the Node
      // transport refuses.
      if (
        typeof body === 'string' &&
        Router.#eventBodyBytes(body, event.isBase64Encoded) > this.#maxBodyBytes
      ) {
        logger.warn('Refused request body over the size limit', {
          code: 'ROUTER_PAYLOAD_TOO_LARGE',
          source: 'Router.eventFunction',
          method: event.requestContext.http.method,
          maxBodyBytes: this.#maxBodyBytes,
        });
        return Router.#payloadTooLargeResult();
      }

      if (
        event.headers['content-type']?.includes('application/json') &&
        !isCorsSafelistedContentType(event.headers['content-type']) &&
        body
      ) {
        try {
          body = JSON.parse(body as string);
        } catch {
          const errorResponse = RouteError.fromError(new Error('Invalid JSON in request body'), {
            defaultMessage: 'Invalid JSON in request body',
            status: 400,
          });
          return {
            statusCode: errorResponse.status || 400,
            headers: errorResponse.headers || { 'Content-Type': 'application/json' },
            body:
              typeof errorResponse.body === 'string'
                ? errorResponse.body
                : JSON.stringify(errorResponse.body),
          };
        }
      }

      routerRequest = {
        path: event.requestContext.http.path,
        method: event.requestContext.http.method,
        body: body,
        cookies: this.#parseLambdaCookies(event.cookies || []),
        params: {},
        query: Router.#compactQuery(event?.queryStringParameters),
        headers: event.headers || {},
        clientIp: event.requestContext.http.sourceIp ?? '',
        requestId: event.requestContext.requestId || randomUUID(),
        authorizer: event.requestContext.authorizer || null,
      };
      const response = await this.#request(routerRequest);

      const { headers, cookies } = Router.#splitResponseHeaders(
        Router.#withDefaultContentType(response.headers)
      );

      return {
        statusCode: response.status || 200,
        headers,
        // Omitted rather than sent empty, so a route that sets no cookie
        // produces the same response body it always has.
        ...(cookies.length > 0 ? { cookies } : {}),
        body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
        isBase64Encoded: response.isBase64Encoded || false,
      };
    } catch (error: unknown) {
      // Catch any unhandled errors and format them consistently
      const errorResponse = RouteError.fromError(error, {
        defaultMessage: 'Request processing failed',
        status: 500,
        context: {
          source: 'Router.eventFunction',
          ...this.#requestLogFields(event.requestContext?.http?.path, routerRequest?.route),
          method: event.requestContext?.http?.method,
        },
      });
      return {
        statusCode: errorResponse.status || 500,
        headers: errorResponse.headers || { 'Content-Type': 'application/json' },
        body:
          typeof errorResponse.body === 'string'
            ? errorResponse.body
            : JSON.stringify(errorResponse.body),
      };
    }
  }

  async nodeJSRequest(
    req: IncomingMessage,
    res: ServerResponse,
    options: { cors?: boolean | string[]; proxyOptions?: Record<string, unknown> } = {}
  ): Promise<void> {
    const { cors, proxyOptions } = options;
    const rawBody = (options as { [RAW_BODY]?: unknown })[RAW_BODY] === true;

    // SECURITY: a request pipelined behind a refused upload is never served;
    // its connection is already closing.
    if (req.socket && refusedConnections.has(req.socket)) {
      req.resume?.();
      return;
    }

    if (cors) {
      // SECURITY: Reflecting an arbitrary Origin alongside
      // Access-Control-Allow-Credentials lets any site make cookie-authenticated
      // cross-origin calls and read the response. Credentials are therefore only
      // granted to origins on an explicit allowlist; `cors: true` falls back to
      // an anonymous wildcard, which browsers already refuse to pair with
      // credentials.
      const requestOrigin = req.headers.origin;
      let forbiddenOrigin = false;

      if (Array.isArray(cors)) {
        // Vary on Origin so caches never serve one origin's response to another.
        res.setHeader('Vary', 'Origin');
        if (requestOrigin && cors.includes(requestOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', requestOrigin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else if (requestOrigin && !isSameOriginRequest(req.headers, requestOrigin)) {
          forbiddenOrigin = true;
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }

      if (forbiddenOrigin) {
        // SECURITY: Withholding CORS headers only stops the other site
        // READING the response. A form post or a `no-cors` fetch still
        // reaches the route with the visitor's cookies, so anything but GET
        // from an origin off the allowlist is refused here, before the body
        // is read or a route runs. HEAD is refused too: a HEAD route runs
        // its handler like any other, and a cross-site page has no use for a
        // HEAD it cannot read. Preflights are refused as well, so the browser
        // never sends the real request. Same rule as `Local.EventFunctionProxy`.
        const safe = req.method === 'GET';
        logger.warn('Blocked cross-origin request from non-allowlisted origin', {
          code: 'ROUTER_CORS_ORIGIN_BLOCKED',
          source: 'Router.nodeJSRequest',
          // Client-controlled: bounded so one header cannot bloat the log.
          origin: requestOrigin!.slice(0, 200),
          method: req.method?.slice(0, 16),
          rejected: !safe,
        });
        if (!safe) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'CORS_ORIGIN_FORBIDDEN',
                message: 'Cross-origin request from this origin is not allowed',
              },
            })
          );
          return;
        }
      } else {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With'
        );
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // SECURITY: A malformed Host header (e.g. 'a b') makes the URL constructor
    // throw. This used to sit outside the try below, so the rejection escaped
    // nodeJSRequest() and took the process down under Node's default
    // unhandled-rejection policy. Parse defensively and answer 400 instead.
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      logger.warn('Rejected request with unparseable URL or Host header', {
        code: 'ROUTER_INVALID_REQUEST_URL',
        source: 'Router.nodeJSRequest',
        host: req.headers.host,
      });
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request URL' },
        })
      );
      return;
    }

    // Kept outside the try so the error log can name the matched route.
    let routerRequest: RouterRequest | undefined;
    try {
      routerRequest = {
        path: requestUrl.pathname,
        method: req.method!,
        body: Router.MethodsWithBody.includes(req.method!)
          ? await this.#getNodeJSRequestBody(req, rawBody)
          : null,
        cookies: this.#parseCookies(req.headers?.cookie || ''),
        params: {},
        query: Object.fromEntries(requestUrl.searchParams),
        headers: req.headers as Record<string, string | string[] | undefined>,
        clientIp: this.#nodeClientIp(req),
        requestId: this.#nodeRequestId(req),
        authorizer: await this.#createAuthorizerFromHeaders(req.headers),
        proxyOptions: proxyOptions || {},
      };
      const response = await this.#request(routerRequest);

      if (!response || typeof response !== 'object') {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid response from handler' }));
        return;
      }

      res.statusCode = response.status || 200;

      const headers = Router.#withDefaultContentType(response.headers);

      Object.entries(headers).forEach(([name, value]) => {
        res.setHeader(name, value);
      });

      if (response.body !== null && response.body !== undefined) {
        if (Buffer.isBuffer(response.body)) res.end(response.body);
        else if (response.isBase64Encoded && typeof response.body === 'string')
          res.end(Buffer.from(response.body, 'base64'));
        else if (typeof response.body === 'string') res.end(response.body);
        else res.end(JSON.stringify(response.body));
      } else res.end('');
    } catch (error: unknown) {
      if (error instanceof BodyTooLargeError) {
        logger.warn('Refused request body over the size limit', {
          code: 'ROUTER_PAYLOAD_TOO_LARGE',
          source: 'Router.nodeJSRequest',
          method: req.method,
          maxBodyBytes: this.#maxBodyBytes,
        });
        Router.#answerPayloadTooLarge(req, res);
        return;
      }
      if (error instanceof ClientAbortedError) {
        // The client hung up mid-upload: there is nobody to answer and
        // nothing went wrong on this side, so no error log and no 500.
        logger.debug('Client aborted the request before its body was read', {
          code: 'ROUTER_CLIENT_ABORTED',
          source: 'Router.nodeJSRequest',
          ...this.#requestLogFields(requestUrl.pathname),
          method: req.method,
        });
        return;
      }
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      const errorResponse = RouteError.fromError(error, {
        defaultMessage: 'Request processing failed',
        status: 500,
        context: {
          source: 'Router.nodeJSRequest',
          ...this.#requestLogFields(requestUrl.pathname, routerRequest?.route),
          method: req.method,
        },
      });
      res.end(
        typeof errorResponse.body === 'string'
          ? errorResponse.body
          : JSON.stringify(errorResponse.body)
      );
    }
  }

  /**
   * See `RouterRequest.clientIp`. In a Web Function, Lambda appends the
   * connecting address as the LAST `X-Forwarded-For` value; everything before
   * it came from the client. Reading the first value — the common idiom —
   * hands the client the choice of its own IP.
   */
  #nodeClientIp(req: IncomingMessage): string {
    if (this.#webFunction) {
      const header = req.headers['x-forwarded-for'];
      const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
      const hops = raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const candidate = hops[hops.length - 1 - this.#trustedProxies] ?? '';
      // With trustedProxies > 0 the chosen entry was written by a proxy only
      // if every request really passes through it; a direct call to the
      // endpoint makes it client text. Accepting only a literal IP keeps that
      // case from smuggling arbitrary strings (or log-forging characters)
      // into clientIp.
      return isIP(candidate) ? candidate : '';
    }
    return req.socket?.remoteAddress ?? '';
  }

  /**
   * Lambda strips any client-sent `lambda-web-*` header before adding its own
   * `lambda-web-request-id`, so it is trusted only in Web Function mode. On a
   * plain server a client could set it to anything, including text crafted
   * to forge log lines.
   */
  #nodeRequestId(req: IncomingMessage): string {
    if (this.#webFunction) {
      const id = req.headers['lambda-web-request-id'];
      // Lambda's ids are short and plain; anything else is not from Lambda
      // (most likely `webFunction` set on a server clients reach directly).
      if (typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)) return id;
    }
    return randomUUID();
  }

  #parseCookies(cookieHeader: string): Record<string, string> {
    if (!cookieHeader) return {};
    return Object.fromEntries(
      cookieHeader.split(';').map((cookie) => {
        const [key, ...rest] = cookie.trim().split('=');
        return [key, rest.join('=')];
      })
    );
  }

  /**
   * Parse Lambda HTTP API v2.0 cookies array into key-value object
   * Lambda provides cookies as an array like: ["cookie1=value1", "cookie2=value2"]
   */
  /**
   * Drop query parameters API Gateway sent with no value.
   *
   * The event type admits `undefined` values because that is what AWS's own
   * type says, but `RouterRequest.query` promises `Record<string, string>`.
   * Stripping the empty entries here keeps that promise true rather than
   * pushing `string | undefined` onto every handler.
   */
  /**
   * Copies a route's response headers and supplies the default content type if
   * the route set none.
   *
   * The copy matters: a route may return a shared or frozen header constant,
   * and writing the default into it would mutate that constant for every later
   * request — and throw outright on a frozen one. The lookup is
   * case-insensitive because header names are; checking only two exact
   * spellings let any other casing through, and since `setHeader` *is*
   * case-insensitive the default then silently overwrote the content type the
   * route had deliberately set.
   */
  static #withDefaultContentType(
    headers: Record<string, string | string[]> | undefined
  ): Record<string, string | string[]> {
    const copied: Record<string, string | string[]> = { ...headers };

    if (!Object.keys(copied).some((name) => name.toLowerCase() === 'content-type')) {
      copied['Content-Type'] = 'application/json';
    }

    return copied;
  }

  /**
   * Renders a response header map the way API Gateway HTTP API (payload format
   * 2.0) expects it.
   *
   * `set-cookie` is lifted out into the top-level `cookies` array — a header
   * map cannot carry two values under one name, and cookie values contain
   * commas, so folding them into one string would corrupt them. Any other
   * multi-value header is comma-joined, which is how HTTP combines repeated
   * headers and how API Gateway itself presents them on the request side.
   */
  static #splitResponseHeaders(headers: Record<string, string | string[]>): {
    headers: Record<string, string>;
    cookies: string[];
  } {
    const flattened: Record<string, string> = {};
    const cookies: string[] = [];

    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'set-cookie') {
        cookies.push(...(Array.isArray(value) ? value : [value]));
        continue;
      }
      flattened[name] = Array.isArray(value) ? value.join(', ') : value;
    }

    return { headers: flattened, cookies };
  }

  static #compactQuery(
    query: Record<string, string | undefined> | undefined
  ): Record<string, string> {
    if (!query) return {};
    const compacted: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) compacted[key] = value;
    }
    return compacted;
  }

  #parseLambdaCookies(cookies: string[]): Record<string, string> {
    if (!Array.isArray(cookies) || cookies.length === 0) return {};
    return Object.fromEntries(
      cookies.map((cookie) => {
        const [key, ...rest] = cookie.split('=');
        return [key, rest.join('=')];
      })
    );
  }

  static #HMAC_HASHES: Record<JwtHmacAlgorithm, string> = {
    HS256: 'sha256',
    HS384: 'sha384',
    HS512: 'sha512',
  };

  /**
   * Compares two secrets without leaking their contents through timing.
   * Both sides are hashed first so that unequal lengths cannot be detected by
   * timingSafeEqual throwing.
   */
  static #secretsMatch(a: string, b: string): boolean {
    const hashedA = createHash('sha256').update(a, 'utf8').digest();
    const hashedB = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(hashedA, hashedB);
  }

  /**
   * Verifies a JWT and returns its claims, or null if the token is not valid.
   *
   * SECURITY: earlier versions base64-decoded the payload and exposed it as
   * `request.authorizer` without checking the signature, so any caller could
   * mint arbitrary claims (`sub`, `isAdmin`, ...) and defeat any check built on
   * them. Verification is now mandatory: with no `jwt` option configured this
   * returns null and `authorizer` stays empty.
   */
  async #verifyJwt(token: string): Promise<Record<string, unknown> | null> {
    const options = this.#jwt;
    if (!options) return null;

    // A caller-supplied verifier wins, so RS256/ES256 and JWKS stay possible
    // without this package taking on a JWT dependency.
    if (options.verify) {
      try {
        const claims = await options.verify(token);
        return claims && typeof claims === 'object' ? claims : null;
      } catch (error: unknown) {
        logger.warn('Custom JWT verifier rejected token', {
          code: 'ROUTER_JWT_VERIFY_FAILED',
          source: 'Router.verifyJwt',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    if (!options.secret) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerSegment, payloadSegment, signatureSegment] = parts;

    let header: { alg?: unknown };
    try {
      header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    // SECURITY: the algorithm comes from the allowlist, never from the token.
    // Trusting the token's own `alg` is the classic confusion bypass, and it is
    // what makes `alg: none` forgeries work.
    const allowed: JwtHmacAlgorithm[] = options.algorithms ?? ['HS256'];
    const alg = header?.alg;
    if (typeof alg !== 'string' || !allowed.includes(alg as JwtHmacAlgorithm)) {
      logger.warn('JWT rejected: algorithm not allowed', {
        code: 'ROUTER_JWT_ALG_NOT_ALLOWED',
        source: 'Router.verifyJwt',
        alg: typeof alg === 'string' ? alg : typeof alg,
      });
      return null;
    }

    const hash = Router.#HMAC_HASHES[alg as JwtHmacAlgorithm];
    const expected = createHmac(hash, options.secret)
      .update(`${headerSegment}.${payloadSegment}`)
      .digest();
    const provided = Buffer.from(signatureSegment, 'base64url');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      logger.warn('JWT rejected: signature mismatch', {
        code: 'ROUTER_JWT_BAD_SIGNATURE',
        source: 'Router.verifyJwt',
      });
      return null;
    }

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!claims || typeof claims !== 'object') return null;

    const now = Math.floor(Date.now() / 1000);
    const skew = options.clockToleranceSec ?? 0;
    if (typeof claims.exp === 'number' && now > claims.exp + skew) {
      logger.warn('JWT rejected: expired', {
        code: 'ROUTER_JWT_EXPIRED',
        source: 'Router.verifyJwt',
      });
      return null;
    }
    if (typeof claims.nbf === 'number' && now + skew < claims.nbf) return null;

    return claims;
  }

  async #createAuthorizerFromHeaders(headers: IncomingMessage['headers']): Promise<unknown> {
    if (!this.#jwt) return null;

    const authHeader =
      headers?.authorization || (headers as { Authorization?: string })?.Authorization;
    if (!authHeader) return null;

    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const token = authValue?.replace(/^Bearer\s+/i, '') || '';
    if (!token) return null;

    const claims = await this.#verifyJwt(token);
    if (!claims) return null;

    // Same shape as an API Gateway Lambda authorizer, which populates this
    // structure only after the gateway has validated the token.
    return { lambda: claims };
  }

  /**
   * Answers 413 to a body over the limit without losing the answer to a TCP
   * reset. Destroying the socket while unread upload bytes sit in the
   * kernel's receive buffer makes it send RST, and a client still uploading
   * (Node's `http.request`, `fetch`, curl) then reports ECONNRESET instead of
   * the 413. So the response goes out with `Connection: close`, the rest of
   * the upload is read and discarded — at most `#MAX_DRAIN_BYTES`, then the
   * connection is cut — and the socket is destroyed after
   * `#REFUSED_UPLOAD_LINGER_MS` if the client has not closed it by then
   * (also the fallback when the response never finishes because the client
   * reads nothing).
   */
  static #answerPayloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
    const socket = req.socket;
    if (socket) refusedConnections.add(socket);
    const cut = () => {
      if (socket && !socket.destroyed) socket.destroy();
    };
    const linger = setTimeout(cut, Router.#REFUSED_UPLOAD_LINGER_MS);
    linger.unref?.();
    socket?.once?.('close', () => clearTimeout(linger));

    // Lingering close. With `Connection: close`, Node ends the response with
    // `socket.destroySoon()`, which destroys the socket as soon as the FIN is
    // flushed — while the client may still be uploading, so the next bytes
    // to arrive draw a reset that can wipe the unread 413 from the client's
    // receive buffer. Half-close instead; the drain, the byte cap and the
    // timer below decide when the socket is actually destroyed.
    let closeWhenFlushed = cut;
    if (socket && typeof socket.destroySoon === 'function') {
      const destroySoon = socket.destroySoon;
      closeWhenFlushed = () => destroySoon.call(socket);
      socket.destroySoon = function lingeringClose(this: typeof socket) {
        if (this.writable) this.end();
      };
    }

    let drained = 0;
    req.on?.('error', () => {});
    req.on?.('data', (chunk: Buffer | string) => {
      drained += chunk.length;
      if (drained > Router.#MAX_DRAIN_BYTES) cut();
    });
    // The whole upload has arrived: nothing is left to draw a reset, so the
    // connection can go once the answer is out.
    req.on?.('end', () => {
      if (res.writableFinished) closeWhenFlushed();
      else res.once?.('finish', closeWhenFlushed);
    });
    req.resume?.();

    res.statusCode = 413;
    res.setHeader('Content-Type', 'application/json');
    // The connection cannot be reused for another request: say so.
    res.setHeader('Connection', 'close');
    res.end(Router.#payloadTooLargeBody());
  }

  /**
   * Whether a body-read failure is the client going away (connection reset,
   * aborted upload) rather than a fault on this side.
   */
  static #isClientAbort(req: IncomingMessage, error: unknown): boolean {
    if ((req as { aborted?: boolean }).aborted === true) return true;
    if (!(error instanceof Error)) return false;
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ECONNRESET' || code === 'ECONNABORTED' || error.message === 'aborted';
  }

  async #getNodeJSRequestBody(req: IncomingMessage, raw = false): Promise<unknown> {
    const limit = this.#maxBodyBytes;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) throw new BodyTooLargeError();

    return new Promise((resolve, reject) => {
      // Collected as bytes and decoded once: decoding chunk by chunk split
      // multi-byte UTF-8 characters that straddled a chunk boundary.
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;

      const onData = (data: Buffer | string) => {
        if (done) return;
        // A stream with an encoding set (`req.setEncoding`) emits strings.
        const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        size += chunk.length;
        if (size > limit) {
          done = true;
          // Stop buffering and release what was held; the socket is left to
          // nodeJSRequest, which answers 413 and then closes it gracefully.
          chunks.length = 0;
          req.off?.('data', onData);
          req.pause?.();
          reject(new BodyTooLargeError());
          return;
        }
        chunks.push(chunk);
      };
      req.on('data', onData);
      req.on('end', () => {
        if (done) return;
        done = true;
        if (raw) {
          resolve(size > 0 ? Buffer.concat(chunks) : null);
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        if (
          req.headers['content-type']?.includes('application/json') &&
          !isCorsSafelistedContentType(req.headers['content-type'])
        ) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        } else {
          resolve(body);
        }
      });
      req.on('error', (err) => {
        if (done) return;
        done = true;
        chunks.length = 0;
        // Only a body-read failure caused by the client hanging up is
        // classified as an abort; anything else stays a server-side error.
        reject(Router.#isClientAbort(req, err) ? new ClientAbortedError() : err);
      });
      // A connection that closes before 'end' (client gone mid-upload)
      // would otherwise leave this promise pending for good.
      req.on?.('close', () => {
        if (done) return;
        done = true;
        chunks.length = 0;
        reject(new ClientAbortedError());
      });
    });
  }

  static #eventBodyBytes(body: string, isBase64Encoded: boolean | undefined): number {
    if (!isBase64Encoded) return Buffer.byteLength(body, 'utf8');
    // Line breaks (MIME base64 wraps at 76 with CRLF) and other whitespace
    // carry no data; counting them overstated the size and refused a body
    // exactly at the limit.
    const compact = /\s/.test(body) ? body.replace(/\s+/g, '') : body;
    const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
  }

  static #payloadTooLargeBody(): string {
    return JSON.stringify({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
  }

  static #payloadTooLargeResult(): EventFunctionResult {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json' },
      body: Router.#payloadTooLargeBody(),
    };
  }

  async #request(request: RouterRequest): Promise<RouterResponse> {
    if (this.#bearerToken) {
      const authHeader = request.headers?.authorization || request.headers?.Authorization;

      if (!authHeader) {
        const authError = new Error('Missing Authorization header');
        authError.name = 'AuthenticationError';
        return RouteError.fromError(authError, {
          defaultMessage: 'Authentication required',
          status: 401,
        });
      }

      const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      const token = authValue?.replace(/^Bearer\s+/i, '') || '';

      // SECURITY: constant-time comparison so the token cannot be recovered
      // byte-by-byte from response timing.
      if (!Router.#secretsMatch(token, this.#bearerToken)) {
        const authError = new Error('Invalid authorization token');
        authError.name = 'AuthorizationError';
        return RouteError.fromError(authError, {
          defaultMessage: 'Access forbidden',
          status: 403,
        });
      }
    }

    const route = this.#findRouteHandler(request.path, request.method);

    if (!route) {
      // The path stays out of the message: it is logged (and its stack with
      // it), and a path can carry secrets.
      const notFoundError = new Error('Route not found');
      notFoundError.name = 'NotFoundError';
      return RouteError.fromError(notFoundError, {
        defaultMessage: 'Route not found',
        status: 404,
        context: { ...this.#requestLogFields(request.path), method: request.method },
      });
    }

    // The matched pattern, for logging without the request's own path values.
    if ('path' in route && typeof route.path === 'string') {
      request.route = route.path.replace(/\/+/g, '/');
    }

    // Match dynamic route parameters
    if ('pattern' in route && route.path !== request.path && route.pattern) {
      const match = route.pattern.exec(request.path);
      if (match?.pathname?.groups) {
        // An optional pattern segment that did not match yields undefined. Drop
        // those rather than handing a handler a `params` entry that is typed
        // string but is actually undefined.
        request.params = Object.fromEntries(
          Object.entries(match.pathname.groups).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        );
      }
    }

    try {
      // Run global middleware
      for (const middleware of this.#globalMiddleware) {
        const middlewareResult = await middleware(request);
        if (middlewareResult) {
          // Middleware returned a response, short-circuit
          return middlewareResult;
        }
      }

      // Run route-specific middleware
      if ('middleware' in route && route.middleware && Array.isArray(route.middleware)) {
        for (const middleware of route.middleware) {
          const middlewareResult = await middleware(request);
          if (middlewareResult) {
            // Middleware returned a response, short-circuit
            return middlewareResult;
          }
        }
      }

      // Execute route handler
      const result = await route.handler(request);
      if (!result || typeof result !== 'object')
        throw new Error('Handler must return a response object');

      return result;
    } catch (error: unknown) {
      return RouteError.fromError(error, {
        defaultMessage: 'Route handler failed',
        status: 500,
        context: {
          source: 'Router.request',
          code: 'ROUTER_HANDLER_ERROR',
          ...this.#requestLogFields(request.path, request.route),
          method: request.method,
        },
      });
    }
  }
}
