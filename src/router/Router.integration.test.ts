import { describe, it, expect, afterEach } from 'vitest';
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
