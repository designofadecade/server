import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Local from './Local.ts';
import { logger } from '../logger/Logger.ts';
import type { EventFunctionProxyOptions } from './Local.ts';

/**
 * SECURITY (F5, F6): the proxy injects an authorizer into every event, so any
 * caller that reaches it acts as that identity. It used to answer every origin
 * with `Access-Control-Allow-Origin: *`, letting any website the developer
 * visited drive the local backend and read the responses, and it served any
 * Host, so DNS rebinding reached it as a same-origin page.
 */

type Headers = Record<string, string | undefined>;

const run = async (
  {
    method = 'GET',
    headers = {},
  }: {
    method?: string;
    headers?: Headers;
  },
  options: EventFunctionProxyOptions = {}
) => {
  const handler = vi.fn(async () => ({ statusCode: 200, body: '{"ok":true}' }));
  const set: Record<string, unknown> = {};
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: unknown) => {
      set[name.toLowerCase()] = value;
    }),
    end: vi.fn((body?: unknown) => {
      res.body = body;
    }),
  };
  const req = {
    url: '/x',
    method,
    headers: { host: 'localhost:3000', ...headers },
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end') cb();
    }),
  };
  // A header explicitly set to undefined is removed, to model a missing one.
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) delete (req.headers as Headers)[name];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await Local.EventFunctionProxy(handler, options).request(req as any, res as any);
  return { handler, res, headers: set };
};

describe('Local.EventFunctionProxy CORS', () => {
  describe('default (loopback origins only)', () => {
    it.each([
      'http://localhost:5173',
      'http://localhost',
      'https://localhost:8443',
      'http://127.0.0.1:3000',
      'http://127.1.2.3',
      'http://[::1]:5173',
      'http://foo.localhost:5173',
    ])('reflects %s without credentials', async (origin) => {
      const { headers } = await run({ headers: { origin } });

      expect(headers['access-control-allow-origin']).toBe(origin);
      expect(headers['access-control-allow-credentials']).toBeUndefined();
      expect(headers['vary']).toBe('Origin');
    });

    it.each([
      'https://evil.example',
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'null',
      'not a url',
      'http://localhost:5173/path',
      'http://user@localhost:5173',
      'file:///etc/passwd',
      'http://localhost:5173, https://evil.example',
      '',
    ])('sends no Allow-Origin for %j', async (origin) => {
      const { headers, handler } = await run({ headers: { origin } });

      expect(headers['access-control-allow-origin']).toBeUndefined();
      expect(headers['access-control-allow-credentials']).toBeUndefined();
      // Vary is still sent so a cache cannot reuse a loopback response for it.
      expect(headers['vary']).toBe('Origin');
      // CORS is enforced by the browser; a same-machine request still runs.
      expect(handler).toHaveBeenCalled();
    });

    it('answers a loopback preflight with the allowed methods and headers', async () => {
      const { headers, res, handler } = await run({
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'DELETE' },
      });

      expect(res.statusCode).toBe(204);
      expect(headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(headers['access-control-allow-methods']).toContain('DELETE');
      expect(headers['access-control-allow-headers']).toContain('Authorization');
      expect(headers['vary']).toBe('Origin');
      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a foreign preflight with 403 and no CORS grant', async () => {
      const { headers, res } = await run({
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(String(res.body)).error.code).toBe('CROSS_ORIGIN_FORBIDDEN');
      expect(headers['access-control-allow-origin']).toBeUndefined();
      expect(headers['access-control-allow-methods']).toBeUndefined();
    });

    it('sends no Allow-Origin when there is no Origin header', async () => {
      const { headers } = await run({});
      expect(headers['access-control-allow-origin']).toBeUndefined();
      expect(headers['vary']).toBe('Origin');
    });
  });

  it('cors: false sends no CORS headers at all', async () => {
    const { headers } = await run(
      { headers: { origin: 'http://localhost:5173' } },
      { cors: false }
    );

    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['vary']).toBeUndefined();
  });

  it('cors: true is the explicit wildcard opt-in', async () => {
    const { headers } = await run({ headers: { origin: 'https://evil.example' } }, { cors: true });

    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-credentials']).toBeUndefined();
  });

  describe('cors: string[] (router allowlist semantics)', () => {
    const cors = ['https://app.example.test'];

    it('reflects a listed origin with credentials', async () => {
      const { headers } = await run({ headers: { origin: 'https://app.example.test' } }, { cors });

      expect(headers['access-control-allow-origin']).toBe('https://app.example.test');
      expect(headers['access-control-allow-credentials']).toBe('true');
      expect(headers['vary']).toBe('Origin');
    });

    it('does not fall back to the loopback default for unlisted origins', async () => {
      const { headers } = await run({ headers: { origin: 'http://localhost:5173' } }, { cors });
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('Local.EventFunctionProxy Host check', () => {
  const refused = (res: { statusCode: number; body: unknown }) => {
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(res.body))).toEqual({
      success: false,
      error: { code: 'HOST_NOT_ALLOWED', message: 'Host not allowed' },
    });
  };

  it.each([
    'localhost',
    'localhost:3000',
    'LOCALHOST:3000',
    'app.localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '127.10.20.30:8080',
    '[::1]',
    '[::1]:3000',
  ])('serves loopback Host %s', async (host) => {
    const { res, handler } = await run({ headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it.each([
    // DNS rebinding: the attacker's name resolves to 127.0.0.1 but the
    // browser still sends it as Host.
    'rebind.evil.example:3000',
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    '192.168.1.20:3000',
    '[::2]:3000',
    'evil.example@localhost',
    'localhost/evil',
    'a b',
    '',
  ])('refuses Host %j with 403 before the handler runs', async (host) => {
    const { res, handler, headers } = await run({
      headers: { host, origin: 'http://localhost:5173' },
    });
    refused(res);
    expect(handler).not.toHaveBeenCalled();
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a request with no Host header', async () => {
    const { res, handler } = await run({ headers: { host: undefined } });
    refused(res);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a preflight to a foreign Host too', async () => {
    const { res } = await run({
      method: 'OPTIONS',
      headers: { host: 'rebind.evil.example', origin: 'http://rebind.evil.example' },
    });
    refused(res);
  });

  describe('allowedHosts list', () => {
    const allowedHosts = ['dev.example.test', '192.168.1.20', 'Tunnel.Example.Test:9000'];

    it.each([
      'dev.example.test',
      'DEV.example.test:3000',
      '192.168.1.20:5173',
      'tunnel.example.test',
      'tunnel.example.test:1234',
      'localhost:3000',
    ])('serves %s (case-insensitive, port ignored, loopback still allowed)', async (host) => {
      const { res } = await run({ headers: { host } }, { allowedHosts });
      expect(res.statusCode).toBe(200);
    });

    it('still refuses names not on the list', async () => {
      const { res } = await run({ headers: { host: 'other.example.test' } }, { allowedHosts });
      refused(res);
    });

    it('does not widen CORS: a listed host origin still needs a cors entry', async () => {
      const { headers } = await run(
        { headers: { host: 'dev.example.test', origin: 'http://dev.example.test:5173' } },
        { allowedHosts }
      );
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('allowedHosts: true disables the check', async () => {
    const { res } = await run(
      { headers: { host: 'anything.example.test' } },
      { allowedHosts: true }
    );
    expect(res.statusCode).toBe(200);
  });

  it('allowedHosts: true still serves a request with no Host', async () => {
    const { res } = await run({ headers: { host: undefined } }, { allowedHosts: true });
    expect(res.statusCode).toBe(200);
  });
});

describe('Local.EventFunctionProxy CORS and Host over a real socket', () => {
  const request = (port: number, method: string, headers: Record<string, string>) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/x', method, headers },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
            );
          }
        );
        req.on('error', reject);
        req.end();
      }
    );

  it('grants a loopback origin and refuses a rebinding Host', async () => {
    const proxy = Local.EventFunctionProxy(async () => ({ statusCode: 200, body: 'ok' }), {
      requestContext: { authorizer: { jwt: { claims: { sub: 'admin-id' } } } },
    });
    const server = http.createServer((req, res) => proxy.request(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const preflight = await request(port, 'OPTIONS', {
        host: `localhost:${port}`,
        origin: 'http://localhost:5173',
        'access-control-request-method': 'DELETE',
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(preflight.headers['vary']).toBe('Origin');

      const foreign = await request(port, 'GET', {
        host: `localhost:${port}`,
        origin: 'https://evil.example',
      });
      expect(foreign.status).toBe(200);
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();

      const rebound = await request(port, 'DELETE', {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
      });
      expect(rebound.status).toBe(403);
      expect(JSON.parse(rebound.body).error.code).toBe('HOST_NOT_ALLOWED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Local.EventFunctionProxy unsafe opt-ins', () => {
  it.each([
    [{ cors: true }, 'LOCAL_CORS_WILDCARD'],
    [{ allowedHosts: true }, 'LOCAL_HOST_CHECK_DISABLED'],
  ] as const)('warns once at startup for %j', async (options, code) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const proxy = Local.EventFunctionProxy(async () => ({ statusCode: 200 }), options);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![1]).toMatchObject({ code });

      const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
      const req = {
        url: '/x',
        method: 'GET',
        headers: { host: 'localhost' },
        on: vi.fn((event: string, cb: () => void) => {
          if (event === 'end') cb();
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await proxy.request(req as any, res as any);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('the allowedHosts: true warning says what rebinding can still do', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      Local.EventFunctionProxy(async () => ({ statusCode: 200 }), { allowedHosts: true });
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain('DNS-rebinding');
      expect(message).toContain('read GET responses');
      expect(message).toContain('cross-origin writes are still limited');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn for the defaults or for explicit lists', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      Local.EventFunctionProxy(async () => ({ statusCode: 200 }));
      Local.EventFunctionProxy(async () => ({ statusCode: 200 }), {
        cors: ['http://app.example.test'],
        allowedHosts: ['dev.example.test'],
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Local.EventFunctionProxy Host check ordering', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'])(
    'refuses a foreign Host for %s before reading the body or running the handler',
    async (method) => {
      const handler = vi.fn(async () => ({ statusCode: 200 }));
      const on = vi.fn();
      const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
      const req = {
        url: '/x',
        method,
        // A bearer token the router would otherwise decode into an authorizer.
        headers: { host: 'rebind.evil.example', authorization: 'Bearer x.y.z' },
        on,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Local.EventFunctionProxy(handler).request(req as any, res as any);

      expect(res.statusCode).toBe(403);
      expect(on).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    }
  );
});

describe('Local.EventFunctionProxy cross-origin writes (CSRF)', () => {
  // The proxy injects an authorizer, so a form post or `no-cors` fetch from a
  // page the developer has open would act as that identity even though the
  // page cannot read the reply.
  const authorizer = { requestContext: { authorizer: { jwt: { claims: { sub: 'admin-id' } } } } };

  const runWithBody = async (
    { method, headers, body }: { method: string; headers: Record<string, string>; body?: string },
    options: EventFunctionProxyOptions = authorizer
  ) => {
    const handler = vi.fn(async () => ({ statusCode: 200, body: '{"ok":true}' }));
    const set: Record<string, unknown> = {};
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      setHeader: vi.fn((name: string, value: unknown) => {
        set[name.toLowerCase()] = value;
      }),
      end: vi.fn((b?: unknown) => {
        res.body = b;
      }),
    };
    const on = vi.fn((event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data' && body !== undefined) cb(Buffer.from(body));
      if (event === 'end') cb();
    });
    const req = { url: '/x', method, headers: { host: 'localhost:3000', ...headers }, on };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Local.EventFunctionProxy(handler, options).request(req as any, res as any);
    return { handler, res, headers: set, on };
  };

  const forbidden = (res: { statusCode: number; body: unknown }) => {
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(res.body))).toEqual({
      success: false,
      error: { code: 'CROSS_ORIGIN_FORBIDDEN', message: 'Cross-origin request not allowed' },
    });
  };

  const evil = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

  it('refuses the reviewer case: text/plain POST from evil with an injected authorizer', async () => {
    const { res, handler, on, headers } = await runWithBody({
      method: 'POST',
      headers: { ...evil, 'content-type': 'text/plain' },
      body: '{"action":"delete-everything"}',
    });
    forbidden(res);
    expect(handler).not.toHaveBeenCalled();
    // Refused before the body is read.
    expect(on).not.toHaveBeenCalled();
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a form-urlencoded POST from evil', async () => {
    const { res, handler } = await runWithBody({
      method: 'POST',
      headers: { ...evil, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
    });
    forbidden(res);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a POST with no body from evil', async () => {
    const { res, handler } = await runWithBody({ method: 'POST', headers: evil });
    forbidden(res);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'PROPFIND', 'OPTIONS'])(
    'refuses %s from evil',
    async (method) => {
      const { res, handler } = await runWithBody({ method, headers: evil });
      forbidden(res);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it('refuses on Origin alone, without Sec-Fetch-Site', async () => {
    const { res, handler } = await runWithBody({
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    forbidden(res);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['cross-site', 'same-site'])(
    'refuses Sec-Fetch-Site %s with no Origin (fail closed)',
    async (site) => {
      const { res, handler } = await runWithBody({
        method: 'POST',
        headers: { 'sec-fetch-site': site },
      });
      forbidden(res);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.each(['null', 'http://localhost.evil.example', 'not a url'])(
    'refuses a POST with Origin %j',
    async (origin) => {
      const { res } = await runWithBody({ method: 'POST', headers: { origin } });
      forbidden(res);
    }
  );

  it.each([
    ['http://localhost:5173', 'same-site'],
    ['http://127.0.0.1:5173', 'cross-site'],
    ['http://localhost:3000', 'same-origin'],
  ])('allows a POST from loopback origin %s (%s)', async (origin, site) => {
    const { res, handler, headers } = await runWithBody({
      method: 'POST',
      headers: { origin, 'sec-fetch-site': site, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalled();
    expect(headers['access-control-allow-origin']).toBe(origin);
  });

  it('allows a POST with no Origin and no Sec-Fetch-Site (curl, server-to-server)', async () => {
    const { res, handler } = await runWithBody({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('allows a same-origin POST with Sec-Fetch-Site and no Origin', async () => {
    const { res } = await runWithBody({
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('still runs a GET from evil, with no Allow-Origin (GET routes must be side-effect free)', async () => {
    const { res, handler, headers } = await runWithBody({ method: 'GET', headers: evil });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalled();
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  // Only GET is exempt: a HEAD runs the handler just as a POST does.
  it('refuses a HEAD from evil', async () => {
    const { res, handler } = await runWithBody({ method: 'HEAD', headers: evil });
    forbidden(res);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a HEAD with no Origin and no Sec-Fetch-Site (curl)', async () => {
    const { res, handler } = await runWithBody({ method: 'HEAD', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  describe('no Origin and no Sec-Fetch-Site (older browsers send neither on a form post)', () => {
    it.each([
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain;charset=UTF-8',
      ' Text/Plain ',
    ])('refuses a POST with form Content-Type %j', async (contentType) => {
      const { res, handler, on } = await runWithBody({
        method: 'POST',
        headers: { 'content-type': contentType, 'content-length': '3' },
        body: 'a=1',
      });
      forbidden(res);
      expect(handler).not.toHaveBeenCalled();
      expect(on).not.toHaveBeenCalled();
    });

    it('refuses a bodiless POST with a form Content-Type', async () => {
      const { res } = await runWithBody({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '0' },
      });
      forbidden(res);
    });

    it.each([{ 'content-length': '5' }, { 'transfer-encoding': 'chunked' }])(
      'refuses a body with no Content-Type (%j)',
      async (bodyHeaders) => {
        const { res, handler } = await runWithBody({
          method: 'POST',
          headers: bodyHeaders,
          body: 'hello',
        });
        forbidden(res);
        expect(handler).not.toHaveBeenCalled();
      }
    );

    it.each([{}, { 'content-length': '0' }])(
      'allows a bodiless POST with no Content-Type (%j)',
      async (bodyHeaders) => {
        const { res, handler } = await runWithBody({ method: 'POST', headers: bodyHeaders });
        expect(res.statusCode).toBe(200);
        expect(handler).toHaveBeenCalled();
      }
    );

    it.each(['PUT', 'PATCH', 'DELETE'])(
      'allows a JSON %s (curl, server-to-server)',
      async (method) => {
        const { res, handler } = await runWithBody({
          method,
          headers: { 'content-type': 'application/json', 'content-length': '2' },
          body: '{}',
        });
        expect(res.statusCode).toBe(200);
        expect(handler).toHaveBeenCalled();
      }
    );

    it('cors: true still allows a form post (explicit, warned opt-in)', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        const { res } = await runWithBody(
          { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' },
          { ...authorizer, cors: true }
        );
        expect(res.statusCode).toBe(200);
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('logs the refusal with a bounded origin', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const origin = `https://${'a'.repeat(500)}.example`;
      await runWithBody({ method: 'POST', headers: { origin } });
      const call = warn.mock.calls.find(
        (c) => (c[1] as { code?: string })?.code === 'LOCAL_CROSS_ORIGIN_BLOCKED'
      );
      expect(call).toBeDefined();
      expect((call![1] as { origin: string }).origin).toHaveLength(200);
    } finally {
      warn.mockRestore();
    }
  });

  it('cors: false refuses foreign writes too', async () => {
    const { res } = await runWithBody(
      { method: 'POST', headers: evil },
      { ...authorizer, cors: false }
    );
    forbidden(res);
  });

  describe('cors: string[]', () => {
    const options = { ...authorizer, cors: ['https://app.example.test'] };

    it('allows a POST from a listed origin', async () => {
      const { res, handler, headers } = await runWithBody(
        {
          method: 'POST',
          headers: { origin: 'https://app.example.test', 'sec-fetch-site': 'cross-site' },
        },
        options
      );
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalled();
      expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows a preflight from a listed origin', async () => {
      const { res, headers } = await runWithBody(
        { method: 'OPTIONS', headers: { origin: 'https://app.example.test' } },
        options
      );
      expect(res.statusCode).toBe(204);
      expect(headers['access-control-allow-origin']).toBe('https://app.example.test');
    });

    it.each(['https://evil.example', 'http://localhost:5173'])(
      'refuses a POST from unlisted origin %s',
      async (origin) => {
        const { res, handler } = await runWithBody(
          { method: 'POST', headers: { origin, 'sec-fetch-site': 'cross-site' } },
          options
        );
        forbidden(res);
        expect(handler).not.toHaveBeenCalled();
      }
    );

    it('allows a same-origin POST that is not listed', async () => {
      const { res } = await runWithBody(
        { method: 'POST', headers: { origin: 'http://localhost:3000' } },
        options
      );
      expect(res.statusCode).toBe(200);
    });

    // SECURITY: with the Host check off, a DNS-rebinding page is same-origin
    // in its own browser and its Origin host equals the Host it sends, so
    // neither signal may vouch for a non-loopback origin.
    describe('allowedHosts: true (DNS rebinding)', () => {
      const rebinding = { ...options, allowedHosts: true as const };
      const quiet = async <T>(fn: () => Promise<T>) => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        try {
          return await fn();
        } finally {
          warn.mockRestore();
        }
      };

      it.each([{ 'sec-fetch-site': 'same-origin' }, {}])(
        'refuses a rebinding page POST (%j)',
        async (site) => {
          const { res, handler } = await quiet(() =>
            runWithBody(
              {
                method: 'POST',
                headers: { host: 'evil.example', origin: 'http://evil.example', ...site },
              },
              rebinding
            )
          );
          forbidden(res);
          expect(handler).not.toHaveBeenCalled();
        }
      );

      it('refuses a rebinding page POST in the default mode too', async () => {
        const { res } = await quiet(() =>
          runWithBody(
            {
              method: 'POST',
              headers: {
                host: 'evil.example',
                origin: 'http://evil.example',
                'sec-fetch-site': 'same-origin',
              },
            },
            { ...authorizer, allowedHosts: true }
          )
        );
        forbidden(res);
      });

      it('still allows a listed origin and a loopback same-origin POST', async () => {
        const listed = await quiet(() =>
          runWithBody(
            {
              method: 'POST',
              headers: { host: 'evil.example', origin: 'https://app.example.test' },
            },
            rebinding
          )
        );
        expect(listed.res.statusCode).toBe(200);
        const loopback = await quiet(() =>
          runWithBody(
            {
              method: 'POST',
              headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
            },
            rebinding
          )
        );
        expect(loopback.res.statusCode).toBe(200);
      });
    });

    it('allowedHosts list: a same-origin POST from a listed host still passes', async () => {
      const { res } = await runWithBody(
        {
          method: 'POST',
          headers: { host: '192.168.1.20:3000', origin: 'http://192.168.1.20:3000' },
        },
        { ...options, allowedHosts: ['192.168.1.20'] }
      );
      expect(res.statusCode).toBe(200);
    });
  });

  it('cors: true keeps allowing cross-origin writes (explicit, warned opt-in)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { res, handler, headers } = await runWithBody(
        { method: 'POST', headers: evil, body: 'x' },
        { ...authorizer, cors: true }
      );
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalled();
      expect(headers['access-control-allow-origin']).toBe('*');
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses a cross-site POST over a real socket', async () => {
    const handler = vi.fn(async () => ({ statusCode: 200, body: 'ok' }));
    const proxy = Local.EventFunctionProxy(handler, authorizer);
    const server = http.createServer((req, res) => proxy.request(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/x',
            method: 'POST',
            headers: { host: `localhost:${port}`, ...evil, 'content-type': 'text/plain' },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on('error', reject);
        req.end('payload');
      });
      expect(result.status).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe('CROSS_ORIGIN_FORBIDDEN');
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Local.EventFunctionProxy Host refusal log', () => {
  it('bounds the logged Host to 200 characters', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await run({ headers: { host: `${'h'.repeat(500)}.example` } });
      const call = warn.mock.calls.find(
        (c) => (c[1] as { code?: string })?.code === 'LOCAL_HOST_NOT_ALLOWED'
      );
      expect((call![1] as { host: string }).host).toHaveLength(200);
    } finally {
      warn.mockRestore();
    }
  });
});
