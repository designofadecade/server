var _a;
import { logger } from '../logger/Logger.js';
import RouteError from './RouteError.js';
class Router {
    static MethodsWithBody = ['POST', 'PUT', 'PATCH'];
    static #MAX_CACHE_SIZE = 1000;
    static #MAX_BODY_SIZE = 1024 * 1024; // 1MB
    #routes = {
        cache: new Map(),
        static: new Map(),
        dynamic: new Map(),
    };
    #bearerToken = null;
    #globalMiddleware = [];
    constructor({ context, initRoutes = [], bearerToken = null, middleware = [], } = {}) {
        this.#bearerToken = bearerToken;
        this.#globalMiddleware = Array.isArray(middleware) ? middleware : [];
        if (Array.isArray(initRoutes))
            this.#buildRoutesPatterns(initRoutes
                .map((RoutesClass) => new RoutesClass(this, context).routerRoutes)
                .flat()
                .filter((route) => route && route.path && route.handler));
    }
    #buildRoutesPatterns(routes) {
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
                if (normalizedPath.includes(':') ||
                    normalizedPath.includes('*') ||
                    normalizedPath.includes('(') ||
                    normalizedPath.includes('[')) {
                    if (!this.#routes.dynamic.has(method))
                        this.#routes.dynamic.set(method, []);
                    this.#routes.dynamic.get(method).push(route);
                }
                else {
                    this.#routes.static.set(pathMethodKey, {
                        handler: route.handler,
                    });
                }
            }
        }
    }
    #findRouteHandler(path, method) {
        // Normalize path: remove trailing slash (except for root "/")
        const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;
        if (this.#routes.static.has(`${normalizedPath}::${method}`))
            return this.#routes.static.get(`${normalizedPath}::${method}`);
        if (this.#routes.cache.has(`${normalizedPath}::${method}`))
            return this.#routes.cache.get(`${normalizedPath}::${method}`);
        if (!this.#routes.dynamic.has(method))
            return null;
        const route = this.#routes.dynamic.get(method).find((route) => {
            if (!route.methods.includes(method))
                return false;
            if (route.path === normalizedPath)
                return true;
            return route.pattern?.test(normalizedPath);
        });
        this.#routes.cache.set(`${normalizedPath}::${method}`, route || null);
        this.#pruneCache();
        return route || null;
    }
    #pruneCache() {
        if (this.#routes.cache.size > _a.#MAX_CACHE_SIZE) {
            const firstKey = this.#routes.cache.keys().next().value;
            if (firstKey) {
                this.#routes.cache.delete(firstKey);
            }
        }
    }
    async lambdaEvent(event) {
        try {
            let body = _a.MethodsWithBody.includes(event.requestContext.http.method)
                ? event.body
                : null;
            if (event.headers['content-type']?.includes('application/json') && body) {
                try {
                    body = JSON.parse(body);
                }
                catch {
                    const errorResponse = RouteError.fromError(new Error('Invalid JSON in request body'), {
                        defaultMessage: 'Invalid JSON in request body',
                        status: 400,
                    });
                    return {
                        statusCode: errorResponse.status || 400,
                        headers: errorResponse.headers || { 'Content-Type': 'application/json' },
                        body: typeof errorResponse.body === 'string'
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
        }
        catch (error) {
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
                body: typeof errorResponse.body === 'string'
                    ? errorResponse.body
                    : JSON.stringify(errorResponse.body),
            };
        }
    }
    async nodeJSRequest(req, res, { cors, lambdaOptions } = {}) {
        if (cors) {
            const origin = req.headers.origin || '*';
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Max-Age', '86400');
        }
        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        try {
            const response = await this.#request({
                path: requestUrl.pathname,
                method: req.method,
                body: _a.MethodsWithBody.includes(req.method)
                    ? await this.#getNodeJSRequestBody(req)
                    : null,
                cookies: this.#parseCookies(req.headers?.cookie || ''),
                params: {},
                query: Object.fromEntries(requestUrl.searchParams),
                headers: req.headers,
                authorizer: this.#createAuthorizerFromHeaders(req.headers),
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
                if (Buffer.isBuffer(response.body))
                    res.end(response.body);
                else if (response.isBase64Encoded && typeof response.body === 'string')
                    res.end(Buffer.from(response.body, 'base64'));
                else if (typeof response.body === 'string')
                    res.end(response.body);
                else
                    res.end(JSON.stringify(response.body));
            }
            else
                res.end('');
        }
        catch (error) {
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
            res.end(typeof errorResponse.body === 'string'
                ? errorResponse.body
                : JSON.stringify(errorResponse.body));
        }
    }
    #parseCookies(cookieHeader) {
        if (!cookieHeader)
            return {};
        return Object.fromEntries(cookieHeader.split(';').map((cookie) => {
            const [key, ...rest] = cookie.trim().split('=');
            return [key, rest.join('=')];
        }));
    }
    /**
     * Parse Lambda HTTP API v2.0 cookies array into key-value object
     * Lambda provides cookies as an array like: ["cookie1=value1", "cookie2=value2"]
     */
    #parseLambdaCookies(cookies) {
        if (!Array.isArray(cookies) || cookies.length === 0)
            return {};
        return Object.fromEntries(cookies.map((cookie) => {
            const [key, ...rest] = cookie.split('=');
            return [key, rest.join('=')];
        }));
    }
    #createAuthorizerFromHeaders(headers) {
        const authHeader = headers?.authorization || headers?.Authorization;
        if (!authHeader)
            return null;
        const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const token = authValue?.replace(/^Bearer\s+/i, '') || '';
        if (!token)
            return null;
        try {
            // Decode JWT (base64url decode the payload)
            const parts = token.split('.');
            if (parts.length !== 3)
                return null;
            const payload = parts[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            const claims = JSON.parse(decoded);
            // Return in same structure as Lambda authorizer for consistency
            return {
                lambda: claims, // Mimic HTTP API Lambda authorizer structure
            };
        }
        catch (error) {
            logger.error('Failed to decode JWT', {
                code: 'ROUTER_JWT_DECODE_ERROR',
                source: 'Router.decodeJwt',
                error: error instanceof Error ? error : String(error),
            });
            return null;
        }
    }
    async #getNodeJSRequestBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            let size = 0;
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > _a.#MAX_BODY_SIZE) {
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
                    }
                    catch {
                        resolve(body);
                    }
                }
                else {
                    resolve(body);
                }
            });
            req.on('error', (err) => {
                reject(err);
            });
        });
    }
    async #request(request) {
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
            if (token !== this.#bearerToken) {
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
                request.params = match.pathname.groups;
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
        }
        catch (error) {
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
_a = Router;
export default Router;
//# sourceMappingURL=Router.js.map