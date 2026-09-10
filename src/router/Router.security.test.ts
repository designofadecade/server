import { describe, it, expect } from 'vitest';
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
    await router.lambdaEvent({
      requestContext: { http: { method: 'GET', path: '/'.repeat(200_000) + 'x' } },
      headers: {},
    });
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });

  it('still routes and still strips trailing slashes', async () => {
    const router = build();
    const hit = await router.lambdaEvent({
      requestContext: { http: { method: 'GET', path: '/ok///' } },
      headers: {},
    });
    expect(hit.statusCode).toBe(200);

    const root = await router.lambdaEvent({
      requestContext: { http: { method: 'GET', path: '/' } },
      headers: {},
    });
    expect(root.statusCode).toBe(404);
  });
});
