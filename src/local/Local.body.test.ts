import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Local from './Local.ts';
import Router from '../router/Router.ts';
import Routes from '../router/Routes.ts';
import { logger } from '../logger/Logger.ts';
import type { EventFunctionProxyEvent, EventFunctionProxyOptions } from './Local.ts';

/**
 * API Gateway hands a Lambda the request body as the client sent it: raw text,
 * or base64 with `isBase64Encoded` for binary. The proxy used to pass the
 * router's parsed body through `JSON.stringify`, so a text body arrived as a
 * quoted JSON string (`"say \"hi\""`), JSON was re-serialised, and a body
 * full of quotes nearly doubled in size and tripped the 1 MiB limit.
 */

const servers: http.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(() => r(null)));
    })
  );
});

const serve = async (
  handler: Parameters<typeof Local.EventFunctionProxy>[0],
  options: EventFunctionProxyOptions = {}
) => {
  const proxy = Local.EventFunctionProxy(handler, options);
  const server = http.createServer((req, res) => void proxy.request(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return (body: Buffer | string, contentType: string) =>
    fetch(`http://localhost:${port}/items`, {
      method: 'POST',
      // A loopback page: form-type bodies without an Origin are refused
      // as possible cross-site form posts.
      headers: { 'content-type': contentType, origin: `http://localhost:${port}` },
      body,
    });
};

const capture = () => {
  const events: EventFunctionProxyEvent[] = [];
  const handler = vi.fn(async (event: EventFunctionProxyEvent) => {
    events.push(event);
    return { statusCode: 200, body: '{}' };
  });
  return { events, handler };
};

describe('Local.EventFunctionProxy request body', () => {
  it('passes a text/plain body with quotes through unchanged', async () => {
    const { events, handler } = capture();
    const post = await serve(handler);
    const text = 'say "hi" \\ and a "quoted" é';

    expect((await post(text, 'text/plain')).status).toBe(200);

    expect(events[0].body).toBe(text);
    expect(events[0].isBase64Encoded).toBe(false);
  });

  it('passes a JSON body byte for byte, for the wrapped handler to parse', async () => {
    const { events, handler } = capture();
    const post = await serve(handler);
    const json = JSON.stringify({ name: 'é', count: 1.0, nested: { a: [1, 2] } }, null, 2);

    await post(json, 'application/json');

    expect(events[0].body).toBe(json);
    expect(events[0].isBase64Encoded).toBe(false);
  });

  it('still delivers a parsed JSON body through a wrapped Router.eventFunction', async () => {
    let received: unknown;
    class ItemRoutes extends Routes {
      constructor(router: Router) {
        super(router);
        this.addRoute('/items', 'POST', async (request) => {
          received = request.body;
          return { body: { ok: true } };
        });
      }
    }
    const inner = new Router({ initRoutes: [ItemRoutes] });
    const post = await serve((event) => inner.eventFunction(event as never) as never);

    const res = await post('{"a":1,"b":"x"}', 'application/json');

    expect(res.status).toBe(200);
    expect(received).toEqual({ a: 1, b: 'x' });
  });

  it('sends a body that is not valid UTF-8 as base64 with isBase64Encoded', async () => {
    const { events, handler } = capture();
    const post = await serve(handler);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x22, 0x80]);

    await post(bytes, 'application/octet-stream');

    expect(events[0].isBase64Encoded).toBe(true);
    expect(Buffer.from(events[0].body!, 'base64').equals(bytes)).toBe(true);
  });

  it('measures the limit on the bytes sent, not on a re-encoded copy', async () => {
    const { events, handler } = capture();
    const post = await serve(handler);
    // 700 000 bytes: under 1 MiB raw, ~1.4 MB once JSON-quoted.
    const quotes = '"'.repeat(700_000);

    expect((await post(quotes, 'application/octet-stream')).status).toBe(200);
    expect(events[0].body).toHaveLength(700_000);
  });
});

describe('Local.EventFunctionProxy maxBodyBytes', () => {
  it('defaults to 1 MiB, like the router', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { handler } = capture();
    const post = await serve(handler);

    expect((await post(Buffer.alloc(1024 * 1024, 'a'), 'text/plain')).status).toBe(200);
    expect((await post(Buffer.alloc(1024 * 1024 + 1, 'a'), 'text/plain')).status).toBe(413);
  });

  it('can be raised to match the wrapped router', async () => {
    const { events, handler } = capture();
    const post = await serve(handler, { maxBodyBytes: 5 * 1024 * 1024 });

    expect((await post(Buffer.alloc(2 * 1024 * 1024, 'a'), 'text/plain')).status).toBe(200);
    expect(events[0].body).toHaveLength(2 * 1024 * 1024);
  });

  it('can be lowered, refusing before the handler runs', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { handler } = capture();
    const post = await serve(handler, { maxBodyBytes: 10 });

    const res = await post('x'.repeat(11), 'text/plain');

    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'PAYLOAD_TOO_LARGE'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN])('rejects %s', (value) => {
    expect(() => Local.EventFunctionProxy(async () => '', { maxBodyBytes: value })).toThrow(
      /maxBodyBytes/
    );
  });
});
