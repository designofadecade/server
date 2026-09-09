import { IncomingMessage, ServerResponse } from 'http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger/Logger.js';
import RouteError from './RouteError.js';
import Context from '../context/Context.js';

interface LambdaHttpEvent {
  requestContext: {
    http: {
      method: string;
      path: string;
    };
    authorizer?: unknown;
  };
  headers: Record<string, string | string[] | undefined>;
  body?: string | null;
  cookies?: string[];
  queryStringParameters?: Record<string, string>;
  [key: string]: unknown;
}

interface RouteRegistration {
  path: string;
  methods: string[];
  pattern: URLPattern;
  handler: (request: RouterRequest) => Promise<RouterResponse>;
  middleware?: RouterMiddleware[];
}

export interface RouterRequest {
  path: string;
  method: string;
  body: unknown;
  cookies: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  authorizer?: unknown;
  lambdaOptions?: unknown;
}

export interface RouterResponse {
  status?: number;
  headers?: Record<string, string>;
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
  context?: Context;
  initRoutes?: (new (router: Router, context?: Context) => { routerRoutes: RouteRegistration[] })[];
  bearerToken?: string | null;
  middleware?: RouterMiddleware[];
  /**
   * JWT verification for the Node.js path. When omitted, `request.authorizer`
   * is always `null` — an unverified token is never exposed.
   */
  jwt?: JwtOptions;
}

export type RouterMiddleware = (request: RouterRequest) => Promise<RouterResponse | void>;

export default class Router {
  static MethodsWithBody = ['POST', 'PUT', 'PATCH'];
  static #MAX_CACHE_SIZE = 1000;
  static #MAX_BODY_SIZE = 1024 * 1024; // 1MB

  #routes = {
    cache: new Map<string, RouteRegistration | null>(),
    static: new Map<string, RouteRegistration>(),
    dynamic: new Map<string, RouteRegistration[]>(),
  };

  #bearerToken: string | null = null;
  #jwt: JwtOptions | null = null;
  #globalMiddleware: RouterMiddleware[] = [];

  constructor({
    context,
    initRoutes = [],
    bearerToken = null,
    middleware = [],
    jwt,
  }: RouterOptions = {}) {
    this.#bearerToken = bearerToken;
    this.#jwt = jwt ?? null;
    this.#globalMiddleware = Array.isArray(middleware) ? middleware : [];

    if (Array.isArray(initRoutes))
      this.#buildRoutesPatterns(
        initRoutes
          .map((RoutesClass) => new RoutesClass(this, context).routerRoutes)
          .flat()
          .filter((route) => route && route.path && route.handler)
      );
  }

  #buildRoutesPatterns(routes: RouteRegistration[]): void {
    for (const route of routes) {
      if (typeof route.path !== 'string' || typeof route.handler !== 'function') {
        throw new Error('Each route must have a valid path string and handler function');
      }

      // Normalize: collapse multiple slashes, remove trailing slash (except root)
      let normalizedPath = route.path.replace(/\/+/g, '/');
      normalizedPath =
        normalizedPath.length > 1 ? normalizedPath.replace(/\/+$/, '') : normalizedPath;

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
    const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;

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

  #pruneCache(): void {
    if (this.#routes.cache.size > Router.#MAX_CACHE_SIZE) {
      const firstKey = this.#routes.cache.keys().next().value;
      if (firstKey) {
        this.#routes.cache.delete(firstKey);
      }
    }
  }

  async lambdaEvent(event: LambdaHttpEvent): Promise<{
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
  }> {
    try {
      let body = Router.MethodsWithBody.includes(event.requestContext.http.method)
        ? event.body
        : null;

      if (event.headers['content-type']?.includes('application/json') && body) {
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

      const response = await this.#request({
        path: event.requestContext.http.path,
        method: event.requestContext.http.method,
        body: body,
        cookies: this.#parseLambdaCookies(event.cookies || []),
        params: {},
        query: event?.queryStringParameters || {},
        headers: event.headers || {},
        authorizer: event.requestContext.authorizer || null,
      });

      return {
        statusCode: response.status || 200,
        headers: response.headers || { 'Content-Type': 'application/json' },
        body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
        isBase64Encoded: response.isBase64Encoded || false,
      };
    } catch (error: unknown) {
      // Catch any unhandled errors and format them consistently
      const errorResponse = RouteError.fromError(error, {
        defaultMessage: 'Request processing failed',
        status: 500,
        context: {
          source: 'Router.lambdaEvent',
          path: event.requestContext?.http?.path,
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
    {
      cors,
      lambdaOptions,
    }: { cors?: boolean | string[]; lambdaOptions?: Record<string, unknown> } = {}
  ): Promise<void> {
    if (cors) {
      // SECURITY: Reflecting an arbitrary Origin alongside
      // Access-Control-Allow-Credentials lets any site make cookie-authenticated
      // cross-origin calls and read the response. Credentials are therefore only
      // granted to origins on an explicit allowlist; `cors: true` falls back to
      // an anonymous wildcard, which browsers already refuse to pair with
      // credentials.
      const requestOrigin = req.headers.origin;

      if (Array.isArray(cors)) {
        // Vary on Origin so caches never serve one origin's response to another.
        res.setHeader('Vary', 'Origin');
        if (requestOrigin && cors.includes(requestOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', requestOrigin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else if (requestOrigin) {
          logger.warn('Blocked cross-origin request from non-allowlisted origin', {
            code: 'ROUTER_CORS_ORIGIN_BLOCKED',
            source: 'Router.nodeJSRequest',
            origin: requestOrigin,
          });
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
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

    try {
      const response = await this.#request({
        path: requestUrl.pathname,
        method: req.method!,
        body: Router.MethodsWithBody.includes(req.method!)
          ? await this.#getNodeJSRequestBody(req)
          : null,
        cookies: this.#parseCookies(req.headers?.cookie || ''),
        params: {},
        query: Object.fromEntries(requestUrl.searchParams),
        headers: req.headers as Record<string, string | string[] | undefined>,
        authorizer: await this.#createAuthorizerFromHeaders(req.headers),
        lambdaOptions: lambdaOptions || {},
      });

      if (!response || typeof response !== 'object') {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid response from handler' }));
        return;
      }

      res.statusCode = response.status || 200;

      const headers = response.headers || {};
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }

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
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      const errorResponse = RouteError.fromError(error, {
        defaultMessage: 'Request processing failed',
        status: 500,
        context: {
          source: 'Router.nodeJSRequest',
          path: req.url,
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

  async #getNodeJSRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > Router.#MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        if (req.headers['content-type']?.includes('application/json')) {
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
        reject(err);
      });
    });
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
      const notFoundError = new Error(`Route ${request.method} ${request.path} does not exist`);
      notFoundError.name = 'NotFoundError';
      return RouteError.fromError(notFoundError, {
        defaultMessage: 'Route not found',
        status: 404,
        context: { path: request.path, method: request.method },
      });
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
          path: request.path,
          method: request.method,
        },
      });
    }
  }
}
