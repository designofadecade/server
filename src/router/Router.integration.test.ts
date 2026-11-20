import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import Router from './Router.ts';
import Routes from './Routes.ts';

/**
 * Integration tests that drive a real http.Server over a real socket.
 *
 * The mocked unit tests cannot prove the things that actually matter here: that
 * a malformed Host header produces a 400 instead of taking the process down,
 * that an oversized body is refused mid-stream, or that a forged JWT never
 * reaches a handler. Each of these was verified by hand while fixing the
 * corresponding vulnerability; these tests keep them verified.
 */

const SECRET = 'integration-signing-secret';

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const signToken = (claims: Record<string, unknown>, secret = SECRET): string => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};

/** Well-formed payload, signature never computed. */
const forgeToken = (claims: Record<string, unknown>): string =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.AAAA`;

interface Live {
  port: number;
  close: () => Promise<void>;
}

const listen = (router: Router, options?: Record<string, unknown>): Promise<Live> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void router.nodeJSRequest(req, res, options);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });

interface Reply {
  status?: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const request = (
  port: number,
  path: string,
  {
    method = 'GET',
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = http.request({ port, host: '127.0.0.1', path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

/** Sends a raw request line so malformed headers reach the server verbatim. */
const rawRequest = (port: number, raw: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(raw));
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
  });

let live: Live | undefined;

afterEach(async () => {
  await live?.close();
  live = undefined;
});

class EchoRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/echo', 'GET', async (request) => ({
      status: 200,
      body: { authorizer: request.authorizer ?? null, query: request.query },
    }));
    this.addRoute('/echo', 'POST', async (request) => ({
      status: 200,
      body: { received: request.body },
    }));
    this.addRoute('/guarded', 'GET', async () => ({ status: 200, body: 'reached handler' }), [
      async () => ({ status: 418, body: 'stopped by middleware' }),
    ]);
  }
}

describe('Router integration', () => {
  describe('malformed requests', () => {
    it('should answer 400 to a malformed Host header and stay alive', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }));

      // 'a b' makes the URL constructor throw. This used to escape as an
      // unhandled rejection and could terminate the process.
      const first = await rawRequest(
        live.port,
        'GET /echo HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n'
      );
      expect(first).toContain('400');

      // The server must still be serving after the malformed request.
      const second = await request(live.port, '/echo');
      expect(second.status).toBe(200);
    });

    it('should refuse a body over the size limit', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }));

      const response = await request(live.port, '/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(2 * 1024 * 1024),
      }).catch((error: Error) => error);

      // Either a 500 from the rejected promise or a destroyed socket is
      // acceptable; silently buffering 2MB is not.
      if (response instanceof Error) {
        expect(response.message).toBeTruthy();
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('should fall back to raw text when a JSON body does not parse', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }));

      const response = await request(live.port, '/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'this is not json',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).received).toBe('this is not json');
    });
  });

  /**
   * The path is taken verbatim from the request target. Resolving it as a URL
   * turned `//x/admin` into `/admin` and removed dot segments, so a proxy in
   * front guarding `/admin` judged one path and the router served another.
   * Sent over a raw socket: `http.request` would normalise some of these.
   */
  describe('request target', () => {
    const reached = vi.fn();

    class TargetRoutes extends Routes {
      constructor(router: Router) {
        super(router);
        this.addRoute('/admin', ['GET', 'POST'], async () => {
          reached('/admin');
          return { status: 200, body: 'admin' };
        });
        this.addRoute('/admin/users', 'GET', async () => {
          reached('/admin/users');
          return { status: 200, body: 'admin users' };
        });
        this.addRoute('/files/:name', 'GET', async (request) => ({
          status: 200,
          body: { name: request.params.name, path: request.path },
        }));
        this.addRoute('/search', 'GET', async (request) => ({
          status: 200,
          body: { query: request.query, path: request.path },
        }));
      }
    }

    const send = (port: number, target: string, method = 'GET') =>
      rawRequest(
        port,
        `${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`
      );

    const statusOf = (raw: string) => Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);
    const bodyOf = (raw: string) => raw.slice(raw.indexOf('\r\n\r\n') + 4);

    it.each([
      '//x/admin',
      '//x/admin/users',
      '/\\x/admin',
      '/pub/../admin',
      '/pub/%2e%2e/admin',
      '/pub/%2E%2e/admin',
      '/pub/.%2E/admin',
      '/./admin',
      '/admin/.',
      '/admin/users/..',
      'http://x/admin',
      'http://localhost/admin',
      '*',
      '/admin%00',
      '/admin?x=%00',
      '/admin#frag',
    ])('refuses %j with 400 and never reaches /admin', async (target) => {
      reached.mockClear();
      live = await listen(new Router({ initRoutes: [TargetRoutes] }));

      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const raw = await send(live.port, target, method);
        expect(statusOf(raw), `${method} ${target}`).toBe(400);
        expect(JSON.parse(bodyOf(raw))).toEqual({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request URL' },
        });
      }
      expect(reached).not.toHaveBeenCalled();
    });

    it('serves ordinary paths exactly as before', async () => {
      live = await listen(new Router({ initRoutes: [TargetRoutes] }));

      expect(statusOf(await send(live.port, '/admin'))).toBe(200);
      expect(statusOf(await send(live.port, '/admin/'))).toBe(200);
      expect(statusOf(await send(live.port, '/admin/users/'))).toBe(200);

      // Params stay percent-encoded, as URLPattern always gave them.
      const spaced = JSON.parse(bodyOf(await send(live.port, '/files/a%20b')));
      expect(spaced).toEqual({ name: 'a%20b', path: '/files/a%20b' });

      // Characters URL parsing percent-encoded are still encoded.
      const quoted = JSON.parse(bodyOf(await send(live.port, '/files/a"b{c}')));
      expect(quoted).toEqual({ name: 'a%22b%7Bc%7D', path: '/files/a%22b%7Bc%7D' });

      // Dots inside a segment are not dot segments.
      const dotted = JSON.parse(bodyOf(await send(live.port, '/files/.env...')));
      expect(dotted.name).toBe('.env...');

      const search = JSON.parse(
        bodyOf(await send(live.port, '/search?next=/a?b=c&q=1&q=2&e=a+b%20c&flag'))
      );
      expect(search).toEqual({
        path: '/search',
        query: { next: '/a?b=c', q: '2', e: 'a b c', flag: '' },
      });
    });

    it('still serves after refusing a target', async () => {
      live = await listen(new Router({ initRoutes: [TargetRoutes] }));
      expect(statusOf(await send(live.port, '//x/admin'))).toBe(400);
      const ok = await request(live.port, '/admin');
      expect(ok.status).toBe(200);
    });
  });

  describe('JWT authorizer', () => {
    it('should leave authorizer null when no jwt option is configured', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }));

      const response = await request(live.port, '/echo', {
        headers: { authorization: `Bearer ${forgeToken({ sub: 'admin', isAdmin: true })}` },
      });

      expect(JSON.parse(response.body).authorizer).toBeNull();
    });

    it('should reject a forged token when a secret is configured', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes], jwt: { secret: SECRET } }));

      const response = await request(live.port, '/echo', {
        headers: { authorization: `Bearer ${forgeToken({ sub: 'admin', isAdmin: true })}` },
      });

      expect(JSON.parse(response.body).authorizer).toBeNull();
    });

    it('should expose claims from a correctly signed token', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes], jwt: { secret: SECRET } }));

      const response = await request(live.port, '/echo', {
        headers: { authorization: `Bearer ${signToken({ sub: 'real-user' })}` },
      });

      expect(JSON.parse(response.body).authorizer).toEqual({ lambda: { sub: 'real-user' } });
    });
  });

  describe('bearer token', () => {
    it('should answer 401 when the Authorization header is missing', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes], bearerToken: 'let-me-in' }));

      const response = await request(live.port, '/echo');

      expect(response.status).toBe(401);
    });

    it('should answer 403 for the wrong token', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes], bearerToken: 'let-me-in' }));

      const response = await request(live.port, '/echo', {
        headers: { authorization: 'Bearer wrong-token' },
      });

      expect(response.status).toBe(403);
    });

    it('should allow the correct token', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes], bearerToken: 'let-me-in' }));

      const response = await request(live.port, '/echo', {
        headers: { authorization: 'Bearer let-me-in' },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('CORS', () => {
    it('should send an anonymous wildcard for cors: true', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }), { cors: true });

      const response = await request(live.port, '/echo', {
        headers: { origin: 'https://evil.example' },
      });

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should reflect and credential only an allowlisted origin', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }), {
        cors: ['https://app.example.com'],
      });

      const allowed = await request(live.port, '/echo', {
        headers: { origin: 'https://app.example.com' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers['vary']).toBe('Origin');

      const blocked = await request(live.port, '/echo', {
        headers: { origin: 'https://evil.example' },
      });
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
      expect(blocked.headers['access-control-allow-credentials']).toBeUndefined();
      // A safe method still runs; only the response is unreadable cross-origin.
      expect(blocked.status).toBe(200);
    });

    it('should refuse a forged cross-origin POST before the route runs', async () => {
      let reached = false;
      class SpyRoutes extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/account/email', 'POST', async () => {
            reached = true;
            return { status: 200, body: 'changed' };
          });
        }
      }
      live = await listen(new Router({ initRoutes: [SpyRoutes] }), {
        cors: ['https://app.example.com'],
      });

      const forged = await request(live.port, '/account/email', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'text/plain;application/json',
          cookie: 'session=victim',
        },
        body: JSON.stringify({ email: 'attacker@evil.test' }),
      });
      expect(forged.status).toBe(403);
      expect(JSON.parse(forged.body).error.code).toBe('CORS_ORIGIN_FORBIDDEN');
      expect(forged.headers['vary']).toBe('Origin');
      expect(reached).toBe(false);

      const preflight = await request(live.port, '/account/email', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers['access-control-allow-methods']).toBeUndefined();

      // The site's own pages: Origin host matches Host.
      const sameOrigin = await request(live.port, '/account/email', {
        method: 'POST',
        headers: { origin: `http://127.0.0.1:${live.port}` },
        body: '{}',
      });
      expect(sameOrigin.status).toBe(200);
      expect(reached).toBe(true);
    });

    it('should let an allowlisted origin POST with credentials', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }), {
        cors: ['https://app.example.com'],
      });

      const response = await request(live.port, '/echo', {
        method: 'POST',
        headers: { origin: 'https://app.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ received: { a: 1 } });
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should leave cors: true permissive for cross-origin POSTs', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }), { cors: true });

      const response = await request(live.port, '/echo', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('route middleware', () => {
    it('should short-circuit when route middleware returns a response', async () => {
      live = await listen(new Router({ initRoutes: [EchoRoutes] }));

      const response = await request(live.port, '/guarded');

      expect(response.status).toBe(418);
      expect(response.body).toContain('stopped by middleware');
    });
  });
});
