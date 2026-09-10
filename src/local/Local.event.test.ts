import { describe, it, expect, beforeEach, vi } from 'vitest';
import Local from './Local.ts';
import Router from '../router/Router.ts';
import Routes from '../router/Routes.ts';

/**
 * `LambdaProxyRouter` exists so a real Lambda handler can be exercised locally.
 * That only holds if the event it synthesises matches the API Gateway HTTP API
 * v2.0 wire format — a handler that reads the event the documented way must see
 * what it would see when deployed.
 */
describe('Local.LambdaProxyRouter event shape', () => {
  let handler;
  let seenEvent;
  let req;
  let res;

  const makeReq = (overrides = {}) => ({
    url: '/test',
    method: 'GET',
    headers: { host: 'localhost:3000' },
    on: vi.fn((event, cb) => {
      if (event === 'end') cb();
    }),
    ...overrides,
  });

  beforeEach(() => {
    seenEvent = undefined;
    handler = vi.fn(async (event) => {
      seenEvent = event;
      return { statusCode: 200, body: '{}' };
    });
    req = makeReq();
    res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  });

  it('sends cookies as an array of "name=value" strings', async () => {
    req = makeReq({ headers: { host: 'localhost:3000', cookie: 'session=abc; theme=dark' } });

    await Local.LambdaProxyRouter(handler).request(req, res);

    expect(seenEvent.cookies).toEqual(['session=abc', 'theme=dark']);
  });

  it('sends an empty cookies array when the request has none', async () => {
    await Local.LambdaProxyRouter(handler).request(req, res);

    expect(seenEvent.cookies).toEqual([]);
  });

  /**
   * The regression that motivated the array format: `Router.lambdaEvent` parses
   * `event.cookies` as an API Gateway array and guards with `Array.isArray`.
   * Handed an object it took the guard and silently dropped every cookie, so a
   * cookie-authenticated route worked when deployed and failed locally.
   */
  it('delivers cookies through a wrapped Router.lambdaEvent handler', async () => {
    let received;
    const router = new Router({
      initRoutes: [
        class extends Routes {
          constructor(r) {
            super(r);
            this.addRoute('/test', ['GET'], async (request) => {
              received = request.cookies;
              return { status: 200, body: {} };
            });
          }
        },
      ],
    });

    req = makeReq({ headers: { host: 'localhost:3000', cookie: 'session=abc; theme=dark' } });

    await Local.LambdaProxyRouter((event) => router.lambdaEvent(event)).request(req, res);

    expect(received).toEqual({ session: 'abc', theme: 'dark' });
  });

  it('joins repeated headers the way API Gateway does', async () => {
    req = makeReq({
      headers: { host: 'localhost:3000', 'x-custom': ['one', 'two'] },
    });

    await Local.LambdaProxyRouter(handler).request(req, res);

    expect(seenEvent.headers['x-custom']).toBe('one, two');
  });

  it('populates the API Gateway v2 envelope fields', async () => {
    req = makeReq({ url: '/test?a=1&b=2' });

    await Local.LambdaProxyRouter(handler).request(req, res);

    expect(seenEvent.version).toBe('2.0');
    expect(seenEvent.routeKey).toBe('GET /test');
    expect(seenEvent.rawPath).toBe('/test');
    expect(seenEvent.rawQueryString).toBe('a=1&b=2');
    expect(seenEvent.isBase64Encoded).toBe(false);
  });

  it('populates the request context fields API Gateway provides', async () => {
    req = makeReq({
      headers: {
        host: 'api.example.com',
        'user-agent': 'vitest',
        'x-forwarded-for': '203.0.113.7, 198.51.100.1',
      },
    });

    await Local.LambdaProxyRouter(handler).request(req, res);

    const ctx = seenEvent.requestContext;
    expect(ctx.http.protocol).toBe('HTTP/1.1');
    expect(ctx.http.sourceIp).toBe('203.0.113.7');
    expect(ctx.http.userAgent).toBe('vitest');
    expect(ctx.domainName).toBe('api.example.com');
    expect(ctx.domainPrefix).toBe('api');
    expect(ctx.stage).toBe('$default');
    expect(typeof ctx.requestId).toBe('string');
    expect(typeof ctx.timeEpoch).toBe('number');
  });

  it('lets the requestContext option override synthesised fields', async () => {
    await Local.LambdaProxyRouter(handler, { requestContext: { stage: 'dev' } }).request(req, res);

    expect(seenEvent.requestContext.stage).toBe('dev');
  });

  /** API Gateway omits `body` entirely rather than sending null. */
  it('omits body when the request has none', async () => {
    await Local.LambdaProxyRouter(handler).request(req, res);

    expect(seenEvent.body).toBeUndefined();
  });
});
