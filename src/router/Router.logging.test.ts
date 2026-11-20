import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Router from './Router.ts';
import type { RouterOptions } from './Router.ts';
import Routes from './Routes.ts';
import { logger } from '../logger/Logger.ts';

/**
 * SECURITY: a request path can carry secrets (`/reset/<token>`) and personal
 * data, and its query string more so. The router's own error lines (handler
 * errors, 404s, request failures) used to log the raw path, and on the Node
 * path the raw URL with its query string. They now log the matched route
 * pattern, and the raw path only with `logPath: true` (query removed, capped).
 */

const SECRET = 'SECRETTOKEN123';
const SECRET_QUERY = 'SECRETQ456';

class TestRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/reset/:token', ['POST'], async () => {
      throw new Error('boom');
    });
    // A body JSON.stringify cannot serialise fails after routing, in the
    // transport layer rather than in the handler.
    this.addRoute('/bigint/:token', ['GET'], async () => ({ status: 200, body: { n: 1n } }));
  }
}

const build = (options: RouterOptions = {}) => new Router({ initRoutes: [TestRoutes], ...options });

const spyLogger = () =>
  (['error', 'warn', 'info', 'debug'] as const).map((level) =>
    vi.spyOn(logger, level).mockImplementation(() => {})
  );

const allLogged = (spies: ReturnType<typeof spyLogger>) =>
  spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      JSON.stringify(args, (_key, value) =>
        value instanceof Error ? { message: value.message, stack: value.stack } : value
      )
    )
    .join('\n');

const contextOf = (spies: ReturnType<typeof spyLogger>) =>
  spies[0]!.mock.calls.map((args) => args[1] as Record<string, unknown>);

async function nodeRequest(router: Router, method: string, path: string, body?: string) {
  const server = http.createServer((req, res) => router.nodeJSRequest(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const event = (method: string, path: string) => ({
  requestContext: { http: { method, path } },
  headers: {},
  queryStringParameters: { x: SECRET_QUERY },
  rawQueryString: `x=${SECRET_QUERY}`,
  body: method === 'POST' ? '{}' : undefined,
});

describe('Router error logs do not carry the raw path', () => {
  let spies: ReturnType<typeof spyLogger>;
  afterEach(() => spies?.forEach((spy) => spy.mockRestore()));

  it('handler error (Node): logs the route pattern, not the token or query', async () => {
    spies = spyLogger();
    const res = await nodeRequest(build(), 'POST', `/reset/${SECRET}?x=${SECRET_QUERY}`, '{}');
    expect(res.status).toBe(500);
    const logged = allLogged(spies);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SECRET_QUERY);
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_HANDLER_ERROR', route: '/reset/:token' })
    );
  });

  it('404 (Node): logs no path, and the client message names none', async () => {
    spies = spyLogger();
    const res = await nodeRequest(build(), 'GET', `/nope/${SECRET}?x=${SECRET_QUERY}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(SECRET);
    expect(JSON.parse(res.body).error.message).toBe('Route not found');
    const logged = allLogged(spies);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SECRET_QUERY);
    expect(contextOf(spies)[0]).not.toHaveProperty('path');
  });

  it('request failure outside the handler (Node): no path, route kept', async () => {
    spies = spyLogger();
    const res = await nodeRequest(build(), 'GET', `/bigint/${SECRET}?x=${SECRET_QUERY}`);
    expect(res.status).toBe(500);
    const logged = allLogged(spies);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SECRET_QUERY);
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({ source: 'Router.nodeJSRequest', route: '/bigint/:token' })
    );
  });

  it('request failure before routing (Node, invalid JSON): no path', async () => {
    spies = spyLogger();
    const res = await nodeRequest(build(), 'POST', `/reset/${SECRET}?x=${SECRET_QUERY}`, '{');
    expect(res.status).toBe(500);
    const logged = allLogged(spies);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SECRET_QUERY);
  });

  it('handler error (eventFunction): logs the route pattern only', async () => {
    spies = spyLogger();
    const res = await build().eventFunction(event('POST', `/reset/${SECRET}`));
    expect(res.statusCode).toBe(500);
    expect(allLogged(spies)).not.toContain(SECRET);
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({ code: 'ROUTER_HANDLER_ERROR', route: '/reset/:token' })
    );
  });

  it('404 (eventFunction): logs no path', async () => {
    spies = spyLogger();
    const res = await build().eventFunction(event('GET', `/nope/${SECRET}`));
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET);
    expect(allLogged(spies)).not.toContain(SECRET);
  });

  it('request failure outside the handler (eventFunction): no path, route kept', async () => {
    spies = spyLogger();
    const res = await build().eventFunction(event('GET', `/bigint/${SECRET}`));
    expect(res.statusCode).toBe(500);
    expect(allLogged(spies)).not.toContain(SECRET);
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({ source: 'Router.eventFunction', route: '/bigint/:token' })
    );
  });
});

describe('Router logPath: true', () => {
  let spies: ReturnType<typeof spyLogger>;
  afterEach(() => spies?.forEach((spy) => spy.mockRestore()));

  it('logs the path without its query string (Node)', async () => {
    spies = spyLogger();
    await nodeRequest(build({ logPath: true }), 'POST', `/reset/${SECRET}?x=${SECRET_QUERY}`, '{}');
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({
        code: 'ROUTER_HANDLER_ERROR',
        route: '/reset/:token',
        path: `/reset/${SECRET}`,
      })
    );
    expect(allLogged(spies)).not.toContain(SECRET_QUERY);
  });

  it('logs the path on a 404 and caps it at 256 characters', async () => {
    spies = spyLogger();
    const long = `/nope/${'a'.repeat(1000)}`;
    await build({ logPath: true }).eventFunction(event('GET', long));
    const context = contextOf(spies)[0]!;
    expect(context.path).toBe(`${long.slice(0, 256)}…[truncated, ${long.length} chars]`);
  });

  it('logs the path on a transport failure (Node), without the query', async () => {
    spies = spyLogger();
    await nodeRequest(build({ logPath: true }), 'GET', `/bigint/${SECRET}?x=${SECRET_QUERY}`);
    expect(contextOf(spies)).toContainEqual(
      expect.objectContaining({ source: 'Router.nodeJSRequest', path: `/bigint/${SECRET}` })
    );
    expect(allLogged(spies)).not.toContain(SECRET_QUERY);
  });
});
