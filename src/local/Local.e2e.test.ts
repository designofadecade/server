import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Local from './Local.ts';

/**
 * The other suites drive `LambdaProxyRouter` with a mocked request and
 * response, which cannot catch anything Node's HTTP layer does to a header or a
 * body on the way out. This one runs a real Lambda handler over a real socket
 * and reads the result back with `fetch`, so it exercises the whole chain the
 * way a developer running the app locally does.
 *
 * Every assertion here is something API Gateway would do with the same handler
 * deployed. A failure means local dev and deployed have diverged.
 */
const serve = async (handler: Parameters<typeof Local.LambdaProxyRouter>[0]) => {
  const proxy = Local.LambdaProxyRouter(handler);
  const server = http.createServer((req, res) => proxy.request(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    fetch: (path = '/x') => fetch(`http://127.0.0.1:${port}${path}`),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe('Local.LambdaProxyRouter over a real socket', () => {
  it('delivers status, cookies, headers and an untouched body', async () => {
    // Pretty-printed, with an escape and a trailing-zero number: all three are
    // rewritten by a JSON decode/re-encode round trip and must survive.
    const body = JSON.stringify({ name: 'é', count: 1.0 }, null, 2);
    const server = await serve(async () => ({
      statusCode: 201,
      headers: { 'Content-Type': 'application/json', 'x-count': 2 },
      cookies: ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'],
      body,
    }));

    const response = await server.fetch();
    const text = await response.text();
    await server.close();

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    // A numeric header value, which AWS permits and Node's setHeader does not.
    expect(response.headers.get('x-count')).toBe('2');
    // Two cookies, which a header map cannot carry.
    expect(response.headers.getSetCookie()).toEqual([
      'session=abc; Path=/; HttpOnly',
      'theme=dark; Path=/',
    ]);
    expect(text).toBe(body);
  });

  it('delivers a bare string return the way API Gateway infers it', async () => {
    const server = await serve(async () => 'Hello from Lambda!');

    const response = await server.fetch();
    const text = await response.text();
    await server.close();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(text).toBe('Hello from Lambda!');
  });

  it('keeps a content type set with unusual casing', async () => {
    const server = await serve(async () => ({
      statusCode: 200,
      headers: { 'CONTENT-TYPE': 'text/html; charset=utf-8' },
      body: '<p>hi</p>',
    }));

    const response = await server.fetch();
    const text = await response.text();
    await server.close();

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(text).toBe('<p>hi</p>');
  });

  it('decodes a base64 body before sending it', async () => {
    const server = await serve(async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('binary payload').toString('base64'),
      isBase64Encoded: true,
    }));

    const response = await server.fetch();
    const text = await response.text();
    await server.close();

    expect(text).toBe('binary payload');
  });
});
