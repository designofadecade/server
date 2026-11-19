import { describe, it, expect } from 'vitest';
import Router from './Router.ts';
import Routes from './Routes.ts';
import type { RouterRequest } from './Router.ts';

/**
 * `clientIp` and `requestId` in each deployment mode. The point of every case
 * is the same: the value comes from something the caller cannot forge in that
 * mode.
 */

class Echo extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/echo', 'GET', async (request: RouterRequest) => ({
      body: { clientIp: request.clientIp, requestId: request.requestId },
    }));
  }
}

const event = (requestContext: Record<string, unknown> = {}, headers = {}) => ({
  requestContext: {
    http: { method: 'GET', path: '/echo', ...requestContext.http! },
    ...requestContext,
  },
  headers,
});

const nodeRequest = async (
  router: Router,
  headers: Record<string, string | string[]>,
  remoteAddress?: string
) => {
  const req: any = {
    url: '/echo',
    method: 'GET',
    headers: { host: 'localhost', ...headers },
    socket: remoteAddress ? { remoteAddress } : undefined,
    on: () => {},
  };
  let body = '';
  const res: any = { statusCode: 0, setHeader: () => {}, end: (chunk: string) => (body = chunk) };
  await router.nodeJSRequest(req, res);
  return JSON.parse(body);
};

describe('Router request identity', () => {
  describe('Event Function', () => {
    it('uses API Gateway sourceIp and requestId, not X-Forwarded-For', async () => {
      const router = new Router({ initRoutes: [Echo], webFunction: false });
      const res = await router.eventFunction(
        event(
          {
            http: { method: 'GET', path: '/echo', sourceIp: '198.51.100.7' },
            requestId: 'apigw-1',
          },
          { 'x-forwarded-for': '6.6.6.6' }
        ) as any
      );
      expect(JSON.parse(res.body)).toEqual({ clientIp: '198.51.100.7', requestId: 'apigw-1' });
    });

    it('falls back to an empty clientIp and a generated requestId', async () => {
      const router = new Router({ initRoutes: [Echo] });
      const res = await router.eventFunction(event() as any);
      const body = JSON.parse(res.body);
      expect(body.clientIp).toBe('');
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('plain Node server', () => {
    const router = new Router({ initRoutes: [Echo], webFunction: false });

    it('uses the socket address and ignores X-Forwarded-For', async () => {
      const body = await nodeRequest(router, { 'x-forwarded-for': '6.6.6.6' }, '192.0.2.1');
      expect(body.clientIp).toBe('192.0.2.1');
    });

    it('ignores a client-sent lambda-web-request-id', async () => {
      const body = await nodeRequest(router, { 'lambda-web-request-id': 'forged' }, '192.0.2.1');
      expect(body.requestId).not.toBe('forged');
    });

    it('gives each request its own id', async () => {
      const a = await nodeRequest(router, {}, '192.0.2.1');
      const b = await nodeRequest(router, {}, '192.0.2.1');
      expect(a.requestId).not.toBe(b.requestId);
    });

    it('returns an empty clientIp when the socket has no address', async () => {
      expect((await nodeRequest(router, {})).clientIp).toBe('');
    });
  });

  describe('Web Function', () => {
    const router = new Router({ initRoutes: [Echo], webFunction: true });

    it('uses the last X-Forwarded-For entry', async () => {
      const body = await nodeRequest(router, { 'x-forwarded-for': '6.6.6.6,  203.0.113.5 ' });
      expect(body.clientIp).toBe('203.0.113.5');
    });

    it('treats repeated X-Forwarded-For headers as one list', async () => {
      const body = await nodeRequest(router, { 'x-forwarded-for': ['6.6.6.6', '203.0.113.5'] });
      expect(body.clientIp).toBe('203.0.113.5');
    });

    it('returns an empty clientIp rather than the socket when the header is missing', async () => {
      expect((await nodeRequest(router, {}, '10.0.0.1')).clientIp).toBe('');
    });

    it('returns an empty clientIp when trustedProxies exceeds the hops present', async () => {
      const behindCdn = new Router({ initRoutes: [Echo], webFunction: true, trustedProxies: 2 });
      expect((await nodeRequest(behindCdn, { 'x-forwarded-for': '1.1.1.1' })).clientIp).toBe('');
    });

    it('uses lambda-web-request-id', async () => {
      const body = await nodeRequest(router, { 'lambda-web-request-id': 'a1b2-c3' });
      expect(body.requestId).toBe('a1b2-c3');
    });

    it.each(['', 'x'.repeat(129), 'has space', 'semi;colon'])(
      'replaces an implausible request id %j with a UUID',
      async (id) => {
        const body = await nodeRequest(router, { 'lambda-web-request-id': id });
        expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      }
    );

    it('detects Web Function mode from AWS_LAMBDA_HTTP_ENDPOINT by default', async () => {
      process.env.AWS_LAMBDA_HTTP_ENDPOINT = '127.0.0.1:9000';
      try {
        const auto = new Router({ initRoutes: [Echo] });
        expect(
          (await nodeRequest(auto, { 'x-forwarded-for': '6.6.6.6, 203.0.113.5' })).clientIp
        ).toBe('203.0.113.5');
      } finally {
        delete process.env.AWS_LAMBDA_HTTP_ENDPOINT;
      }
    });
  });

  it.each([-1, 1.5, NaN])('rejects trustedProxies %s', (value) => {
    expect(() => new Router({ trustedProxies: value })).toThrow(/trustedProxies/);
  });
});
