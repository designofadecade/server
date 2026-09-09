import { describe, it, expect, afterEach } from 'vitest';
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
});
