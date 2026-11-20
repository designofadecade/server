import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Http from 'node:http';
import { createServer as createNetServer, createConnection } from 'node:net';
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

/** Raw HTTP/1.1 exchange, for what `http.request` hides (100 Continue). */
const rawExchange = (
  port: number,
  head: string,
  { body, afterContinue = false }: { body?: string; afterContinue?: boolean } = {}
): Promise<string> =>
  new Promise((resolve) => {
    const socket = createConnection(port, '127.0.0.1');
    let data = '';
    let sentBody = false;
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (afterContinue && body && !sentBody && data.includes('100 Continue')) {
        sentBody = true;
        socket.write(body);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => resolve(data));
    socket.write(head);
    setTimeout(() => socket.destroy(), 500).unref();
  });

class UploadRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/upload', 'POST', async (request: RouterRequest) => ({
      body: { received: request.body },
    }));
  }
}

describe('Expect: 100-continue against the body limit', () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.stubEnv(ENV, '');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses an oversized announced body with 413 instead of 100 Continue', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const handler = vi.fn();
    const port = await freePort();
    server = new Server({ port, host: '127.0.0.1', maxBodyBytes: 100 }, handler);
    await server.ready;

    const data = await rawExchange(
      port,
      'POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5000000\r\n\r\n'
    );

    expect(data).not.toContain('100 Continue');
    expect(data.startsWith('HTTP/1.1 413')).toBe(true);
    expect(data).toMatch(/connection: close/i);
    expect(data).toContain('PAYLOAD_TOO_LARGE');
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'SERVER_PAYLOAD_TOO_LARGE', maxBodyBytes: 100 })
    );
  });

  it('sends 100 Continue for a body within the limit and serves the request', async () => {
    const port = await freePort();
    server = WebFunction.serve(new Router({ initRoutes: [UploadRoutes], maxBodyBytes: 100 }), {
      port,
      host: '127.0.0.1',
    });
    await server.ready;

    const data = await rawExchange(
      port,
      'POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\n',
      { body: 'hello', afterContinue: true }
    );

    expect(data.startsWith('HTTP/1.1 100 Continue')).toBe(true);
    expect(data).toContain('HTTP/1.1 200');
    expect(data).toContain('"received":"hello"');
  });

  it('WebFunction.serve wires the router limit in automatically', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await freePort();
    server = WebFunction.serve(new Router({ initRoutes: [UploadRoutes], maxBodyBytes: 100 }), {
      port,
      host: '127.0.0.1',
    });
    await server.ready;

    const data = await rawExchange(
      port,
      'POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 101\r\n\r\n'
    );

    expect(data).not.toContain('100 Continue');
    expect(data.startsWith('HTTP/1.1 413')).toBe(true);
  });

  it("keeps Node's automatic 100 Continue when no limit is given", async () => {
    const port = await freePort();
    server = new Server({ port, host: '127.0.0.1' }, (req, res) => {
      req.resume();
      req.on('end', () => res.end('ok'));
    });
    await server.ready;

    const data = await rawExchange(
      port,
      'POST / HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5000000\r\n\r\n'
    );

    expect(data.startsWith('HTTP/1.1 100 Continue')).toBe(true);
  });

  it('does not serve a request pipelined behind a refused 100-continue body', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const handler = vi.fn((_req: Http.IncomingMessage, res: Http.ServerResponse) => res.end('ok'));
    const port = await freePort();
    server = new Server({ port, host: '127.0.0.1', maxBodyBytes: 10 }, handler);
    await server.ready;

    // The client sends the body without waiting, then a second request.
    const data = await rawExchange(
      port,
      'POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 20\r\n\r\n' +
        'a'.repeat(20) +
        'GET /next HTTP/1.1\r\nHost: x\r\n\r\n'
    );

    expect(data.startsWith('HTTP/1.1 413')).toBe(true);
    expect(data.match(/HTTP\/1\.1 \d{3}/g)).toEqual(['HTTP/1.1 413']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not run a route pipelined behind a refused 100-continue body (WebFunction)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const hits: string[] = [];
    class Tracked extends Routes {
      constructor(router: Router) {
        super(router);
        this.addRoute('/next', 'GET', async () => {
          hits.push('GET /next');
          return { body: { ok: true } };
        });
      }
    }
    const port = await freePort();
    server = WebFunction.serve(new Router({ initRoutes: [Tracked], maxBodyBytes: 10 }), {
      port,
      host: '127.0.0.1',
    });
    await server.ready;

    const data = await rawExchange(
      port,
      'POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 20\r\n\r\n' +
        'a'.repeat(20) +
        'GET /next HTTP/1.1\r\nHost: x\r\n\r\n'
    );

    expect(data.startsWith('HTTP/1.1 413')).toBe(true);
    expect(hits).toEqual([]);
  });

  it('delivers the 413 to a client that uploads anyway after its continue timeout', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await freePort();
    server = new Server({ port, host: '127.0.0.1', maxBodyBytes: 100 }, (_req, res) =>
      res.end('ok')
    );
    await server.ready;

    // The client reads nothing until its upload is done, so the 413 sits
    // unread in its receive buffer: a reset from the server would discard it.
    const size = 1024 * 1024;
    const upload = (): Promise<string> =>
      new Promise((resolve) => {
        const socket = createConnection(port, '127.0.0.1');
        let data = '';
        socket.pause();
        socket.on('data', (chunk) => (data += chunk.toString('latin1')));
        socket.on('error', (error: NodeJS.ErrnoException) => resolve(`error ${error.code}`));
        socket.on('close', () => resolve(data));
        socket.write(
          `POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: ${size}\r\n\r\n`
        );
        // Like curl after its continue wait: send the body regardless.
        setTimeout(() => {
          socket.write(Buffer.alloc(size, 97), () => {
            setTimeout(() => socket.resume(), 50);
          });
        }, 30);
        setTimeout(() => socket.destroy(), 3000).unref();
      });

    for (let run = 0; run < 10; run++) {
      expect((await upload()).slice(0, 12)).toBe('HTTP/1.1 413');
    }
  }, 30_000);

  it.each([0, -1, 1.5, NaN])('rejects maxBodyBytes %s', (value) => {
    expect(() => new Server({ maxBodyBytes: value }, () => {})).toThrow(/maxBodyBytes/);
  });
});

describe('Server slow-client timeouts', () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const start = async (options: ConstructorParameters<typeof Server>[0] = {}) => {
    server = new Server({ port: await freePort(), host: '127.0.0.1', ...options }, (_q, r) =>
      r.end()
    );
    await server.ready;
    return server.server!;
  };

  it('defaults to 30 s for the request and 10 s for its headers on a Node host', async () => {
    vi.stubEnv(ENV, '');
    const http = await start();

    expect(http.requestTimeout).toBe(30_000);
    expect(http.headersTimeout).toBe(10_000);
  });

  it('takes explicit values', async () => {
    vi.stubEnv(ENV, '');
    const http = await start({ requestTimeout: 120_000, headersTimeout: 5_000 });

    expect(http.requestTimeout).toBe(120_000);
    expect(http.headersTimeout).toBe(5_000);
  });

  it('caps the default headersTimeout at a shorter requestTimeout', async () => {
    vi.stubEnv(ENV, '');
    const http = await start({ requestTimeout: 4_000 });

    expect(http.headersTimeout).toBe(4_000);
  });

  it('allows requestTimeout: 0 (disabled) with the default headersTimeout', async () => {
    vi.stubEnv(ENV, '');
    const http = await start({ requestTimeout: 0 });

    expect(http.requestTimeout).toBe(0);
    expect(http.headersTimeout).toBe(10_000);
  });

  it("keeps Node's defaults in a Web Function, where Lambda delivers requests whole", async () => {
    const port = await freePort();
    vi.stubEnv(ENV, `127.0.0.1:${port}`);
    server = new Server({ handleSignals: false }, (_q, r) => r.end());
    await server.ready;
    const reference = Http.createServer();

    expect(server.server!.requestTimeout).toBe(reference.requestTimeout);
    expect(server.server!.headersTimeout).toBe(reference.headersTimeout);
  });

  it('applies explicit values in a Web Function too', async () => {
    const port = await freePort();
    vi.stubEnv(ENV, `127.0.0.1:${port}`);
    server = new Server({ handleSignals: false, requestTimeout: 60_000 }, (_q, r) => r.end());
    await server.ready;

    expect(server.server!.requestTimeout).toBe(60_000);
  });

  it('does not cut a handler that runs longer than requestTimeout', async () => {
    vi.stubEnv(ENV, '');
    const port = await freePort();
    server = new Server(
      { port, host: '127.0.0.1', requestTimeout: 200, headersTimeout: 100 },
      (req, res) => {
        req.resume();
        req.on('end', () => setTimeout(() => res.end('late'), 600));
      }
    );
    await server.ready;

    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: 'x' });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('late');
  });

  it.each([
    [{ requestTimeout: -1 }, /requestTimeout/],
    [{ requestTimeout: 1.5 }, /requestTimeout/],
    [{ headersTimeout: NaN }, /headersTimeout/],
    [{ requestTimeout: 1000, headersTimeout: 2000 }, /headersTimeout must not exceed/],
  ])('rejects %o', (options, message) => {
    vi.stubEnv(ENV, '');
    expect(() => new Server(options, () => {})).toThrow(message);
  });
});

describe('Server events and helpers', () => {
  beforeEach(() => {
    vi.stubEnv(ENV, '');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits 'listening' with the bound address and 'close' once closed", async () => {
    const port = await freePort();
    const server = new Server({ port, host: '127.0.0.1' }, (_q, r) => r.end());
    const listening = vi.fn();
    const closed = vi.fn();
    server.on('listening', listening);
    server.on('close', closed);

    await server.ready;
    expect(listening).toHaveBeenCalledWith({ host: '127.0.0.1', port });

    await server.close();
    await server.close();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('isWebFunction reads AWS_LAMBDA_HTTP_ENDPOINT', () => {
    expect(Server.isWebFunction({ [ENV]: '127.0.0.1:8080' })).toBe(true);
    expect(Server.isWebFunction({ [ENV]: '' })).toBe(false);
    expect(Server.isWebFunction({})).toBe(false);
    vi.stubEnv(ENV, '127.0.0.1:9000');
    expect(Server.isWebFunction()).toBe(true);
  });

  it('closes idle keep-alive connections at once instead of waiting out the timeout', async () => {
    const port = await freePort();
    const server = new Server({ port, host: '127.0.0.1', shutdownTimeoutMs: 10_000 }, (_q, r) =>
      r.end('ok')
    );
    await server.ready;
    const agent = new Http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      Http.get({ host: '127.0.0.1', port, agent }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      }).on('error', reject);
    });
    // The socket now sits idle in the agent's pool, kept alive.
    expect(Object.keys(agent.freeSockets)).toHaveLength(1);

    const started = Date.now();
    await server.close();

    expect(Date.now() - started).toBeLessThan(1000);
    agent.destroy();
  });

  it('lets an in-flight request finish while draining', async () => {
    const port = await freePort();
    const server = new Server({ port, host: '127.0.0.1', shutdownTimeoutMs: 5_000 }, (_q, r) => {
      setTimeout(() => r.end('done'), 200);
    });
    await server.ready;

    const response = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 50));
    const closing = server.close();

    expect(await response).toBe('done');
    await closing;
  });
});
