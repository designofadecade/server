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

    it('answers a foreign preflight with no CORS grant, so the browser blocks it', async () => {
      const { headers, res } = await run({
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' },
      });

      expect(res.statusCode).toBe(204);
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
