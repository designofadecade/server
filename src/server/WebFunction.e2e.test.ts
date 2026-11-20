import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Http from 'node:http';
import { createServer as createNetServer } from 'node:net';
import Server from './Server.ts';
import WebFunction from './WebFunction.ts';
import Router from '../router/Router.ts';
import Routes from '../router/Routes.ts';
import type { RouterRequest } from '../router/Router.ts';
import { logger } from '../logger/Logger.ts';

/**
 * Drives the Web Function mode over real sockets, the way Lambda does: the
 * process is told where to listen through AWS_LAMBDA_HTTP_ENDPOINT and talks
 * plain HTTP/1.1 to a proxy that appends X-Forwarded-For and sets
 * lambda-web-request-id.
 */

const ENV = Server.WEB_FUNCTION_ENDPOINT_ENV;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const get = (
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Http.IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const req = Http.request({ host: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

class EchoRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/echo', 'GET', async (request: RouterRequest) => ({
      body: { clientIp: request.clientIp, requestId: request.requestId },
    }));
    this.addRoute('/cookies', 'GET', async () => ({
      headers: { 'set-cookie': ['a=1; Path=/; HttpOnly', 'b=2, with comma; Path=/'] },
      body: { ok: true },
    }));
    this.addRoute('/slow', 'GET', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { body: { late: true } };
    });
  }
}

describe('WebFunction over real sockets', () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('as a Lambda Web Function', () => {
    let port: number;

    beforeEach(async () => {
      port = await freePort();
      vi.stubEnv(ENV, `127.0.0.1:${port}`);
    });

    it('binds AWS_LAMBDA_HTTP_ENDPOINT, ignoring the port option', async () => {
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }), { port: 1 });
      await server.ready;

      expect(server.address).toEqual({ host: '127.0.0.1', port });
      expect((await get(port, '/echo')).status).toBe(200);
    });

    it('takes clientIp from the last X-Forwarded-For entry, which Lambda appends', async () => {
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }));
      await server.ready;

      const res = await get(port, '/echo', {
        'x-forwarded-for': '6.6.6.6, 203.0.113.9',
        'lambda-web-request-id': 'req-123',
      });

      expect(JSON.parse(res.body)).toEqual({ clientIp: '203.0.113.9', requestId: 'req-123' });
    });

    it('skips trusted front-door hops such as CloudFront', async () => {
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes], trustedProxies: 1 }));
      await server.ready;

      // spoofed by client, then CloudFront saw the viewer, then Lambda saw CloudFront.
      const res = await get(port, '/echo', {
        'x-forwarded-for': '6.6.6.6, 198.51.100.4, 130.176.0.1',
      });

      expect(JSON.parse(res.body).clientIp).toBe('198.51.100.4');
    });

    it('sends multiple Set-Cookie headers natively, commas intact', async () => {
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }));
      await server.ready;

      const res = await get(port, '/cookies');

      expect(res.headers['set-cookie']).toEqual([
        'a=1; Path=/; HttpOnly',
        'b=2, with comma; Path=/',
      ]);
    });

    it('drains on SIGTERM by default', async () => {
      const before = process.listenerCount('SIGTERM');
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }));
      await server.ready;
      expect(process.listenerCount('SIGTERM')).toBe(before + 1);

      const closed = new Promise((resolve) => server!.once('close', resolve));
      process.emit('SIGTERM', 'SIGTERM');
      await closed;

      expect(process.listenerCount('SIGTERM')).toBe(before);
      await expect(get(port, '/echo')).rejects.toThrow();
    });

    it('cuts an in-flight request after shutdownTimeoutMs rather than hanging', async () => {
      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }), {
        shutdownTimeoutMs: 50,
      });
      await server.ready;

      const inFlight = get(port, '/slow');
      await new Promise((resolve) => setTimeout(resolve, 20));

      const started = Date.now();
      await server.close();

      expect(Date.now() - started).toBeLessThan(1_000);
      await expect(inFlight).rejects.toThrow();
    });

    it('rejects a malformed endpoint instead of guessing an address', () => {
      vi.stubEnv(ENV, 'not-an-endpoint');
      expect(() => WebFunction.serve(new Router())).toThrow(/host:port/);
    });
  });

  describe('as a plain Node server (local)', () => {
    it('listens on the port option and ignores X-Forwarded-For for clientIp', async () => {
      vi.stubEnv(ENV, '');
      const port = await freePort();
      const before = process.listenerCount('SIGTERM');

      server = WebFunction.serve(new Router({ initRoutes: [EchoRoutes] }), {
        port,
        host: '127.0.0.1',
      });
      await server.ready;

      // Node's default SIGTERM behaviour is left alone outside Lambda.
      expect(process.listenerCount('SIGTERM')).toBe(before);

      const res = await get(port, '/echo', {
        'x-forwarded-for': '6.6.6.6',
        'lambda-web-request-id': 'forged-by-client',
      });
      const body = JSON.parse(res.body);

      expect(body.clientIp).toBe('127.0.0.1');
      expect(body.requestId).not.toBe('forged-by-client');
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('answers 500 and keeps serving when nodeJSRequest itself rejects', async () => {
      vi.stubEnv(ENV, '');
      const port = await freePort();
      const router = new Router({ initRoutes: [EchoRoutes] });
      const real = router.nodeJSRequest.bind(router);
      const spy = vi
        .spyOn(router, 'nodeJSRequest')
        .mockRejectedValueOnce(new Error('bug inside nodeJSRequest'))
        .mockImplementation(real);
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      try {
        server = WebFunction.serve(router, { port, host: '127.0.0.1' });
        await server.ready;

        const failed = await get(port, '/echo');
        expect(failed.status).toBe(500);
        expect(failed.body).toBe('');

        // The environment survives: the next request is served normally.
        expect((await get(port, '/echo')).status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(2);
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('rejects ready when the port is taken', async () => {
      vi.stubEnv(ENV, '');
      const port = await freePort();
      const first = new Server({ port, host: '127.0.0.1' }, (_req, res) => res.end());
      await first.ready;
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      try {
        server = new Server({ port, host: '127.0.0.1' }, (_req, res) => res.end());
        server.on('error', () => {});
        await expect(server.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
      } finally {
        await first.close();
      }
    });
  });
});

describe('Server lifecycle over real sockets', () => {
  beforeEach(() => {
    vi.stubEnv(ENV, '');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves a repeat close() without re-closing or logging an error', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const server = new Server({ port: await freePort(), host: '127.0.0.1' }, (_q, r) => r.end());
    await server.ready;

    await server.close();
    await expect(server.close()).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
  });

  it('shares one close between concurrent callers', async () => {
    const server = new Server({ port: await freePort(), host: '127.0.0.1' }, (_q, r) => r.end());
    await server.ready;

    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
  });

  it('waits for startup when closed before listening (SIGTERM during init)', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const server = new Server({ port: await freePort(), host: '127.0.0.1' }, (_q, r) => r.end());

    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.ready).resolves.toBeUndefined();
    expect(server.server).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('drops its SIGTERM listener when startup fails, and close() then resolves', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const port = await freePort();
    const holder = new Server({ port, host: '127.0.0.1' }, (_q, r) => r.end());
    await holder.ready;
    const before = process.listenerCount('SIGTERM');

    try {
      const failed = new Server({ port, host: '127.0.0.1', handleSignals: true }, (_q, r) =>
        r.end()
      );
      failed.on('error', () => {});
      expect(process.listenerCount('SIGTERM')).toBe(before + 1);

      await expect(failed.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(process.listenerCount('SIGTERM')).toBe(before);
      await expect(failed.close()).resolves.toBeUndefined();
    } finally {
      await holder.close();
    }
  });
});

describe('Server.parseEndpoint', () => {
  it.each([
    ['127.0.0.1:8080', { host: '127.0.0.1', port: 8080 }],
    ['localhost:9000', { host: 'localhost', port: 9000 }],
    ['[::1]:3000', { host: '::1', port: 3000 }],
    [' 0.0.0.0:443 ', { host: '0.0.0.0', port: 443 }],
  ])('parses %s', (value, expected) => {
    expect(Server.parseEndpoint(value)).toEqual(expected);
  });

  it.each(['8080', 'host:', ':8080', 'host:0', 'host:70000', 'a b:80', '::1:80'])(
    'rejects %s',
    (value) => {
      expect(() => Server.parseEndpoint(value)).toThrow(/host:port/);
    }
  );
});
