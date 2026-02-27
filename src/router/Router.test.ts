import { describe, it, expect, beforeEach, vi } from 'vitest';
import Router from './Router.ts';
import Routes from './Routes.ts';

describe('Router', () => {
    let router: Router;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a Router instance', () => {
            router = new Router();
            expect(router).toBeInstanceOf(Router);
        });

        it('should initialize with route classes', () => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', async () => ({ status: 200, body: 'test' }));
                }
            }

            router = new Router({ initRoutes: [TestRoutes] });
            expect(router).toBeInstanceOf(Router);
        });

        it('should set bearer token if provided', () => {
            router = new Router({ bearerToken: 'test-token' });
            expect(router).toBeInstanceOf(Router);
        });

        it('should set global middleware', () => {
            const middleware = vi.fn();
            router = new Router({ middleware: [middleware] });
            expect(router).toBeInstanceOf(Router);
        });

        it('should throw error for duplicate routes', () => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', async () => ({ status: 200, body: 'test' }));
                    this.addRoute('/test', 'GET', async () => ({ status: 200, body: 'duplicate' }));
                }
            }

            expect(() => {
                router = new Router({ initRoutes: [TestRoutes] });
            }).toThrow('Duplicate route detected');
        });

        it('should filter out invalid routes', () => {
            const invalidRoutes = [
                { path: '/valid', methods: ['GET'], handler: () => ({ status: 200 }) },
                { path: null, methods: ['GET'], handler: () => ({ status: 200 }) },
                { path: '/no-handler', methods: ['GET'] }
            ];

            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                }
                get routerRoutes() {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return invalidRoutes as unknown;
                }
            }

            router = new Router({ initRoutes: [TestRoutes] });
            expect(router).toBeInstanceOf(Router);
        });
    });

    describe('Static Methods', () => {
        it('should have MethodsWithBody constant', () => {
            expect(Router.MethodsWithBody).toEqual(['POST', 'PUT', 'PATCH']);
        });
    });

    describe('Route Matching', () => {
        beforeEach(() => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/static', 'GET', async () => ({ status: 200, body: 'static' }));
                    this.addRoute('/users/:id', 'GET', async (event) => ({ status: 200, body: event.params }));
                    this.addRoute('/wildcard/*', 'GET', async () => ({ status: 200, body: 'wildcard' }));
                }
            }

            router = new Router({ initRoutes: [TestRoutes] });
        });

        it('should match static routes', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/static'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
            expect(response.body).toBe('static');
        });

        it('should match dynamic routes with parameters', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/users/123'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });

        it('should return 404 for non-existent routes', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/does-not-exist'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(404);
        });

        it('should normalize paths with trailing slashes', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/static/'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });

        it('should preserve root path without trailing slash', async () => {
            class RootRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/', 'GET', async () => ({ status: 200, body: 'root' }));
                }
            }

            router = new Router({ initRoutes: [RootRoutes] });

            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });
    });

    describe('lambdaEvent', () => {
        beforeEach(() => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', async () => ({ status: 200, body: { success: true } }));
                    this.addRoute('/post', 'POST', async (event) => ({ status: 201, body: event.body }));
                }
            }

            router = new Router({ initRoutes: [TestRoutes] });
        });

        it('should handle GET requests', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/test'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ success: true });
        });

        it('should handle POST requests with JSON body', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'POST',
                        path: '/post'
                    }
                },
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ data: 'test' })
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(201);
            expect(JSON.parse(response.body)).toEqual({ data: 'test' });
        });

        it('should return 400 for invalid JSON', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'POST',
                        path: '/post'
                    }
                },
                headers: {
                    'content-type': 'application/json'
                },
                body: 'invalid json'
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body)).toHaveProperty('error');
        });

        it('should handle query string parameters', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/test'
                    }
                },
                queryStringParameters: { foo: 'bar' },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });

        it('should handle missing query string parameters', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/test'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });
    });

    describe('nodeJSRequest', () => {
        let mockReq: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        let mockRes: any; // eslint-disable-line @typescript-eslint/no-explicit-any

        beforeEach(() => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', async () => ({ status: 200, body: { success: true } }));
                }
            }

            router = new Router({ initRoutes: [TestRoutes] });

            mockReq = {
                url: 'http://localhost:3000/test',
                method: 'GET',
                headers: {
                    host: 'localhost:3000'
                },
                on: vi.fn()
            };

            mockRes = {
                setHeader: vi.fn(),
                end: vi.fn(),
                statusCode: 0
            };
        });

        it('should handle Node.js GET requests', async () => {
            mockReq.on.mockImplementation((event: string, callback: () => void) => {
                if (event === 'end') callback();
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes);

            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.end).toHaveBeenCalled();
        });

        it('should handle CORS when enabled', async () => {
            mockReq.headers.origin = 'http://example.com';
            mockReq.on.mockImplementation((event: string, callback: () => void) => {
                if (event === 'end') callback();
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes, { cors: true });

            expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://example.com');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', expect.any(String));
        });

        it('should handle OPTIONS preflight requests', async () => {
            mockReq.method = 'OPTIONS';

            await router.nodeJSRequest(mockReq, mockRes, { cors: true });

            expect(mockRes.statusCode).toBe(204);
            expect(mockRes.end).toHaveBeenCalled();
        });

        it('should handle POST requests with body', async () => {
            class PostRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'POST', async (event) => ({ status: 201, body: event.body }));
                }
            }

            router = new Router({ initRoutes: [PostRoutes] });

            mockReq.method = 'POST';
            mockReq.headers['content-type'] = 'application/json';

            mockReq.on.mockImplementation((event: string, callback: (data?: string) => void) => {
                if (event === 'data') callback('{"name":"test"}');
                if (event === 'end') callback();
                if (event === 'error') return;
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes);

            expect(mockRes.statusCode).toBe(201);
        });

        it('should handle errors gracefully', async () => {
            class PostRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'POST', async (event) => ({ status: 200, body: event.body }));
                }
            }

            router = new Router({ initRoutes: [PostRoutes] });

            mockReq.method = 'POST';
            mockReq.headers['content-type'] = 'application/json';

            mockReq.on.mockImplementation((event: string, callback: (error?: Error) => void) => {
                if (event === 'error') callback(new Error('Request error'));
                if (event === 'data') return;
                if (event === 'end') return;
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes);

            expect(mockRes.statusCode).toBe(500);
        });

        it('should handle Buffer responses', async () => {
            class BufferRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/buffer', 'GET', async () => ({
                        status: 200,
                        body: Buffer.from('test')
                    }));
                }
            }

            router = new Router({ initRoutes: [BufferRoutes] });
            mockReq.url = 'http://localhost:3000/buffer';

            mockReq.on.mockImplementation((event: string, callback: () => void) => {
                if (event === 'end') callback();
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes);

            expect(mockRes.end).toHaveBeenCalledWith(expect.any(Buffer));
        });

        it('should handle base64 encoded responses', async () => {
            class Base64Routes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/base64', 'GET', async () => ({
                        status: 200,
                        body: Buffer.from('test').toString('base64'),
                        isBase64Encoded: true
                    }));
                }
            }

            router = new Router({ initRoutes: [Base64Routes] });
            mockReq.url = 'http://localhost:3000/base64';

            mockReq.on.mockImplementation((event: string, callback: () => void) => {
                if (event === 'end') callback();
                return mockReq;
            });

            await router.nodeJSRequest(mockReq, mockRes);

            expect(mockRes.end).toHaveBeenCalled();
        });
    });

    describe('Bearer Token Authentication', () => {
        beforeEach(() => {
            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/protected', 'GET', async () => ({ status: 200, body: { success: true } }));
                }
            }

            router = new Router({
                initRoutes: [TestRoutes],
                bearerToken: 'valid-token'
            });
        });

        it('should return 401 if Authorization header is missing', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/protected'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(401);
        });

        it('should return 403 if bearer token is invalid', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/protected'
                    }
                },
                headers: {
                    Authorization: 'Bearer invalid-token'
                }
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(403);
        });

        it('should allow request with valid bearer token', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/protected'
                    }
                },
                headers: {
                    Authorization: 'Bearer valid-token'
                }
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });

        it('should handle lowercase authorization header', async () => {
            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/protected'
                    }
                },
                headers: {
                    authorization: 'Bearer valid-token'
                }
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(200);
        });
    });

    describe('Middleware', () => {
        it('should execute global middleware', async () => {
            const globalMiddleware = vi.fn(async (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                event.middlewareRan = true;
            });

            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', async (event: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                        status: 200,
                        body: { middlewareRan: event.middlewareRan }
                    }));
                }
            }

            router = new Router({
                initRoutes: [TestRoutes],
                middleware: [globalMiddleware]
            });

            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/test'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(globalMiddleware).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });

        it('should short-circuit on middleware response', async () => {
            const middleware = vi.fn(async () => ({
                status: 403,
                body: { error: 'Forbidden' }
            }));

            const handler = vi.fn(async () => ({
                status: 200,
                body: { success: true }
            }));

            class TestRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/test', 'GET', handler);
                }
            }

            router = new Router({
                initRoutes: [TestRoutes],
                middleware: [middleware]
            });

            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/test'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(middleware).toHaveBeenCalled();
            expect(handler).not.toHaveBeenCalled();
            expect(response.statusCode).toBe(403);
        });
    });

    describe('Error Handling', () => {
        it('should handle route handler errors', async () => {
            class ErrorRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    this.addRoute('/error', 'GET', async () => {
                        throw new Error('Handler error');
                    });
                }
            }

            router = new Router({ initRoutes: [ErrorRoutes] });

            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/error'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.body)).toHaveProperty('error');
        });

        it('should handle handler returning non-object', async () => {
            class InvalidRoutes extends Routes {
                constructor(router: Router) {
                    super(router);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.addRoute('/invalid', 'GET', async () => 'not an object' as unknown);
                }
            }

            router = new Router({ initRoutes: [InvalidRoutes] });

            const event = {
                requestContext: {
                    http: {
                        method: 'GET',
                        path: '/invalid'
                    }
                },
                headers: {}
            };

            const response = await router.lambdaEvent(event);
            expect(response.statusCode).toBe(500);
        });
    });
});
