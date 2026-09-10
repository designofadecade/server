import { describe, it, expect, vi } from 'vitest';
import Router from './Router.js';
import Routes from './Routes.js';
import type { RouterResponse } from './Router.js';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * The response a route produces has to reach the client unchanged, and has to
 * reach it the same way locally as it does deployed. These pin the places where
 * the two transports previously disagreed with each other or with API Gateway.
 */
const routerReturning = (response: RouterResponse) =>
  new Router({
    initRoutes: [
      class extends Routes {
        constructor(r: Router) {
          super(r);
          this.addRoute('/t', ['GET'], async () => response);
        }
      },
    ],
  });

const nodeRequest = async (router: Router) => {
  const req = {
    url: 'http://localhost:3000/t',
    method: 'GET',
    headers: {} as Record<string, string>,
    on: vi.fn(),
  };
  req.on.mockImplementation(((event: string, cb: () => void) => {
    if (event === 'end') cb();
    return req;
  }) as never);

  const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };

  await router.nodeJSRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return res;
};

const lambdaRequest = (router: Router) =>
  router.lambdaEvent({
    requestContext: { http: { method: 'GET', path: '/t' } },
    headers: {},
  });

describe('response header handling', () => {
  /**
   * Header names are case-insensitive. The default only looked for two exact
   * spellings, so any other casing fell through and `Content-Type` was appended
   * on top — and since `setHeader` is itself case-insensitive, it overwrote the
   * content type the route had deliberately set.
   */
  it('does not overwrite a content type set with unusual casing', async () => {
    const res = await nodeRequest(
      routerReturning({ status: 200, headers: { 'CONTENT-TYPE': 'text/html' }, body: '<p>hi</p>' })
    );

    expect(res.setHeader).toHaveBeenCalledWith('CONTENT-TYPE', 'text/html');
    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Type', 'application/json');
  });

  it('still defaults the content type when a route sets none', async () => {
    const res = await nodeRequest(routerReturning({ status: 200, body: { ok: true } }));

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
  });

  /**
   * A route may return a shared or frozen header constant. Defaulting the
   * content type wrote into whatever object the route handed back, which
   * mutates that constant for every later request and throws outright on a
   * frozen one.
   */
  it('does not mutate the headers object a route returned', async () => {
    const headers = Object.freeze({ 'x-trace': 'abc' });
    const res = await nodeRequest(routerReturning({ status: 200, headers, body: null }));

    expect(res.statusCode).toBe(200);
    expect(headers).toEqual({ 'x-trace': 'abc' });
  });

  /**
   * The two transports have to agree: the node path defaulted the content type
   * whenever it was absent, the lambda path only when `headers` was absent
   * entirely. A route setting any other header got a content type locally and
   * none deployed.
   */
  it('defaults the content type on the lambda path too', async () => {
    const response = await lambdaRequest(
      routerReturning({ status: 200, headers: { 'x-trace': 'abc' }, body: { ok: true } })
    );

    expect(response.headers?.['Content-Type']).toBe('application/json');
    expect(response.headers?.['x-trace']).toBe('abc');
  });

  it('does not add a content type over one the route set', async () => {
    const response = await lambdaRequest(
      routerReturning({ status: 200, headers: { 'content-type': 'text/csv' }, body: 'a,b' })
    );

    expect(response.headers?.['content-type']).toBe('text/csv');
    expect(response.headers?.['Content-Type']).toBeUndefined();
  });
});
