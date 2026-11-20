import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServer as createNetServer, createConnection, type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import Server from './Server.ts';
import { logger } from '../logger/Logger.ts';

/**
 * Connection-level failures (Node's 'clientError'): malformed framing,
 * oversized headers, request timeouts and resets. Real sockets throughout;
 * Server.test.ts mocks `http` and cannot reach these paths.
 */

const ENV = Server.WEB_FUNCTION_ENDPOINT_ENV;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** Writes `payload` and collects everything until the server closes. */
const exchange = (port: number, payload: string, waitMs = 1500): Promise<string> =>
  new Promise((resolve) => {
    const socket = createConnection(port, '127.0.0.1');
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('latin1')));
    socket.on('error', () => {});
    socket.on('close', () => resolve(data));
    socket.write(payload);
    setTimeout(() => socket.destroy(), waitMs).unref();
  });

const clientErrorLogs = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .map((call) => call[1] as Record<string, unknown> | undefined)
    .filter((context) => context?.code === 'SERVER_CLIENT_ERROR');

describe('Server clientError handling', () => {
  let server: Server | undefined;
  let warn: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;
  const handler = vi.fn((req, res) => {
    req.resume();
    req.on('end', () => res.end('ok'));
  });

  const start = async (options: ConstructorParameters<typeof Server>[0] = {}) => {
    const port = await freePort();
    server = new Server({ port, host: '127.0.0.1', ...options }, handler);
    return port;
  };

  beforeEach(() => {
    vi.stubEnv(ENV, '');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    handler.mockClear();
  });

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers a bad chunk size with 400 and logs it at warn', async () => {
    const port = await start();
    await server!.ready;

    const data = await exchange(
      port,
      'POST /x HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\nabc\r\n0\r\n\r\n'
    );

    expect(data).toBe('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    expect(clientErrorLogs(warn)).toEqual([
      {
        code: 'SERVER_CLIENT_ERROR',
        source: 'Server.clientError',
        errorCode: 'HPE_INVALID_CHUNK_SIZE',
      },
    ]);
  });

  it('logs a smuggling-style chunk (data past the declared size) at warn', async () => {
    const port = await start();
    await server!.ready;

    const data = await exchange(
      port,
      'POST /x HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabcXX\r\n0\r\n\r\n'
    );

    expect(data.startsWith('HTTP/1.1 400')).toBe(true);
    expect(clientErrorLogs(warn)).toEqual([
      expect.objectContaining({ errorCode: expect.stringMatching(/^HPE_/) }),
    ]);
  });

  it('answers oversized headers with 431', async () => {
    const port = await start();
    await server!.ready;

    const data = await exchange(
      port,
      `GET / HTTP/1.1\r\nHost: a\r\nX-Big: ${'a'.repeat(20_000)}\r\n\r\n`
    );

    expect(data.startsWith('HTTP/1.1 431')).toBe(true);
    expect(clientErrorLogs(warn)).toEqual([
      expect.objectContaining({ errorCode: 'HPE_HEADER_OVERFLOW' }),
    ]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps Node's 408 for a request that misses requestTimeout, and logs it", async () => {
    const port = await start({ requestTimeout: 300, headersTimeout: 200 });
    // Node checks the timeouts on this interval (30 s by default); it is read
    // when the server starts listening, which has not happened yet.
    server!.server!.connectionsCheckingInterval = 50;
    await server!.ready;

    const data = await exchange(
      port,
      'POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\na',
      5000
    );

    expect(data.startsWith('HTTP/1.1 408 Request Timeout')).toBe(true);
    expect(clientErrorLogs(warn)).toEqual([
      expect.objectContaining({ errorCode: 'ERR_HTTP_REQUEST_TIMEOUT' }),
    ]);
  });

  it('logs a client reset at debug, not warn', async () => {
    const port = await start();
    await server!.ready;

    await new Promise<void>((resolve) => {
      const socket: Socket = createConnection(port, '127.0.0.1', () => {
        socket.write('POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 50\r\n\r\nabc');
        setTimeout(() => socket.resetAndDestroy(), 50);
      });
      socket.on('error', () => {});
      socket.on('close', () => resolve());
    });
    await vi.waitFor(() => expect(clientErrorLogs(debug).length).toBeGreaterThan(0));

    expect(clientErrorLogs(warn)).toEqual([]);
    expect(clientErrorLogs(debug)[0]).toEqual(expect.objectContaining({ errorCode: 'ECONNRESET' }));
  });

  describe('handler semantics', () => {
    const fakeSocket = (state: { writable: boolean; headerSent?: boolean }) => {
      const socket = new Duplex({
        read() {},
        write(_c, _e, cb) {
          cb();
        },
      });
      Object.defineProperty(socket, 'writable', { value: state.writable });
      if (state.headerSent !== undefined) {
        Object.assign(socket, { _httpMessage: { _headerSent: state.headerSent } });
      }
      const write = vi.spyOn(socket, 'write');
      const destroy = vi.spyOn(socket, 'destroy');
      return { socket, write, destroy };
    };
    const clientError = (code: string, extra: Record<string, unknown> = {}) =>
      Object.assign(new Error('parse error'), { code, ...extra });

    it('does not write over a response that has already started', async () => {
      await start();
      await server!.ready;
      const { socket, write, destroy } = fakeSocket({ writable: true, headerSent: true });

      server!.server!.emit('clientError', clientError('HPE_INVALID_CHUNK_SIZE'), socket);

      expect(write).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
    });

    it('does not write to a socket that is no longer writable', async () => {
      await start();
      await server!.ready;
      const { socket, write, destroy } = fakeSocket({ writable: false });

      server!.server!.emit('clientError', clientError('HPE_INVALID_METHOD'), socket);

      expect(write).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
    });

    it('logs only a capped, sanitised error code — never the raw packet', async () => {
      await start();
      await server!.ready;
      const { socket, write } = fakeSocket({ writable: true });

      server!.server!.emit(
        'clientError',
        clientError(`HPE_${'X'.repeat(200)}<script>\r\n`, {
          rawPacket: Buffer.from('GET /secret?token=abc HTTP/1.1'),
        }),
        socket
      );

      const [context] = clientErrorLogs(warn);
      expect(Object.keys(context!).sort()).toEqual(['code', 'errorCode', 'source']);
      expect(context!.errorCode).toMatch(/^[A-Za-z0-9_]{1,64}$/);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
      expect(write).toHaveBeenCalledWith('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });

    it.each([
      ['HPE_HEADER_OVERFLOW', 431],
      ['ERR_HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE', 431],
      ['HPE_CHUNK_EXTENSIONS_OVERFLOW', 413],
      ['ERR_HTTP_REQUEST_TIMEOUT', 408],
      ['HPE_INVALID_EOF_STATE', 400],
    ])('answers %s with %i', async (code, status) => {
      await start();
      await server!.ready;
      const { socket, write } = fakeSocket({ writable: true });

      server!.server!.emit('clientError', clientError(code), socket);

      expect(String(write.mock.calls[0]?.[0])).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
    });
  });
});
