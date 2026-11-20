import { describe, it, expect, vi } from 'vitest';
import Router from './Router.ts';
import Routes from './Routes.ts';

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
    const router = build();
    const started = performance.now();
    await router.eventFunction({
      requestContext: { http: { method: 'GET', path: '/'.repeat(200_000) + 'x' } },
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
