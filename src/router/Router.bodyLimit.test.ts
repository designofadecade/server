import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import Router from './Router.ts';
import Routes from './Routes.ts';
import type { RouterRequest } from './Router.ts';
import { logger } from '../logger/Logger.ts';

/**
 * Found by running the package in the Lambda Node 24 image: a body over the
 * limit made the Node transport destroy the socket (the client saw "other side
 * closed", no status), the Event Function transport had no limit at all, and
 * bodies were decoded chunk by chunk, corrupting multi-byte characters that
 * straddled a chunk boundary.
 */

const handler = vi.fn(async (req: RouterRequest) => ({ body: { received: req.body } }));

class BodyRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/items', 'POST', handler);
  }
}

const servers: http.Server[] = [];
afterEach(async () => {
  handler.mockClear();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(() => r(null)));
    })
  );
});

const listen = async (router: Router): Promise<number> => {
  const server = http.createServer((req, res) => void router.nodeJSRequest(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

const post = (
  port: number,
  chunks: Buffer[],
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/items', method: 'POST', headers, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      }
    );
    // The server may close while we are still sending; the response is what matters.
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') reject(err);
    });
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });

describe('Router body limit over a real socket (nodeJSRequest)', () => {
  it('answers 413 from Content-Length alone, without running the route', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 }));
    const body = Buffer.from(JSON.stringify({ x: 'y'.repeat(200) }));

    const res = await post(port, [body], {
      'content-type': 'application/json',
      'content-length': String(body.length),
    });

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.headers.connection).toBe('close');
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers 413 to a chunked body that grows past the limit (no Content-Length)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 1000 }));

    const res = await post(port, [Buffer.alloc(600, 'a'), Buffer.alloc(600, 'b')], {
      'content-type': 'text/plain',
      'transfer-encoding': 'chunked',
    });

    expect(res.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'ROUTER_PAYLOAD_TOO_LARGE', maxBodyBytes: 1000 })
    );
  });

  it('defaults to 1 MiB', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));
    const atLimit = Buffer.alloc(1024 * 1024, 'a');
    const over = Buffer.alloc(1024 * 1024 + 1, 'a');

    const ok = await post(port, [atLimit], { 'content-type': 'text/plain' });
    const refused = await post(port, [over], { 'content-type': 'text/plain' });

    expect(ok.status).toBe(200);
    expect(refused.status).toBe(413);
  });

  it('keeps serving after a 413', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 10 }));

    expect(
      (await post(port, [Buffer.alloc(50, 'a')], { 'content-type': 'text/plain' })).status
    ).toBe(413);
    const ok = await post(port, [Buffer.from('{"a":1}')], { 'content-type': 'application/json' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).received).toEqual({ a: 1 });
  });

  it('decodes a multi-byte character split across two chunks intact', async () => {
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));
    const text = JSON.stringify({ name: 'café 🎉 naïve' });
    const bytes = Buffer.from(text, 'utf8');
    const emoji = bytes.indexOf(Buffer.from('🎉', 'utf8'));
    // Split inside the four-byte emoji.
    const chunks = [bytes.subarray(0, emoji + 2), bytes.subarray(emoji + 2)];

    const res = await post(port, chunks, { 'content-type': 'application/json' });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).received).toEqual({ name: 'café 🎉 naïve' });
  });
});

describe('Router body limit on the Event Function transport', () => {
  const event = (body: string, isBase64Encoded = false) => ({
    requestContext: { http: { method: 'POST', path: '/items' } },
    headers: { 'content-type': 'text/plain' },
    body,
    isBase64Encoded,
  });

  it('answers 413 to a body over the limit without running the route', async () => {
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 });
    const result = await router.eventFunction(event('x'.repeat(101)));

    expect(result.statusCode).toBe(413);
    expect(JSON.parse(result.body as string).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts a body exactly at the limit', async () => {
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 });
    expect((await router.eventFunction(event('x'.repeat(100)))).statusCode).toBe(200);
  });

  it('measures UTF-8 bytes, not characters', async () => {
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 10 });
    // 5 characters, 20 bytes.
    expect((await router.eventFunction(event('🎉🎉🎉🎉🎉'))).statusCode).toBe(413);
  });

  it('measures a base64 body by its decoded size', async () => {
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 });
    const at = Buffer.alloc(100, 1).toString('base64'); // 136 chars, 100 bytes
    const over = Buffer.alloc(101, 1).toString('base64');

    expect((await router.eventFunction(event(at, true))).statusCode).not.toBe(413);
    expect((await router.eventFunction(event(over, true))).statusCode).toBe(413);
  });

  it('defaults to 1 MiB, the same as the Node transport', async () => {
    const router = new Router({ initRoutes: [BodyRoutes] });
    expect((await router.eventFunction(event('x'.repeat(1024 * 1024)))).statusCode).toBe(200);
    expect((await router.eventFunction(event('x'.repeat(1024 * 1024 + 1)))).statusCode).toBe(413);
  });
});

describe('maxBodyBytes option', () => {
  it.each([0, -1, 1.5, NaN, Infinity])('rejects %s', (value) => {
    expect(() => new Router({ maxBodyBytes: value })).toThrow(/maxBodyBytes/);
  });

  it('is readable as router.maxBodyBytes', () => {
    expect(new Router().maxBodyBytes).toBe(1024 * 1024);
    expect(new Router({ maxBodyBytes: 42 }).maxBodyBytes).toBe(42);
  });
});

/** Streams `total` bytes in 1 MiB writes, as an uploading client does. */
const streamUpload = (
  port: number,
  total: number,
  headers: Record<string, string> = {}
): Promise<number | string> =>
  new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/items', method: 'POST', headers, agent: false },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      }
    );
    req.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
    const chunk = Buffer.alloc(1024 * 1024, 'a');
    for (let sent = 0; sent < total; sent += chunk.length) req.write(chunk);
    req.end();
  });

/**
 * Raw socket client: writes `head`, then `body` while honouring backpressure,
 * and reports what came back and how the connection ended.
 */
const rawRequest = (
  port: number,
  head: string,
  body: Buffer | null,
  holdMs = 3000,
  allowHalfOpen = false
): Promise<{ data: string; error?: string; closedByServer: boolean; elapsedMs: number }> =>
  new Promise((resolve) => {
    const started = Date.now();
    // allowHalfOpen: keep our side open after the server's FIN, as a client
    // that is not reading (or is still sending) does.
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen });
    let data = '';
    let error: string | undefined;
    let finished = false;
    const finish = (closedByServer: boolean) => {
      if (finished) return;
      finished = true;
      resolve({ data, error, closedByServer, elapsedMs: Date.now() - started });
      socket.destroy();
    };
    socket.on('data', (d) => (data += d.toString('latin1')));
    socket.on('error', (e: NodeJS.ErrnoException) => (error = e.code));
    socket.on('close', () => finish(true));
    socket.on('connect', async () => {
      socket.write(head);
      if (body) {
        for (let i = 0; i < body.length && !socket.destroyed; i += 64 * 1024) {
          if (!socket.write(body.subarray(i, i + 64 * 1024))) {
            await new Promise((r) => {
              socket.once('drain', r);
              socket.once('close', r);
            });
          }
        }
      }
      setTimeout(() => finish(false), holdMs).unref();
    });
  });

describe('Router 413 delivery under a still-uploading client', () => {
  /**
   * Destroying the socket as soon as the 413 was written made the kernel
   * answer the unread upload with a TCP reset, and a client still sending
   * (Node's http.request, fetch, curl) reported ECONNRESET instead of the
   * 413 about one time in five.
   */
  it('delivers the 413 to streamed 8 MB uploads every time (20 runs)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));

    const results: Array<number | string> = [];
    for (let i = 0; i < 20; i++) results.push(await streamUpload(port, 8 * 1024 * 1024));

    expect(results).toEqual(Array(20).fill(413));
    expect(handler).not.toHaveBeenCalled();
  }, 60_000);

  it('delivers the 413 when Content-Length already announces the oversized body', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));
    const total = 8 * 1024 * 1024;

    const results: Array<number | string> = [];
    for (let i = 0; i < 10; i++) {
      results.push(await streamUpload(port, total, { 'content-length': String(total) }));
    }

    expect(results).toEqual(Array(10).fill(413));
  }, 60_000);

  it('answers a raw chunked upload with 413 and then closes the connection', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));
    const payload = Buffer.alloc(2 * 1024 * 1024, 'a');
    const framed = Buffer.concat([
      Buffer.from(`${payload.length.toString(16)}\r\n`),
      payload,
      Buffer.from('\r\n0\r\n\r\n'),
    ]);

    const res = await rawRequest(
      port,
      'POST /items HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n',
      framed
    );

    expect(res.data.startsWith('HTTP/1.1 413')).toBe(true);
    expect(res.data).toMatch(/connection: close/i);
    expect(res.closedByServer).toBe(true);
  });

  it('cuts a refused connection after the linger time when the client keeps it open', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 }));
    const server = servers[servers.length - 1];
    const serverSocketClosed = new Promise<number>((resolve) =>
      server.once('connection', (socket) => socket.once('close', () => resolve(Date.now())))
    );

    // Announces a large body, sends a little, then neither sends nor closes
    // (half-open: it ignores the server's FIN).
    const started = Date.now();
    const res = await rawRequest(
      port,
      'POST /items HTTP/1.1\r\nHost: x\r\nContent-Length: 5000000\r\n\r\nabc',
      null,
      3500,
      true
    );
    const closedAfter = (await serverSocketClosed) - started;

    expect(res.data.startsWith('HTTP/1.1 413')).toBe(true);
    // Held open for the linger time, not cut at once and not left forever.
    expect(closedAfter).toBeGreaterThanOrEqual(1500);
    expect(closedAfter).toBeLessThan(4000);
  }, 10_000);

  it('never serves a request pipelined behind a refused body', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 }));
    const big = 'x'.repeat(500);

    const res = await rawRequest(
      port,
      `POST /items HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n` +
        `${big.length.toString(16)}\r\n${big}\r\n0\r\n\r\n` +
        `POST /items HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi`,
      null,
      1000
    );

    expect(res.data.match(/HTTP\/1\.1 \d+/g)).toEqual(['HTTP/1.1 413']);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops draining a refused upload after a few MiB and cuts the connection', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 100 }));
    const total = 64 * 1024 * 1024;
    const res = await new Promise<{ status?: number; sent: number }>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      let data = '';
      let sent = 0;
      socket.on('data', (d) => (data += d.toString('latin1')));
      socket.on('error', () => {});
      socket.on('close', () => resolve({ status: Number(data.slice(9, 12)) || undefined, sent }));
      socket.on('connect', async () => {
        socket.write(`POST /items HTTP/1.1\r\nHost: x\r\nContent-Length: ${total}\r\n\r\n`);
        const chunk = Buffer.alloc(256 * 1024, 'a');
        while (sent < total && !socket.destroyed) {
          sent += chunk.length;
          if (!socket.write(chunk)) {
            await new Promise((r) => {
              socket.once('drain', r);
              socket.once('close', r);
            });
          }
        }
      });
    });

    expect(res.status).toBe(413);
    // Cut long before the announced 64 MiB arrived.
    expect(res.sent).toBeLessThan(total);
  }, 15_000);
});

describe('Router client abort mid-upload', () => {
  it('logs an aborted upload at debug, not as a route error, and keeps serving', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));

    const socket = net.connect(port, '127.0.0.1');
    await new Promise((r) => socket.on('connect', r));
    socket.write('POST /items HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nabc');
    await new Promise((r) => setTimeout(r, 100));
    socket.resetAndDestroy();
    await vi.waitFor(() =>
      expect(debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'ROUTER_CLIENT_ABORTED', source: 'Router.nodeJSRequest' })
      )
    );

    expect(error).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    const ok = await post(port, [Buffer.from('hi')], { 'content-type': 'text/plain' });
    expect(ok.status).toBe(200);
  });

  it('treats a plain close before the body ended as an abort too', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const port = await listen(new Router({ initRoutes: [BodyRoutes] }));

    const socket = net.connect(port, '127.0.0.1');
    await new Promise((r) => socket.on('connect', r));
    socket.write('POST /items HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nabc');
    await new Promise((r) => setTimeout(r, 100));
    socket.end();
    await vi.waitFor(() =>
      expect(debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'ROUTER_CLIENT_ABORTED' })
      )
    );
    expect(error).not.toHaveBeenCalled();
  });
});

describe('Router Event Function body limit details', () => {
  const event = (body: string, isBase64Encoded = false) => ({
    requestContext: { http: { method: 'POST', path: '/items' } },
    headers: { 'content-type': 'text/plain' },
    body,
    isBase64Encoded,
  });

  it('logs the 413 as the Node transport does', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 10 });

    expect((await router.eventFunction(event('x'.repeat(11)))).statusCode).toBe(413);
    expect(warn).toHaveBeenCalledWith('Refused request body over the size limit', {
      code: 'ROUTER_PAYLOAD_TOO_LARGE',
      source: 'Router.eventFunction',
      method: 'POST',
      maxBodyBytes: 10,
    });
  });

  it('ignores line breaks in a MIME-wrapped base64 body (exactly at the limit)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const router = new Router({ initRoutes: [BodyRoutes], maxBodyBytes: 1000 });
    const at = Buffer.alloc(1000, 1)
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
    const over = Buffer.alloc(1001, 1)
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');

    expect(at.length).toBeGreaterThan(1336); // the CRLFs push the raw length up
    expect((await router.eventFunction(event(at, true))).statusCode).toBe(200);
    expect((await router.eventFunction(event(over, true))).statusCode).toBe(413);
  });
});
