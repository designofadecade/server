import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
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
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
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
});
