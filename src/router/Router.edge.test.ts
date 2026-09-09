import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import Router from './Router.ts';
import Routes from './Routes.ts';

/**
 * Edge-case coverage for branches the happy-path tests never reach: malformed
 * JWTs, Lambda cookie parsing, route-table construction and the match cache.
 */

const SECRET = 'edge-case-secret';
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const sign = (claims: Record<string, unknown>, alg = 'HS256', hash = 'sha256'): string => {
  const head = b64({ alg, typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac(hash, SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

class Echo extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/echo', 'GET', async (request) => ({
      status: 200,
      body: { authorizer: request.authorizer ?? null, cookies: request.cookies },
    }));
  }
}

const callWithToken = async (
  token: string,
  jwt: Record<string, unknown> = { secret: SECRET }
): Promise<unknown> => {
  const router = new Router({ initRoutes: [Echo], jwt });
  const req = {
    url: 'http://localhost/echo',
    method: 'GET',
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end') cb();
      return req;
    }),
  };
  const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  await router.nodeJSRequest(req as never, res as never);
  return JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]).authorizer;
};

describe('Router edge cases', () => {
  describe('malformed JWTs', () => {
    it('should reject a token without three segments', async () => {
      await expect(callWithToken('only.two')).resolves.toBeNull();
    });

    it('should reject a token whose header is not valid base64 JSON', async () => {
      await expect(callWithToken('%%%.%%%.%%%')).resolves.toBeNull();
    });

    it('should reject a token whose payload is not valid JSON', async () => {
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const body = Buffer.from('not json at all').toString('base64url');
      const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');

      await expect(callWithToken(`${head}.${body}.${sig}`)).resolves.toBeNull();
    });

    it('should reject a token whose payload is not an object', async () => {
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const body = b64('a bare string');
      const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');

      await expect(callWithToken(`${head}.${body}.${sig}`)).resolves.toBeNull();
    });

    it('should reject a token that is not yet valid (nbf in the future)', async () => {
      const future = Math.floor(Date.now() / 1000) + 3600;

      await expect(callWithToken(sign({ sub: 'x', nbf: future }))).resolves.toBeNull();
    });

    it('should accept a token whose nbf has passed', async () => {
      const past = Math.floor(Date.now() / 1000) - 3600;

      await expect(callWithToken(sign({ sub: 'x', nbf: past }))).resolves.toEqual({
        lambda: { sub: 'x', nbf: past },
      });
    });

    it('should reject when no secret and no verifier are configured', async () => {
      await expect(callWithToken(sign({ sub: 'x' }), {})).resolves.toBeNull();
    });

    it('should reject a verifier that resolves to a non-object', async () => {
      await expect(
        callWithToken('any.token.here', { verify: async () => 'not-an-object' })
      ).resolves.toBeNull();
    });

    it('should ignore an empty bearer value', async () => {
      await expect(callWithToken('')).resolves.toBeNull();
    });

    it('should support HS512 when allowlisted', async () => {
      await expect(
        callWithToken(sign({ sub: 'x' }, 'HS512', 'sha512'), {
          secret: SECRET,
          algorithms: ['HS512'],
        })
      ).resolves.toEqual({ lambda: { sub: 'x' } });
    });
  });

  describe('route table construction', () => {
    it('should reject a route with a non-string path', () => {
      class Bad extends Routes {
        constructor(router: Router) {
          super(router);
          this.routerRoutes.push({
            path: 123 as never,
            methods: ['GET'],
            handler: async () => ({ status: 200 }),
          });
        }
      }

      expect(() => new Router({ initRoutes: [Bad] })).toThrow('valid path string');
    });

    it('should normalize duplicate slashes and trailing slashes', async () => {
      class Odd extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('//deep//path//', 'GET', async () => ({ status: 200, body: 'ok' }));
        }
      }
      const router = new Router({ initRoutes: [Odd] });

      const response = await router.lambdaEvent({
        requestContext: { http: { method: 'GET', path: '/deep/path' } },
        headers: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('match cache', () => {
    it('should serve a repeated dynamic lookup from cache', async () => {
      class Dyn extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/items/:id', 'GET', async (request) => ({
            status: 200,
            body: request.params,
          }));
        }
      }
      const router = new Router({ initRoutes: [Dyn] });

      const call = () =>
        router.lambdaEvent({
          requestContext: { http: { method: 'GET', path: '/items/42' } },
          headers: {},
        });

      const first = await call();
      const second = await call();

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body as string)).toEqual({ id: '42' });
    });

    it('should cache misses for unknown dynamic paths', async () => {
      class Dyn extends Routes {
        constructor(router: Router) {
          super(router);
          this.addRoute('/items/:id', 'GET', async () => ({ status: 200, body: 'ok' }));
        }
      }
      const router = new Router({ initRoutes: [Dyn] });

      const miss = () =>
        router.lambdaEvent({
          requestContext: { http: { method: 'DELETE', path: '/nope/nope' } },
          headers: {},
        });

      expect((await miss()).statusCode).toBe(404);
      expect((await miss()).statusCode).toBe(404);
    });
  });

  describe('Lambda cookies', () => {
    it('should parse the Lambda cookies array', async () => {
      const router = new Router({ initRoutes: [Echo] });

      const response = await router.lambdaEvent({
        requestContext: { http: { method: 'GET', path: '/echo' } },
        headers: {},
        cookies: ['session=abc123', 'theme=dark', 'signed=a=b=c'],
      });

      expect(JSON.parse(response.body as string).cookies).toEqual({
        session: 'abc123',
        theme: 'dark',
        signed: 'a=b=c',
      });
    });

    it('should return an empty object when there are no cookies', async () => {
      const router = new Router({ initRoutes: [Echo] });

      const response = await router.lambdaEvent({
        requestContext: { http: { method: 'GET', path: '/echo' } },
        headers: {},
        cookies: [],
      });

      expect(JSON.parse(response.body as string).cookies).toEqual({});
    });
  });
});
