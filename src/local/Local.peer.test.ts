import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import Local from './Local.ts';
import type { EventFunctionProxyOptions } from './Local.ts';
import { logger } from '../logger/Logger.ts';

/**
 * The proxy acts as the authorizer the developer injects for whoever reaches
 * it. It used to decide "is this my machine" from the Host header alone, which
 * the client chooses: a peer on the same network sending `Host: localhost`
 * passed and got the injected identity. Locality now comes from the TCP peer.
 */

const authorizer = { requestContext: { authorizer: { jwt: { claims: { sub: 'admin-1' } } } } };

const run = async (
  remoteAddress: unknown,
  options: EventFunctionProxyOptions = authorizer,
  headers: Record<string, string> = {}
) => {
  const handler = vi.fn(async () => ({ statusCode: 200, body: '{"ok":true}' }));
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader: vi.fn(),
    end: vi.fn((body?: unknown) => {
      res.body = body;
    }),
  };
  const req = {
    url: '/users',
    method: 'GET',
    headers: { host: 'localhost', ...headers },
    socket: { remoteAddress },
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end') cb();
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await Local.EventFunctionProxy(handler, options).request(req as any, res as any);
  return { handler, res, req };
};

const refusedAsPeer = (res: { statusCode: number; body: unknown }) => {
  expect(res.statusCode).toBe(403);
  expect(JSON.parse(String(res.body))).toEqual({
    success: false,
    error: { code: 'PEER_NOT_ALLOWED', message: 'Peer not allowed' },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Local.EventFunctionProxy peer check', () => {
  it.each([
    '192.168.1.20',
    '10.0.0.5',
    '::ffff:192.168.1.20',
    'fe80::1',
    'fe80::1%eth0',
    '::2',
    '0.0.0.0',
    '::',
    '128.0.0.1',
  ])('refuses peer %j with Host: localhost before Host, body or handler', async (remoteAddress) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { handler, res, req } = await run(remoteAddress);

    refusedAsPeer(res);
    expect(handler).not.toHaveBeenCalled();
    // The body was never read, so nothing downstream ran either.
    expect(req.on).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toEqual({
      code: 'LOCAL_PEER_NOT_ALLOWED',
      source: 'Local.EventFunctionProxy',
      peer: remoteAddress,
      method: 'GET',
    });
  });

  it.each([undefined, '', 'localhost', 'not an address', 42])(
    'refuses a missing or unparseable peer address %j',
    async (remoteAddress) => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { handler, res } = await run(remoteAddress);
      refusedAsPeer(res);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it('refuses a request with no socket at all', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const handler = vi.fn();
    const res = { statusCode: 0, body: undefined as unknown, setHeader: vi.fn(), end: vi.fn() };
    const req = { url: '/', method: 'GET', headers: { host: 'localhost' }, on: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Local.EventFunctionProxy(handler).request(req as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('caps the logged peer address', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await run('x'.repeat(500));
    expect((warn.mock.calls[0]![1] as { peer: string }).peer).toHaveLength(64);
  });

  it('checks the peer before the Host header', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { res } = await run('192.168.1.20', authorizer, { host: 'rebind.evil.example' });
    refusedAsPeer(res);
    expect(warn.mock.calls.map((call) => (call[1] as { code: string }).code)).toEqual([
      'LOCAL_PEER_NOT_ALLOWED',
    ]);
  });

  it.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.2'])(
    'serves loopback peer %j with the injected authorizer',
    async (remoteAddress) => {
      const { handler, res } = await run(remoteAddress);
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]![0] as { requestContext: { authorizer: unknown } };
      expect(event.requestContext.authorizer).toEqual(authorizer.requestContext.authorizer);
    }
  );

  describe('allowedPeers', () => {
    it.each([
      [['192.168.1.20'], '192.168.1.20'],
      [['192.168.1.0/24'], '192.168.1.77'],
      [['192.168.1.0/24'], '::ffff:192.168.1.77'],
      [['::ffff:192.168.1.20'], '192.168.1.20'],
      [['10.0.0.0/8', 'fd00::/8'], 'fd12::5'],
      [[' 192.168.1.20 '], '192.168.1.20'],
      [['0.0.0.0/0'], '203.0.113.9'],
      // An IPv4-mapped range is the IPv4 range it maps (/104 is /8).
      [['::ffff:10.0.0.0/104'], '10.20.30.40'],
      [['::ffff:10.0.0.0/104'], '::ffff:10.20.30.40'],
      [['::FFFF:192.168.1.0/120'], '192.168.1.77'],
      [['::ffff:192.168.1.20/128'], '192.168.1.20'],
      // Node's BlockList maps families: an IPv6 rule also covers IPv4 peers.
      [['::/0'], '203.0.113.9'],
    ])('%j admits peer %j', async (allowedPeers, remoteAddress) => {
      const { handler, res } = await run(remoteAddress, { allowedPeers });
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it.each([
      [['192.168.1.20'], '192.168.1.21'],
      [['192.168.1.0/24'], '192.168.2.1'],
      [['fd00::/8'], 'fe80::1'],
      [[], '192.168.1.20'],
      [['::ffff:10.0.0.0/104'], '11.0.0.1'],
      [['::ffff:192.168.1.0/120'], '192.168.2.1'],
    ])('%j still refuses peer %j', async (allowedPeers, remoteAddress) => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { handler, res } = await run(remoteAddress, { allowedPeers });
      refusedAsPeer(res);
      expect(handler).not.toHaveBeenCalled();
    });

    it('keeps loopback allowed alongside a list', async () => {
      const { res } = await run('::1', { allowedPeers: ['192.168.1.0/24'] });
      expect(res.statusCode).toBe(200);
    });

    it('keeps the Host check on for an allowed peer', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { handler, res } = await run(
        '192.168.1.30',
        { allowedPeers: ['192.168.1.0/24'] },
        { host: '192.168.1.20:3000' }
      );
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(String(res.body)).error.code).toBe('HOST_NOT_ALLOWED');
      expect(handler).not.toHaveBeenCalled();

      const listed = await run(
        '192.168.1.30',
        { allowedPeers: ['192.168.1.0/24'], allowedHosts: ['192.168.1.20'] },
        { host: '192.168.1.20:3000' }
      );
      expect(listed.res.statusCode).toBe(200);
    });

    it('true admits any peer and warns once at startup', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const proxy = Local.EventFunctionProxy(async () => ({ statusCode: 200 }), {
        allowedPeers: true,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![1]).toEqual({
        code: 'LOCAL_PEER_CHECK_DISABLED',
        source: 'Local.EventFunctionProxy',
      });

      for (const remoteAddress of ['192.168.1.20', undefined]) {
        const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
        const req = {
          url: '/',
          method: 'GET',
          headers: { host: 'localhost' },
          socket: { remoteAddress },
          on: vi.fn((event: string, cb: () => void) => {
            if (event === 'end') cb();
          }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await proxy.request(req as any, res as any);
        expect(res.statusCode).toBe(200);
      }
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('logs no startup warning for a list', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      Local.EventFunctionProxy(async () => ({ statusCode: 200 }), {
        allowedPeers: ['192.168.1.0/24'],
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      'abc',
      '',
      'localhost',
      '192.168.1.0/33',
      '192.168.1.0/-1',
      '192.168.1.0/x',
      '192.168.1.0/',
      '1.2.3.4/8/1',
      '::/129',
      '192.168.1.256',
      '::ffff:10.0.0.0/129',
    ])('throws at construction on entry %j', (entry) => {
      expect(() =>
        Local.EventFunctionProxy(async () => ({ statusCode: 200 }), { allowedPeers: [entry] })
      ).toThrow(TypeError);
    });

    it.each(['fe80::1%eth0', 'fe80::%25lo0', 'fe80::/10%eth0', 'fe80::1%eth0/64'])(
      'throws on an IPv6 zone id, which no peer address carries: %j',
      (entry) => {
        expect(() =>
          Local.EventFunctionProxy(async () => ({ statusCode: 200 }), { allowedPeers: [entry] })
        ).toThrow(/zone id/);
      }
    );

    it('throws on an IPv4-mapped range wider than ::ffff:0.0.0.0/96, naming the IPv4 form', () => {
      expect(() =>
        Local.EventFunctionProxy(async () => ({ statusCode: 200 }), {
          allowedPeers: ['::ffff:10.0.0.0/80'],
        })
      ).toThrow(/write IPv4 ranges in IPv4 form/);
    });

    it('throws on a non-string entry', () => {
      expect(() =>
        Local.EventFunctionProxy(async () => ({ statusCode: 200 }), {
          allowedPeers: [42 as unknown as string],
        })
      ).toThrow(TypeError);
    });
  });
});

/** A non-loopback IPv4 address of this machine, if it has one. */
const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address;

describe('Local.EventFunctionProxy peer check over a real socket', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  const listenAll = async (options: EventFunctionProxyOptions) => {
    const handler = vi.fn(async () => ({ statusCode: 200, body: '{"ok":true}' }));
    const proxy = Local.EventFunctionProxy(handler, options);
    server = http.createServer((req, res) => void proxy.request(req, res));
    // Every interface, as Node's listen(port) does by default.
    await new Promise<void>((resolve) => server!.listen(0, '0.0.0.0', resolve));
    return { handler, port: (server!.address() as AddressInfo).port };
  };

  const get = (host: string, port: number) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host, port, path: '/users', headers: { host: 'localhost' }, agent: false },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });

  it('serves a loopback client', async () => {
    const { handler, port } = await listenAll(authorizer);
    const reply = await get('127.0.0.1', port);
    expect(reply.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.skipIf(!lanAddress)(
    'refuses a client on the network interface even with Host: localhost',
    async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { handler, port } = await listenAll(authorizer);
      const reply = await get(lanAddress!, port);
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.body).error.code).toBe('PEER_NOT_ALLOWED');
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.skipIf(!lanAddress)('serves that client once its address is opted in', async () => {
    const { handler, port } = await listenAll({ ...authorizer, allowedPeers: [lanAddress!] });
    const reply = await get(lanAddress!, port);
    expect(reply.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
