import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import { WebSocket } from 'ws';
import WebSocketServer from './WebSocketServer.ts';

/**
 * Integration tests that open real WebSocket connections.
 *
 * The unit tests drive the verifyClient callback directly against a mocked ws
 * server, which proves the gate logic but not that `ws` is actually wired to
 * enforce it. These connect over a socket, so a regression in how the options
 * are passed through would be caught.
 */

/** Ask the OS for a free port, then release it. WebSocketServer rejects port 0. */
const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const connect = (port: number, origin?: string): Promise<string> =>
  new Promise((resolve) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
    client.on('open', () => {
      resolve('connected');
      client.close();
    });
    client.on('error', (error: Error) => resolve(`refused: ${error.message}`));
  });

let server: WebSocketServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('WebSocketServer integration', () => {
  describe('origin allowlist', () => {
    it('should accept an allowlisted origin and refuse everything else', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port, allowedOrigins: ['https://app.example.com'] });
      server.on('error', () => {});

      await expect(connect(port, 'https://app.example.com')).resolves.toBe('connected');
      // Cross-site WebSocket hijacking: a browser would happily send cookies
      // with this upgrade, so the origin has to be checked server-side.
      await expect(connect(port, 'https://evil.example')).resolves.toContain('403');
      // Non-browser clients send no Origin and are refused by the allowlist.
      await expect(connect(port)).resolves.toContain('403');
    });

    it('should accept any origin when no allowlist is configured', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port });
      server.on('error', () => {});

      await expect(connect(port, 'https://anywhere.example')).resolves.toBe('connected');
    });

    it('should honour a custom verifyClient', async () => {
      const port = await freePort();
      server = new WebSocketServer({
        port,
        verifyClient: async ({ req }) => req.headers['x-api-key'] === 'let-me-in',
      });
      server.on('error', () => {});

      const withKey = await new Promise<string>((resolve) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: { 'x-api-key': 'let-me-in' },
        });
        client.on('open', () => {
          resolve('connected');
          client.close();
        });
        client.on('error', (error: Error) => resolve(`refused: ${error.message}`));
      });

      expect(withKey).toBe('connected');
      await expect(connect(port)).resolves.toContain('403');
    });
  });

  describe('maxPayload', () => {
    it('should close a connection that exceeds the frame cap', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port, maxPayload: 1024 });
      server.on('error', () => {});

      const closeCode = await new Promise<number>((resolve) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        client.on('open', () => client.send('x'.repeat(5000)));
        client.on('close', (code: number) => resolve(code));
        client.on('error', () => resolve(-1));
      });

      // 1009 = Message Too Big. Without a cap, ws buffers up to 100 MiB.
      expect(closeCode).toBe(1009);
    });

    it('should accept a frame within the cap', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port, maxPayload: 8192 });
      server.on('error', () => {});

      const delivered = await new Promise<boolean>((resolve) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        let settled = false;
        client.on('open', () =>
          client.send(JSON.stringify({ type: 'test:message', payload: { size: 'small' } }))
        );
        client.on('close', (code: number) => {
          if (!settled) resolve(code !== 1009);
        });
        server?.on('message', () => {
          settled = true;
          resolve(true);
          client.close();
        });
        client.on('error', () => resolve(false));
      });

      expect(delivered).toBe(true);
    });
  });

  describe('connection event', () => {
    it('should expose the upgrade request so callers can authenticate', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port });
      server.on('error', () => {});

      const cookie = await new Promise<string | undefined>((resolve) => {
        server?.on('connection', (_ws, req) => resolve(req.headers.cookie));
        const client = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: { cookie: 'session=abc123' },
        });
        client.on('open', () => client.close());
        client.on('error', () => resolve(undefined));
      });

      expect(cookie).toBe('session=abc123');
    });
  });

  describe('message sender', () => {
    it('should deliver each message with the socket and request that sent it', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port });
      server.on('error', () => {});

      let connectedWs: unknown;
      server.on('connection', (ws) => {
        connectedWs = ws;
      });

      const client = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { cookie: 'session=abc123' },
      });
      const received = await new Promise<{ type: string; ws: unknown; cookie?: string }>(
        (resolve, reject) => {
          server?.on('message', (parsed, ws, req) =>
            resolve({ type: parsed.type, ws, cookie: req?.headers.cookie })
          );
          client.on('open', () => client.send(JSON.stringify({ type: 'doc:update', payload: {} })));
          client.on('error', reject);
        }
      );
      client.close();

      expect(received.type).toBe('doc:update');
      expect(received.ws).toBe(connectedWs);
      expect(received.cookie).toBe('session=abc123');
    });

    it('should not deliver frames from a socket the connection handler closed', async () => {
      const port = await freePort();
      server = new WebSocketServer({ port });
      server.on('error', () => {});

      // An application refusing the client in its 'connection' handler.
      server.on('connection', (ws) => ws.close(4401, 'Unauthorized'));
      const listener = vi.fn();
      server.on('message', listener);

      const closeCode = await new Promise<number>((resolve) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        // Sent before the client has processed the server's close frame, so
        // they reach the server while its side of the socket is CLOSING.
        client.on('open', () => {
          for (let i = 0; i < 5; i++) {
            client.send(JSON.stringify({ type: 'doc:update', payload: { i } }));
          }
        });
        client.on('close', (code: number) => resolve(code));
        client.on('error', () => resolve(-1));
      });

      expect(closeCode).toBe(4401);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should let handlers attribute each message to its verified connection', async () => {
      const port = await freePort();
      // Per-connection state recorded at upgrade time and looked up by the
      // request delivered with every message.
      const sessions = new WeakMap<object, string>();
      server = new WebSocketServer({
        port,
        verifyClient: async ({ req }) => {
          const user = req.headers['x-test-user'];
          if (typeof user !== 'string') return false;
          sessions.set(req, user);
          return true;
        },
      });
      server.on('error', () => {});

      const seen: Record<string, string | undefined> = {};
      const bothSeen = new Promise<void>((resolve) => {
        server?.on('message', (parsed, _ws, req) => {
          seen[parsed.payload.claimed] = sessions.get(req);
          if (Object.keys(seen).length === 2) resolve();
        });
      });

      const clients = ['user-a', 'user-b'].map((user) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: { 'x-test-user': user },
        });
        client.on('open', () =>
          client.send(JSON.stringify({ type: 'doc:update', payload: { claimed: user } }))
        );
        return client;
      });

      await bothSeen;
      clients.forEach((client) => client.close());

      expect(seen).toEqual({ 'user-a': 'user-a', 'user-b': 'user-b' });
    });
  });
});
