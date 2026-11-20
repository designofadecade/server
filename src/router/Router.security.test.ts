import { describe, it, expect, vi, afterEach } from 'vitest';
import Router from './Router.ts';
import Routes from './Routes.ts';
import { logger } from '../logger/Logger.ts';
import { parseRequestTarget } from './requestTarget.ts';
import type { RouterRequest } from './Router.ts';

/**
 * Route paths are attacker-controlled. Trailing slashes were stripped with
 * `replace(/\/+$/, '')`, whose anchored `+` makes the engine retry from every
 * index in a run of slashes, scanning to the end each time — quadratic. A
 * request of many slashes turned into O(n^2) work on the shared event loop.
 */
describe('Router path normalization ReDoS resistance', () => {
  const BUDGET_MS = 2000;

  const build = () =>
    new Router({
      initRoutes: [
        class extends Routes {
          constructor(router: Router) {
            super(router);
            this.addRoute('/ok', ['GET'], async () => ({ status: 200, body: 'ok' }));
          }
        },
      ],
    });

  it('normalizes a long run of slashes in linear time', async () => {
    // Not leading: a path starting with `//` is refused before routing.
    const router = build();
    const started = performance.now();
    await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/a' + '/'.repeat(200_000) + 'x' } },
      headers: {},
    });
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });

  it('still routes and still strips trailing slashes', async () => {
    const router = build();
    const hit = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/ok///' } },
      headers: {},
    });
    expect(hit.statusCode).toBe(200);

    const root = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/' } },
      headers: {},
    });
    expect(root.statusCode).toBe(404);
  });
});

/**
 * The JSON body check is a substring match on Content-Type. A cross-site page
 * can send `text/plain;application/json` without a CORS preflight — its MIME
 * essence is `text/plain`, a CORS-safelisted type — and the browser attaches
 * the victim's cookies. Such a body used to reach the route already parsed, so
 * a forged request could drive any cookie-authenticated JSON route. Bodies
 * whose essence is a CORS-safelisted type now stay raw strings on both the
 * Lambda and the Node path; every other Content-Type is handled as before.
 */
describe('Router JSON body parsing ignores CORS-safelisted content types', () => {
  class Echo extends Routes {
    constructor(router: Router) {
      super(router);
      this.addRoute('/echo', ['POST'], async (request) => ({
        status: 200,
        body: { kind: typeof request.body, value: request.body },
      }));
    }
  }

  const viaLambda = async (
    contentType: string | string[],
    body: string
  ): Promise<{ status: number; echo: { kind: string; value: unknown } }> => {
    const router = new Router({ initRoutes: [Echo] });
    const result = await router.eventFunction({
      requestContext: { http: { method: 'POST', path: '/echo' } },
      headers: { 'content-type': contentType },
      body,
    });
    return { status: result.statusCode, echo: JSON.parse(result.body) };
  };

  const viaNode = async (
    contentType: string,
    body: string
  ): Promise<{ status: number; echo: { kind: string; value: unknown } }> => {
    const router = new Router({ initRoutes: [Echo] });
    const req = {
      url: '/echo',
      method: 'POST',
      headers: { host: 'localhost', 'content-type': contentType },
      on: vi.fn((event: string, cb: (chunk?: string) => void) => {
        if (event === 'data') cb(body);
        if (event === 'end') cb();
        return req;
      }),
    };
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
    await router.nodeJSRequest(req as never, res as never);
    return {
      status: res.statusCode,
      echo: JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]),
    };
  };

  const payload = JSON.stringify({ email: 'attacker@example.test' });

  // Content types a cross-site page can send with no preflight that still
  // contain the substring the JSON check looks for.
  const SMUGGLED = [
    'text/plain;application/json',
    'text/plain; charset=utf-8; application/json',
    'TEXT/PLAIN;application/json',
    'text/plain ;application/json',
    'application/x-www-form-urlencoded;application/json',
    'multipart/form-data; boundary=application/json',
  ];

  for (const contentType of SMUGGLED) {
    it(`leaves a ${JSON.stringify(contentType)} body as a raw string (Lambda)`, async () => {
      const { status, echo } = await viaLambda(contentType, payload);
      expect(status).toBe(200);
      expect(echo).toEqual({ kind: 'string', value: payload });
    });

    it(`leaves a ${JSON.stringify(contentType)} body as a raw string (Node)`, async () => {
      const { status, echo } = await viaNode(contentType, payload);
      expect(status).toBe(200);
      expect(echo).toEqual({ kind: 'string', value: payload });
    });
  }

  it('does not attempt to parse a smuggled type, so invalid JSON is not a 400 (Lambda)', async () => {
    const { status, echo } = await viaLambda('text/plain;application/json', '{not json');
    expect(status).toBe(200);
    expect(echo).toEqual({ kind: 'string', value: '{not json' });
  });

  // Types the base check already parsed; browsers preflight every one of them.
  const GENUINE = ['application/json', 'application/json; charset=utf-8'];

  for (const contentType of GENUINE) {
    it(`still parses a ${JSON.stringify(contentType)} body (Lambda and Node)`, async () => {
      const expected = { kind: 'object', value: { email: 'attacker@example.test' } };
      expect((await viaLambda(contentType, payload)).echo).toEqual(expected);
      expect((await viaNode(contentType, payload)).echo).toEqual(expected);
    });
  }

  it('still parses application/json-patch+json (Lambda and Node)', async () => {
    const patch = JSON.stringify([{ op: 'replace', path: '/a', value: 1 }]);
    const expected = { kind: 'object', value: [{ op: 'replace', path: '/a', value: 1 }] };
    expect((await viaLambda('application/json-patch+json', patch)).echo).toEqual(expected);
    expect((await viaNode('application/json-patch+json', patch)).echo).toEqual(expected);
  });

  it('still answers 400 for invalid JSON declared as application/json (Lambda)', async () => {
    const result = await new Router({ initRoutes: [Echo] }).eventFunction({
      requestContext: { http: { method: 'POST', path: '/echo' } },
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(result.statusCode).toBe(400);
  });

  it('still leaves Application/JSON as a string, as the case-sensitive check always has', async () => {
    const expected = { kind: 'string', value: payload };
    expect((await viaLambda('Application/JSON', payload)).echo).toEqual(expected);
    expect((await viaNode('Application/JSON', payload)).echo).toEqual(expected);

    const invalid = await viaLambda('Application/JSON', '{not json');
    expect(invalid.status).toBe(200);
    expect(invalid.echo).toEqual({ kind: 'string', value: '{not json' });
  });

  it('keeps the exact-element handling of an array header from a hand-built Lambda event', async () => {
    expect((await viaLambda(['text/plain', 'application/json'], payload)).echo.kind).toBe('object');
    expect((await viaLambda(['application/json; charset=utf-8'], payload)).echo.kind).toBe(
      'string'
    );
  });
});

/**
 * The request path is taken verbatim. URL resolution used to turn `//x/admin`
 * into `/admin` and drop dot segments, so the router dispatched on a path a
 * proxy in front never judged. Such targets are refused on both transports,
 * before CORS, the body or any middleware, and the refusal is logged without
 * the target itself.
 */
describe('Router refuses request targets that resolution would rewrite', () => {
  const handler = vi.fn(async () => ({ status: 200, body: 'admin' }));
  const middleware = vi.fn(async () => null);

  const build = () =>
    new Router({
      middleware: [middleware],
      initRoutes: [
        class extends Routes {
          constructor(router: Router) {
            super(router);
            this.addRoute('/admin', ['GET', 'POST', 'OPTIONS'], handler);
            this.addRoute('/tags/:tag', 'GET', async (request) => ({
              status: 200,
              body: { tag: request.params.tag },
            }));
          }
        },
      ],
    });

  const nodeRequest = async (router: Router, url: string, method = 'GET') => {
    const req = {
      url,
      method,
      headers: { host: 'localhost', origin: 'https://evil.example' },
      socket: {},
      on: vi.fn(),
    };
    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await router.nodeJSRequest(req as never, res as never, { cors: ['https://app.example'] });
    return res;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    handler.mockClear();
    middleware.mockClear();
  });

  it('answers 400 on the Node transport and logs a fixed reason, never the target', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const router = build();

    const res = await nodeRequest(router, '//secret-token/admin', 'POST');

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request URL' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(middleware).not.toHaveBeenCalled();
    // Refused before CORS: no CORS log and no CORS headers.
    expect(res.setHeader).not.toHaveBeenCalledWith('Vary', 'Origin');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      code: 'ROUTER_INVALID_REQUEST_URL',
      source: 'Router.nodeJSRequest',
      reason: 'leading-double-slash',
      method: 'POST',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
  });

  it('caps the logged method', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await nodeRequest(build(), '/a/../admin', 'X'.repeat(100));
    expect(warn.mock.calls[0]![1]).toMatchObject({ reason: 'dot-segment', method: 'X'.repeat(16) });
  });

  it.each([
    '//x/admin',
    '/\\x/admin',
    '/pub/../admin',
    '/pub/%2e%2E/admin',
    '/./admin',
    '/admin/.',
  ])('answers 400 to an Event Function path of %j', async (path) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = await build().eventFunction({
      requestContext: { http: { method: 'GET', path } },
      headers: {},
    });
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request URL' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(middleware).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![1]).toMatchObject({
      code: 'ROUTER_INVALID_REQUEST_URL',
      source: 'Router.eventFunction',
    });
  });

  it('still serves ordinary Event Function paths, a decoded # and space included', async () => {
    const router = build();
    const admin = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/admin/' } },
      headers: {},
    });
    expect(admin.statusCode).toBe(200);

    const spaced = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/tags/a b' } },
      headers: {},
    });
    expect(spaced.statusCode).toBe(200);

    // Not refused as a fragment (routing it is URLPattern's business, as before).
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const hash = await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/tags/#a' } },
      headers: {},
    });
    expect(hash.statusCode).not.toBe(400);
  });
});

describe('Router matches dynamic routes on the path, never a URL parsed from it', () => {
  const handler = vi.fn(async (request: RouterRequest) => ({
    status: 200,
    body: { params: request.params },
  }));

  const build = () =>
    new Router({
      initRoutes: [
        class extends Routes {
          constructor(router: Router) {
            super(router);
            this.addRoute('/admin/:id', 'GET', handler);
            this.addRoute('/files/:dir/:name', 'GET', handler);
            this.addRoute('/assets/*', 'GET', handler);
          }
        },
      ],
    });

  const viaEvent = (router: Router, path: string) =>
    router.eventFunction({ requestContext: { http: { method: 'GET', path } }, headers: {} });

  const viaNode = async (router: Router, url: string) => {
    const req = { url, method: 'GET', headers: { host: 'localhost' }, socket: {}, on: vi.fn() };
    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await router.nodeJSRequest(req as never, res as never);
    return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0]![0] as string) };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    handler.mockClear();
  });

  // A string handed to URLPattern is parsed as a URL: cut at `?`/`#`, so these
  // matched `/admin/:id` with id `1`.
  it.each(['/admin/1#x/y', '/admin/1?/x/y'])(
    'an Event Function path %j does not reach /admin/:id (404)',
    async (path) => {
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const result = await viaEvent(build(), path);
      expect(result.statusCode).toBe(404);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['/admin/1#', '1%23'],
    ['/admin/1?x', '1%3Fx'],
  ])('an Event Function path %j keeps the ?/# in the parameter: %j', async (path, id) => {
    // Percent-encoded, exactly as the Node transport gives `/admin/1%3Fx`.
    const result = await viaEvent(build(), path);
    expect(result.statusCode).toBe(200);
    expect(handler.mock.calls[0]![0].params).toEqual({ id });
  });

  it('keeps a trailing space in the parameter instead of trimming it to id 1', async () => {
    const result = await viaEvent(build(), '/admin/1 ');
    expect(result.statusCode).toBe(200);
    expect(handler.mock.calls[0]![0].params).toEqual({ id: '1%20' });
    // The same parameter the Node transport gives for the encoded target.
    const node = await viaNode(build(), '/admin/1%20');
    expect(node.body.params).toEqual({ id: '1%20' });
  });

  it.each([
    ['/admin/42', '/admin/42', { id: '42' }],
    ['/admin/42/', '/admin/42/', { id: '42' }],
    ['/admin/a%20b', '/admin/a b', { id: 'a%20b' }],
    ['/admin/caf%C3%A9', '/admin/café', { id: 'caf%C3%A9' }],
    ['/admin/a%3Fb', '/admin/a?b', { id: 'a%3Fb' }],
    ['/admin/a%23b', '/admin/a#b', { id: 'a%23b' }],
    ['/admin/a%2Fb', '/admin/a%2Fb', { id: 'a%2Fb' }],
    ['/admin/x?q=1', '/admin/x', { id: 'x' }],
    ['/files/docs/report.pdf', '/files/docs/report.pdf', { dir: 'docs', name: 'report.pdf' }],
    ['/assets/a/b/c.js', '/assets/a/b/c.js', { '0': 'a/b/c.js' }],
    // A trailing slash: the route is found without it, and so are its params
    // (they were empty); a `*` group keeps the slash, as before.
    ['/files/docs/x//', '/files/docs/x//', { dir: 'docs', name: 'x' }],
    ['/assets/a/b/', '/assets/a/b/', { '0': 'a/b/' }],
  ])('Node %j and Event Function %j give params %j', async (target, path, params) => {
    const node = await viaNode(build(), target);
    expect(node.status).toBe(200);
    expect(node.body.params).toEqual(params);

    const event = await viaEvent(build(), path);
    expect(event.statusCode).toBe(200);
    expect(JSON.parse(event.body as string).params).toEqual(params);
  });

  it('matches every accepted Node target exactly as the string form did', () => {
    // Old behaviour: `pattern.exec(path)`. For a Node path (already split at
    // `?`, `#` refused, the URL-encoded characters encoded) the init form
    // must give the same match and groups.
    const patterns = [
      '/a/:id',
      '/a/:id/b',
      '/a/*',
      '/:x/:y',
      '/a/:id?',
      '/a/:id(\\d+)',
      '/a{/:opt}?/c',
      '/*',
    ].map((pathname) => new URLPattern({ pathname }));
    const alphabet = [
      'a',
      '1',
      '/',
      '/',
      '-',
      '~',
      '%',
      '%20',
      '%2F',
      '%3F',
      '%23',
      '%25',
      'é',
      ' ',
      '"',
      '<',
      '>',
      '^',
      '`',
      '{',
      '}',
      '|',
      '!',
      '$',
      '&',
      "'",
      '(',
      '*',
      '+',
      ';',
      '=',
      ':',
      '@',
      '[',
      ']',
      '.',
      '%2e',
      '?',
    ];
    let seed = 1;
    const next = () => (seed = (seed * 48271) % 2147483647) % alphabet.length;
    let compared = 0;
    for (let i = 0; i < 20000; i++) {
      let target = '/';
      for (let j = 0, n = 1 + (next() % 8); j < n; j++) target += alphabet[next()];
      const parsed = parseRequestTarget(target);
      if ('refused' in parsed) continue;
      for (const pattern of patterns) {
        const old = pattern.exec(parsed.path);
        const now = pattern.exec({ pathname: parsed.path });
        expect([now !== null, now?.pathname.groups]).toEqual([old !== null, old?.pathname.groups]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50000);
  });
});
