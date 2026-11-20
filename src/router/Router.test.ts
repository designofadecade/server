import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import Router from './Router.ts';
import Routes from './Routes.ts';
import { logger } from '../logger/Logger.ts';

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JWT authorizer', () => {
    const SECRET = 'super-secret-signing-key';

    const b64 = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const sign = (claims: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string => {
      const head = b64({ alg, typ: 'JWT' });
      const body = b64(claims);
      const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
      return `${head}.${body}.${sig}`;
    };

    /** Token with a well-formed payload but a signature that was never computed. */
    const forge = (claims: Record<string, unknown>): string =>
      `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.AAAA`;

    /**
     * Builds a router whose single route records the authorizer it was given,
     * so tests can assert on what the verifier actually exposed to handlers.
     */
    const makeRouter = (
      options: Record<string, unknown> = {}
    ): { router: Router; seen: () => unknown } => {
      const captured: { value: unknown } = { value: undefined };
      class CaptureRoutes extends Routes {
        constructor(r: Router) {
          super(r);
          this.addRoute('/whoami', 'GET', async (req: { authorizer?: unknown }) => {
            captured.value = req.authorizer;
            return { status: 200, body: 'ok' };
          });
        }
      }
      const router = new Router({ initRoutes: [CaptureRoutes], ...options });
      return { router, seen: () => captured.value };
    };

    const capture = async (
      built: { router: Router; seen: () => unknown },
      token: string
    ): Promise<unknown> => {
      const req = {
        url: 'http://localhost:3000/whoami',
        method: 'GET',
        headers: { host: 'localhost:3000', authorization: `Bearer ${token}` },
        on: vi.fn((event: string, cb: () => void) => {
          if (event === 'end') cb();
          return req;
        }),
      };
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
      await built.router.nodeJSRequest(req as never, res as never);
      return built.seen();
    };

    it('should not expose an authorizer when no jwt option is configured', async () => {
      // Previously the payload was decoded and trusted with no signature check.
      const built = makeRouter();
      const body = await capture(built, forge({ sub: 'admin', isAdmin: true }));

      expect(body).toBeNull();
    });

    it('should reject a forged token when a secret is configured', async () => {
      const built = makeRouter({ jwt: { secret: SECRET } });
      const body = await capture(built, forge({ sub: 'admin', isAdmin: true }));

      expect(body).toBeNull();
    });

    it('should accept a correctly signed token', async () => {
      const built = makeRouter({ jwt: { secret: SECRET } });
      const body = await capture(built, sign({ sub: 'user-1', email: 'a@b.c' }));

      expect(body).toEqual({ lambda: { sub: 'user-1', email: 'a@b.c' } });
    });

    it('should reject a token signed with the wrong secret', async () => {
      const built = makeRouter({ jwt: { secret: SECRET } });
      const body = await capture(built, sign({ sub: 'user-1' }, 'not-the-secret'));

      expect(body).toBeNull();
    });

    it('should reject alg: none', async () => {
      const built = makeRouter({ jwt: { secret: SECRET } });
      const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body64 = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
      const body = await capture(built, `${head}.${body64}.`);

      expect(body).toBeNull();
    });

    it('should reject an algorithm outside the allowlist', async () => {
      const built = makeRouter({ jwt: { secret: SECRET, algorithms: ['HS512'] } });
      const body = await capture(built, sign({ sub: 'user-1' }));

      expect(body).toBeNull();
    });

    it('should reject an expired token', async () => {
      const built = makeRouter({ jwt: { secret: SECRET } });
      const past = Math.floor(Date.now() / 1000) - 60;
      const body = await capture(built, sign({ sub: 'user-1', exp: past }));

      expect(body).toBeNull();
    });

    it('should accept a token that is expired but within the clock tolerance', async () => {
      const built = makeRouter({ jwt: { secret: SECRET, clockToleranceSec: 300 } });
      const past = Math.floor(Date.now() / 1000) - 60;
      const body = await capture(built, sign({ sub: 'user-1', exp: past }));

      expect(body).toEqual({ lambda: { sub: 'user-1', exp: past } });
    });

    it('should use a custom verifier when supplied', async () => {
      const verify = vi.fn(async () => ({ sub: 'from-custom-verifier' }));
      const built = makeRouter({ jwt: { verify } });
      const body = await capture(built, 'anything.at.all');

      expect(verify).toHaveBeenCalledWith('anything.at.all');
      expect(body).toEqual({ lambda: { sub: 'from-custom-verifier' } });
    });

    it('should treat a throwing custom verifier as a rejected token', async () => {
      const verify = vi.fn(async () => {
        throw new Error('bad token');
      });
      const built = makeRouter({ jwt: { verify } });
      const body = await capture(built, 'anything.at.all');

      expect(body).toBeNull();
    });
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
        { path: '/no-handler', methods: ['GET'] },
      ];

      class TestRoutes extends Routes {
        constructor(router: Router) {
          super(router);
        }
        get routerRoutes(): any {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return invalidRoutes as any;
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
    let capturedParams: Record<string, string> | undefined;

    beforeEach(() => {
      capturedParams = undefined;
      class TestRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/static', 'GET', async () => ({ status: 200, body: 'static' }));
          this.addRoute('/users/:id', 'GET', async (request) => ({
            status: 200,
            body: request.params,
          }));
          this.addRoute('/wildcard/*', 'GET', async () => ({ status: 200, body: 'wildcard' }));
          this.addRoute('/files/:name?', 'GET', async (request) => {
            capturedParams = request.params;
            return { status: 200, body: request.params };
          });
        }
      }

      router = new Router({ initRoutes: [TestRoutes] });
    });

    it('should omit an optional segment that did not match', async () => {
      // URLPattern reports an unmatched optional group as undefined. It used to
      // be assigned straight into params, which is typed Record<string, string>,
      // so a handler could read `undefined` where a string was promised.
      const response = await router.eventFunction({
        requestContext: { http: { method: 'GET', path: '/files' } },
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      // Asserted on the object the handler actually received: JSON.stringify
      // drops undefined values, so checking the serialised body would pass
      // whether or not the key was filtered.
      expect(capturedParams).not.toHaveProperty('name');
      expect(Object.values(capturedParams ?? {})).not.toContain(undefined);
    });

    it('should include an optional segment that did match', async () => {
      const response = await router.eventFunction({
        requestContext: { http: { method: 'GET', path: '/files/report.pdf' } },
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body as string)).toEqual({ name: 'report.pdf' });
    });

    it('should match static routes', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/static',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('static');
    });

    it('should match dynamic routes with parameters', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/users/123',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
    });

    it('should return 404 for non-existent routes', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/does-not-exist',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(404);
    });

    it('should normalize paths with trailing slashes', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/static/',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
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
            path: '/',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('eventFunction', () => {
    beforeEach(() => {
      class TestRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/test', 'GET', async () => ({ status: 200, body: { success: true } }));
          this.addRoute('/post', 'POST', async (request) => ({ status: 201, body: request.body }));
        }
      }

      router = new Router({ initRoutes: [TestRoutes] });
    });

    it('should handle GET requests', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/test',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true });
    });

    it('should handle POST requests with JSON body', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'POST',
            path: '/post',
          },
        },
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ data: 'test' }),
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({ data: 'test' });
    });

    it('should return 400 for invalid JSON', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'POST',
            path: '/post',
          },
        },
        headers: {
          'content-type': 'application/json',
        },
        body: 'invalid json',
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toHaveProperty('error');
    });

    it('should handle query string parameters', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/test',
          },
        },
        queryStringParameters: { foo: 'bar' },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
    });

    it('should handle missing query string parameters', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/test',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
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
          host: 'localhost:3000',
        },
        on: vi.fn(),
      };

      mockRes = {
        setHeader: vi.fn(),
        end: vi.fn(),
        statusCode: 0,
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

    it('should reject a malformed Host header with 400 instead of throwing', async () => {
      // A Host of 'a b' makes the URL constructor throw. This used to happen
      // outside the try block, so the rejection escaped nodeJSRequest() and
      // could terminate the process under Node's unhandled-rejection policy.
      mockReq.headers.host = 'a b';
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await expect(router.nodeJSRequest(mockReq, mockRes)).resolves.toBeUndefined();

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should tolerate a missing Host header', async () => {
      delete mockReq.headers.host;
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await expect(router.nodeJSRequest(mockReq, mockRes)).resolves.toBeUndefined();
    });

    it('should handle CORS when enabled', async () => {
      mockReq.headers.origin = 'http://example.com';
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await router.nodeJSRequest(mockReq, mockRes, { cors: true });

      // `cors: true` is anonymous: a wildcard origin and no credentials.
      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(mockRes.setHeader).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        expect.any(String)
      );
    });

    it('should grant credentials to an allowlisted origin', async () => {
      mockReq.headers.origin = 'https://app.example.com';
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await router.nodeJSRequest(mockReq, mockRes, { cors: ['https://app.example.com'] });

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app.example.com'
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
    });

    it('should not reflect an origin that is not on the allowlist', async () => {
      mockReq.headers.origin = 'https://evil.example';
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await router.nodeJSRequest(mockReq, mockRes, { cors: ['https://app.example.com'] });

      expect(mockRes.setHeader).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://evil.example'
      );
      expect(mockRes.setHeader).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      );
    });

    it('passes proxyOptions through to request.proxyOptions ({} when omitted)', async () => {
      const seen: unknown[] = [];
      class ProxyRoutes extends Routes {
        constructor(r: Router) {
          super(r);
          this.addRoute('/test', 'GET', async (request) => {
            seen.push(request.proxyOptions);
            return { body: {} };
          });
        }
      }
      const proxyRouter = new Router({ initRoutes: [ProxyRoutes] });
      mockReq.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'end') callback();
        return mockReq;
      });
      const proxyOptions = { event: { stageVariables: { a: '1' } } };

      await proxyRouter.nodeJSRequest(mockReq, mockRes, { proxyOptions });
      await proxyRouter.nodeJSRequest(mockReq, mockRes);

      expect(seen).toEqual([proxyOptions, {}]);
      expect(seen[0]).toBe(proxyOptions);
    });

    describe('CORS allowlist enforcement', () => {
      const allowlist = ['https://app.example.com'];
      let handler: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
        const routeHandler = handler;
        class WriteRoutes extends Routes {
          constructor(router: Router) {
            super(router);
            this.addRoute('/test', ['GET', 'POST', 'DELETE'], routeHandler);
          }
        }
        router = new Router({ initRoutes: [WriteRoutes] });
        mockReq.headers.host = 'api.example.com';
        mockReq.on.mockImplementation((event: string, callback: (chunk?: Buffer) => void) => {
          if (event === 'data') callback(Buffer.from('{"email":"attacker@evil.test"}'));
          if (event === 'end') callback();
          return mockReq;
        });
      });

      const errorBody = () => JSON.parse(mockRes.end.mock.calls[0][0]);

      it('refuses a POST from a non-allowlisted origin before reading the body', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://evil.example';
        mockReq.headers['content-type'] = 'application/json';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(errorBody()).toEqual({
          success: false,
          error: { code: 'CORS_ORIGIN_FORBIDDEN', message: expect.any(String) },
        });
        expect(handler).not.toHaveBeenCalled();
        expect(mockReq.on).not.toHaveBeenCalled();
        expect(mockRes.setHeader).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          expect.anything()
        );
      });

      it('refuses a DELETE from a non-allowlisted origin', async () => {
        mockReq.method = 'DELETE';
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });

      it('answers a preflight from a non-allowlisted origin with 403', async () => {
        mockReq.method = 'OPTIONS';
        mockReq.headers.origin = 'https://evil.example';
        mockReq.headers['access-control-request-method'] = 'POST';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(errorBody().error.code).toBe('CORS_ORIGIN_FORBIDDEN');
        expect(mockRes.setHeader).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Methods',
          expect.anything()
        );
      });

      it('treats Origin "null" (sandboxed frame, file://) as cross-origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'null';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });

      it('still runs a GET from a non-allowlisted origin, without CORS headers', async () => {
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(mockRes.setHeader).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          expect.anything()
        );
        expect(mockRes.setHeader).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Credentials',
          'true'
        );
      });

      it('refuses a HEAD from a non-allowlisted origin, as Local does (only GET is exempt)', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        mockReq.method = 'HEAD';
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(errorBody().error.code).toBe('CORS_ORIGIN_FORBIDDEN');
        expect(handler).not.toHaveBeenCalled();
        expect(mockRes.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
      });

      it('logs ROUTER_CORS_ORIGIN_BLOCKED, flagging whether the request was refused', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });
        mockReq.method = 'POST';
        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(warn).toHaveBeenNthCalledWith(1, expect.any(String), {
          code: 'ROUTER_CORS_ORIGIN_BLOCKED',
          source: 'Router.nodeJSRequest',
          origin: 'https://evil.example',
          method: 'GET',
          rejected: false,
        });
        expect(warn).toHaveBeenNthCalledWith(
          2,
          expect.any(String),
          expect.objectContaining({ method: 'POST', rejected: true })
        );
      });

      it('bounds the logged origin and method', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        mockReq.method = 'POST';
        mockReq.headers.origin = `https://${'a'.repeat(500)}.example`;

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        const fields = warn.mock.calls[0][1] as { origin: string };
        expect(fields.origin).toHaveLength(200);
      });

      it('runs a POST from an allowlisted origin with credentialed CORS headers', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://app.example.com';
        mockReq.headers['content-type'] = 'application/json';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ body: { email: 'attacker@evil.test' } })
        );
        expect(mockRes.setHeader).toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          'https://app.example.com'
        );
        expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
      });

      it('answers a preflight from an allowlisted origin with 204', async () => {
        mockReq.method = 'OPTIONS';
        mockReq.headers.origin = 'https://app.example.com';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(204);
        expect(mockRes.setHeader).toHaveBeenCalledWith(
          'Access-Control-Allow-Methods',
          expect.any(String)
        );
      });

      it('runs a same-origin POST whose Origin host matches the Host header', async () => {
        mockReq.method = 'POST';
        mockReq.headers.host = 'API.Example.com:8443';
        mockReq.headers.origin = 'https://api.example.com:8443';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        // Same-origin needs no CORS grant.
        expect(mockRes.setHeader).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          expect.anything()
        );
      });

      it('does not treat a different port on the same host as same-origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.host = 'api.example.com:8443';
        mockReq.headers.origin = 'https://api.example.com:9443';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });

      it('runs a POST the browser marks Sec-Fetch-Site: same-origin', async () => {
        mockReq.method = 'POST';
        // e.g. a proxy in front rewrote Host to the upstream name.
        mockReq.headers.host = 'internal-upstream:3000';
        mockReq.headers.origin = 'https://www.example.com';
        mockReq.headers['sec-fetch-site'] = 'same-origin';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('does not accept Sec-Fetch-Site: same-site as same-origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://sibling.example.com';
        mockReq.headers['sec-fetch-site'] = 'same-site';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });

      it('lets Sec-Fetch-Site: cross-site override a matching Host', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://api.example.com';
        mockReq.headers['sec-fetch-site'] = 'cross-site';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });

      it('treats an unparseable Origin as cross-origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'not a url';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(403);
      });

      it('sends Vary: Origin on the 403 and never echoes the Origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
        expect(mockRes.end.mock.calls[0][0]).not.toContain('evil.example');
      });

      it('runs a POST with no Origin header (non-browser client)', async () => {
        mockReq.method = 'POST';

        await router.nodeJSRequest(mockReq, mockRes, { cors: allowlist });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('leaves cors: true permissive for a POST from any origin', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes, { cors: true });

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      });

      it('applies no origin check without cors', async () => {
        mockReq.method = 'POST';
        mockReq.headers.origin = 'https://evil.example';

        await router.nodeJSRequest(mockReq, mockRes);

        expect(mockRes.statusCode).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
      });
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
          this.addRoute('/test', 'POST', async (request) => ({ status: 201, body: request.body }));
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
          this.addRoute('/test', 'POST', async (request) => ({ status: 200, body: request.body }));
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

    it('treats an ECONNRESET while reading the body as a client abort (debug, no 500)', async () => {
      const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      class PostRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/test', 'POST', async () => ({ status: 200, body: {} }));
        }
      }
      router = new Router({ initRoutes: [PostRoutes] });
      mockReq.method = 'POST';
      mockReq.on.mockImplementation((event: string, callback: (error?: Error) => void) => {
        if (event === 'error') {
          callback(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
        }
        return mockReq;
      });

      await router.nodeJSRequest(mockReq, mockRes);

      expect(mockRes.end).not.toHaveBeenCalled();
      expect(mockRes.statusCode).toBe(0);
      expect(error).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'ROUTER_CLIENT_ABORTED', method: 'POST' })
      );
    });

    it('should handle Buffer responses', async () => {
      class BufferRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/buffer', 'GET', async () => ({
            status: 200,
            body: Buffer.from('test'),
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
            isBase64Encoded: true,
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
          this.addRoute('/protected', 'GET', async () => ({
            status: 200,
            body: { success: true },
          }));
        }
      }

      router = new Router({
        initRoutes: [TestRoutes],
        bearerToken: 'valid-token',
      });
    });

    it('should return 401 if Authorization header is missing', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/protected',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if bearer token is invalid', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/protected',
          },
        },
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(403);
    });

    it('should allow request with valid bearer token', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/protected',
          },
        },
        headers: {
          Authorization: 'Bearer valid-token',
        },
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
    });

    it('should handle lowercase authorization header', async () => {
      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/protected',
          },
        },
        headers: {
          authorization: 'Bearer valid-token',
        },
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Middleware', () => {
    it('should execute global middleware', async () => {
      const globalMiddleware = vi.fn(async (event: any) => {
        event.middlewareRan = true;
      });

      class TestRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/test', 'GET', async (event: any) => ({
            status: 200,
            body: { middlewareRan: event.middlewareRan },
          }));
        }
      }

      router = new Router({
        initRoutes: [TestRoutes],
        middleware: [globalMiddleware],
      });

      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/test',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(globalMiddleware).toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
    });

    it('should short-circuit on middleware response', async () => {
      const middleware = vi.fn(async () => ({
        status: 403,
        body: { error: 'Forbidden' },
      }));

      const handler = vi.fn(async () => ({
        status: 200,
        body: { success: true },
      }));

      class TestRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/test', 'GET', handler);
        }
      }

      router = new Router({
        initRoutes: [TestRoutes],
        middleware: [middleware],
      });

      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/test',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
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
            path: '/error',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toHaveProperty('error');
    });

    it('should handle handler returning non-object', async () => {
      class InvalidRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.addRoute('/invalid', 'GET', async () => 'not an object' as any);
        }
      }

      router = new Router({ initRoutes: [InvalidRoutes] });

      const event = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/invalid',
          },
        },
        headers: {},
      };

      const response = await router.eventFunction(event);
      expect(response.statusCode).toBe(500);
    });
  });
});

describe('Router eventFunction query parameters', () => {
  let capturedQuery: Record<string, string> | undefined;
  let router: Router;

  beforeEach(() => {
    capturedQuery = undefined;
    class QueryRoutes extends Routes {
      constructor(r: Router) {
        super(r);
        this.addRoute('/search', 'GET', async (request) => {
          capturedQuery = request.query;
          return { status: 200, body: request.query };
        });
      }
    }
    router = new Router({ initRoutes: [QueryRoutes] });
  });

  it('passes through query parameters that have values', async () => {
    const response = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/search' } },
      headers: {},
      queryStringParameters: { q: 'hello', page: '2' },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQuery).toEqual({ q: 'hello', page: '2' });
  });

  /**
   * The event type admits `undefined` values because AWS's own type does, but
   * `RouterRequest.query` promises `Record<string, string>`. Undefined values
   * used to be forwarded verbatim, so a handler could read `undefined` where a
   * string was promised.
   */
  it('drops query parameters sent without a value', async () => {
    await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/search' } },
      headers: {},
      queryStringParameters: { q: 'hello', empty: undefined },
    });

    expect(capturedQuery).not.toHaveProperty('empty');
    expect(Object.values(capturedQuery ?? {})).not.toContain(undefined);
  });

  it('defaults to an empty object when the event has no query parameters', async () => {
    await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/search' } },
      headers: {},
    });

    expect(capturedQuery).toEqual({});
  });
});

describe('RouterRequest.route', () => {
  const seen: { route?: string | undefined; middleware?: string | undefined } = {};
  let router: Router;

  beforeEach(() => {
    delete seen.route;
    delete seen.middleware;
    class TestRoutes extends Routes {
      constructor(r: Router) {
        super(r);
        const capture = async (request: { route?: string }) => {
          seen.route = request.route;
          return { status: 200, body: 'ok' };
        };
        this.addRoute('/static', 'GET', capture);
        this.addRoute('/users/:id', 'GET', capture);
        this.addRoute('//double//slash', 'GET', capture);
      }
    }
    router = new Router({
      initRoutes: [TestRoutes],
      middleware: [
        async (request) => {
          seen.middleware = request.route;
          return null;
        },
      ],
    });
  });

  const viaEvent = (path: string) =>
    router.eventFunction({ requestContext: { http: { method: 'GET', path } }, headers: {} });

  const viaNode = async (path: string) => {
    const req = {
      url: path,
      method: 'GET',
      headers: { host: 'localhost:3000' },
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'end') cb();
        return req;
      }),
    };
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
    await router.nodeJSRequest(req as never, res as never);
    return res;
  };

  it.each([
    ['/users/abc-secret', '/users/:id'],
    ['/static', '/static'],
    ['/static/', '/static'],
    ['/double/slash', '/double/slash'],
  ])('eventFunction %s -> route %s, set before middleware', async (path, route) => {
    const response = await viaEvent(path);
    expect(response.statusCode).toBe(200);
    expect(seen.route).toBe(route);
    expect(seen.middleware).toBe(route);
  });

  it.each([
    ['/users/abc-secret?x=1', '/users/:id'],
    ['/static', '/static'],
  ])('nodeJSRequest %s -> route %s', async (path, route) => {
    const res = await viaNode(path);
    expect(res.statusCode).toBe(200);
    expect(seen.route).toBe(route);
    expect(seen.middleware).toBe(route);
  });

  it('is unset when no route matched', async () => {
    const response = await viaEvent('/missing');
    expect(response.statusCode).toBe(404);
    expect(seen).not.toHaveProperty('route');
  });

  it('ignores an event routeKey such as $default', async () => {
    await router.eventFunction({
      routeKey: '$default',
      requestContext: { http: { method: 'GET', path: '/users/7' } },
      headers: {},
    } as never);
    expect(seen.route).toBe('/users/:id');
  });
});
