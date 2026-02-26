import { IncomingMessage, ServerResponse } from 'http';

interface RouteRegistration {
    path: string;
    methods: string[];
    pattern: URLPattern;
    handler: (event: RequestEvent) => Promise<RouteResponse>;
    middleware?: Middleware[];
}

interface RequestEvent {
    path: string;
    method: string;
    body: any;
    cookies: Record<string, string>;
    params: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    authorizer?: any;
    lambdaOptions?: any;
}

interface RouteResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
    isBase64Encoded?: boolean;
}

interface RouterOptions {
    context?: any;
    initRoutes?: (new (router: Router, context?: any) => any)[];
    bearerToken?: string | null;
    middleware?: Middleware[];
}

type Middleware = (event: RequestEvent) => Promise<RouteResponse | void>;

export default class Router {

    static MethodsWithBody = ['POST', 'PUT', 'PATCH'];

    #routes = {
        cache: new Map<string, RouteRegistration | null>(),
        static: new Map<string, { handler: (event: RequestEvent) => Promise<RouteResponse> }>(),
        dynamic: new Map<string, RouteRegistration[]>(),
    };

    #bearerToken: string | null = null;
    #globalMiddleware: Middleware[] = [];

    constructor({ context, initRoutes = [], bearerToken = null, middleware = [] }: RouterOptions = {}) {

        this.#bearerToken = bearerToken;
        this.#globalMiddleware = Array.isArray(middleware) ? middleware : [];

        if (Array.isArray(initRoutes))
            this.#buildRoutesPatterns(
                initRoutes
                    .map(RoutesClass => new RoutesClass(this, context).routerRoutes)
                    .flat()
                    .filter(route => route && route.path && route.handler)
            );

    }

    #buildRoutesPatterns(routes: RouteRegistration[]): void {

        for (const route of routes) {

            if (typeof route.path !== 'string' || typeof route.handler !== 'function') {
                throw new Error('Each route must have a valid path string and handler function');
            }

            // Normalize: collapse multiple slashes, remove trailing slash (except root)
            let normalizedPath = route.path.replace(/\/+/g, '/');
            normalizedPath = normalizedPath.length > 1 ? normalizedPath.replace(/\/+$/, '') : normalizedPath;

            for (const method of route.methods) {

                const pathMethodKey = `${normalizedPath}::${method}`;

                if (this.#routes.dynamic.has(normalizedPath) || this.#routes.static.has(pathMethodKey))
                    throw new Error(`Duplicate route detected: ${method} ${normalizedPath}`);

                if (normalizedPath.includes(':') || normalizedPath.includes('*') || normalizedPath.includes('(') || normalizedPath.includes('[')) {

                    if (!this.#routes.dynamic.has(method))
                        this.#routes.dynamic.set(method, []);

                    this.#routes.dynamic.get(method)!.push(route);

                }

                else {
                    this.#routes.static.set(pathMethodKey, {
                        handler: route.handler
                    });
                }

            }

        }

    }

    #findRouteHandler(path: string, method: string): RouteRegistration | { handler: (event: RequestEvent) => Promise<RouteResponse> } | null {

        // Normalize path: remove trailing slash (except for root "/")
        const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;

        if (this.#routes.static.has(`${normalizedPath}::${method}`))
            return this.#routes.static.get(`${normalizedPath}::${method}`)!;

        if (this.#routes.cache.has(`${normalizedPath}::${method}`))
            return this.#routes.cache.get(`${normalizedPath}::${method}`)!;

        if (!this.#routes.dynamic.has(method))
            return null;

        const route = this.#routes.dynamic.get(method)!.find(route => {
            if (!route.methods.includes(method)) return false;
            if (route.path === normalizedPath) return true;
            return route.pattern?.test(normalizedPath);
        });

        this.#routes.cache.set(`${normalizedPath}::${method}`, route || null);

        return route || null;

    }

    async lambdaEvent(event: any): Promise<{ statusCode: number; headers?: Record<string, string>; body: string; isBase64Encoded?: boolean }> {

        let body = Router.MethodsWithBody.includes(event.requestContext.http.method) ? event.body : null;

        if (event.headers['content-type']?.includes('application/json')) {
            try {
                body = JSON.parse(body);
            } catch {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid JSON in request body' })
                };
            }
        }

        const response = await this.#request({
            path: event.requestContext.http.path,
            method: event.requestContext.http.method,
            body: body,
            cookies: {}, // TO DO
            params: {},
            query: event?.queryStringParameters || {},
            headers: event.headers,
            authorizer: event.requestContext.authorizer || null
        });

        return {
            statusCode: response.status || 200,
            headers: response.headers || { 'Content-Type': 'application/json' },
            body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
            isBase64Encoded: response.isBase64Encoded || false
        };

    }

    async nodeJSRequest(req: IncomingMessage, res: ServerResponse, { cors, lambdaOptions }: { cors?: boolean; lambdaOptions?: any } = {}): Promise<void> {


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

        const requestUrl = new URL(req.url!, `http://${req.headers.host}`);

        try {

            const response = await this.#request({
                path: requestUrl.pathname,
                method: req.method!,
                body: Router.MethodsWithBody.includes(req.method!) ? await this.#getNodeJSRequestBody(req) : null,
                cookies: this.#parseCookies(req.headers?.cookie || ''),
                params: {},
                query: Object.fromEntries(requestUrl.searchParams),
                headers: req.headers as Record<string, any>,
                authorizer: this.#createAuthorizerFromHeaders(req.headers),
                lambdaOptions: lambdaOptions || {}
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

        catch (error: any) {

            console.error('Router error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                statusCode: 500
            }));

        }

    }

    #parseCookies(cookieHeader: string): Record<string, string> {
        if (!cookieHeader) return {};
        return Object.fromEntries(
            cookieHeader.split(';').map(cookie => {
                const [key, ...rest] = cookie.trim().split('=');
                return [key, rest.join('=')];
            })
        );
    }

    #createAuthorizerFromHeaders(headers: IncomingMessage['headers']): any {
        const authHeader = headers?.authorization || (headers as any)?.Authorization;
        if (!authHeader) return null;

        const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const token = authValue?.replace(/^Bearer\s+/i, '') || '';
        if (!token) return null;

        try {
            // Decode JWT (base64url decode the payload)
            const parts = token.split('.');
            if (parts.length !== 3) return null;

            const payload = parts[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            const claims = JSON.parse(decoded);

            // Return in same structure as Lambda authorizer for consistency
            return {
                lambda: claims  // Mimic HTTP API Lambda authorizer structure
            };
        } catch (error) {
            console.error('Failed to decode JWT:', error);
            return null;
        }
    }

    async #getNodeJSRequestBody(req: IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => {
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

    async #request(event: RequestEvent): Promise<RouteResponse> {

        if (this.#bearerToken) {
            const authHeader = event.headers?.authorization || event.headers?.Authorization;

            if (!authHeader)
                return {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Unauthorized',
                        message: 'Missing Authorization header',
                        statusCode: 401
                    })
                };

            const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
            const token = authValue?.replace(/^Bearer\s+/i, '') || '';

            if (token !== this.#bearerToken)
                return {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Forbidden',
                        message: 'Invalid authorization token',
                        statusCode: 403
                    })
                };

        }

        const route = this.#findRouteHandler(event.path, event.method);

        if (!route)
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Not Found',
                    message: `Route ${event.method} ${event.path} does not exist`,
                    statusCode: 404
                })
            };

        // Match dynamic route parameters
        if ('pattern' in route && route.path !== event.path && route.pattern) {
            const match = route.pattern.exec(event.path);
            if (match?.pathname?.groups) {
                event.params = match.pathname.groups;
            }
        }

        try {

            // Run global middleware
            for (const middleware of this.#globalMiddleware) {
                const middlewareResult = await middleware(event);
                if (middlewareResult) {
                    // Middleware returned a response, short-circuit
                    return middlewareResult;
                }
            }

            // Run route-specific middleware
            if ('middleware' in route && route.middleware && Array.isArray(route.middleware)) {
                for (const middleware of route.middleware) {
                    const middlewareResult = await middleware(event);
                    if (middlewareResult) {
                        // Middleware returned a response, short-circuit
                        return middlewareResult;
                    }
                }
            }

            // Execute route handler
            const result = await route.handler(event);
            if (!result || typeof result !== 'object')
                throw new Error('Handler must return a response object');

            return result;

        } catch (error: any) {
            console.error('Route handler error:', error);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Internal Server Error',
                    message: error.message,
                    statusCode: 500
                })
            };
        }

    }

}
