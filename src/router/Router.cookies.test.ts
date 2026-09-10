import { describe, it, expect } from 'vitest';
import Router from './Router.js';
import Routes from './Routes.js';

/**
 * A route may need to set more than one cookie, and a header map cannot hold
 * two values under one name. `RouterResponse.headers` therefore accepts an
 * array, and each transport renders it the way that transport expects: Node
 * emits repeated `set-cookie` headers, API Gateway HTTP API (payload format
 * 2.0) carries them in the top-level `cookies` field.
 *
 * The two must agree — a cookie that works deployed but not locally (or the
 * reverse) is the divergence this module exists to prevent.
 */
const cookieRoutes = (cookies: string[] | string) =>
  class CookieRoutes extends Routes {
    constructor(router: Router) {
      super(router);
      this.addRoute('/login', ['GET'], async () => ({
        status: 200,
        headers: { 'Content-Type': 'application/json', 'set-cookie': cookies },
        body: { ok: true },
      }));
    }
  };

const lambdaEvent = {
  requestContext: { http: { method: 'GET', path: '/login' } },
  headers: {},
};

describe('multi-value response headers', () => {
  it('carries multiple cookies in the format 2.0 cookies field', async () => {
    const router = new Router({ initRoutes: [cookieRoutes(['a=1', 'b=2'])] });
    const response = await router.lambdaEvent(lambdaEvent);

    expect(response.cookies).toEqual(['a=1', 'b=2']);
    // A header map cannot carry both, so set-cookie must not also appear there.
    expect(Object.keys(response.headers ?? {})).not.toContain('set-cookie');
    expect(response.statusCode).toBe(200);
  });

  it('carries a single cookie the same way', async () => {
    const router = new Router({ initRoutes: [cookieRoutes('a=1')] });
    const response = await router.lambdaEvent(lambdaEvent);

    expect(response.cookies).toEqual(['a=1']);
  });

  it('omits the cookies field entirely when a route sets none', async () => {
    const router = new Router({
      initRoutes: [
        class extends Routes {
          constructor(r: Router) {
            super(r);
            this.addRoute('/login', ['GET'], async () => ({ status: 204, body: null }));
          }
        },
      ],
    });
    const response = await router.lambdaEvent(lambdaEvent);

    expect(response).not.toHaveProperty('cookies');
  });

  it('comma-joins a non-cookie multi-value header, as HTTP does', async () => {
    const router = new Router({
      initRoutes: [
        class extends Routes {
          constructor(r: Router) {
            super(r);
            this.addRoute('/login', ['GET'], async () => ({
              status: 200,
              headers: { vary: ['Origin', 'Accept-Encoding'] },
              body: null,
            }));
          }
        },
      ],
    });
    const response = await router.lambdaEvent(lambdaEvent);

    expect(response.headers?.vary).toBe('Origin, Accept-Encoding');
  });
});
