import { describe, it, assertType, expectTypeOf } from 'vitest';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import WebSocketServer, { type WebSocketServerOptions } from './WebSocketServer.js';

describe('WebSocketServerOptions (11.0.0 additions)', () => {
  it('accepts a sync or async authenticate and an upgradeTimeoutMs', () => {
    assertType<WebSocketServerOptions>({
      authenticate: (req) => req.headers.cookie?.includes('session=') ?? false,
      upgradeTimeoutMs: 5_000,
    });
    assertType<WebSocketServerOptions>({
      authenticate: async (_req: IncomingMessage) => ({ userId: 'u-1' }),
    });
  });

  it('passes the upgrade request to authenticate', () => {
    expectTypeOf<NonNullable<WebSocketServerOptions['authenticate']>>()
      .parameter(0)
      .toEqualTypeOf<IncomingMessage>();
    expectTypeOf<WebSocketServerOptions['upgradeTimeoutMs']>().toEqualTypeOf<number | undefined>();
  });

  it('rejects wrongly typed values', () => {
    // @ts-expect-error upgradeTimeoutMs is milliseconds, not a string
    assertType<WebSocketServerOptions>({ upgradeTimeoutMs: '10s' });
    // @ts-expect-error authenticate is a function of the request
    assertType<WebSocketServerOptions>({ authenticate: true });
  });
});

describe('WebSocketServer.getAuth', () => {
  it('takes a ws socket and returns the authenticate result as unknown', () => {
    expectTypeOf<WebSocketServer['getAuth']>().parameter(0).toEqualTypeOf<WebSocket>();
    expectTypeOf<WebSocketServer['getAuth']>().returns.toEqualTypeOf<unknown>();
  });
});
