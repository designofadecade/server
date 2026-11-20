import { describe, it, expectTypeOf } from 'vitest';
import type { IncomingMessage } from 'http';
import EventsManager from './EventsManager.js';

type Registration = Parameters<EventsManager['registerEvents']>[0][number];
type Handler = Registration['handler'];

describe('EventsManager handler signature', () => {
  it('passes the message, then the sending ws, its upgrade request and its auth result', () => {
    expectTypeOf<Parameters<Handler>[0]>().toHaveProperty('type');
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<IncomingMessage | undefined>();
    expectTypeOf<Parameters<Handler>[3]>().toEqualTypeOf<unknown>();
  });

  it('accepts handlers of one to four parameters', () => {
    const manager = new EventsManager();
    manager.registerEvents([
      { type: 'ping', handler: async (msg) => void msg.type },
      {
        type: 'update',
        handler: async (msg, ws, req, auth) => {
          expectTypeOf(req).toEqualTypeOf<IncomingMessage | undefined>();
          expectTypeOf(auth).toEqualTypeOf<unknown>();
          void [msg, ws];
        },
      },
    ]);
  });

  it('rejects a handler that needs a fifth argument', () => {
    const extra = async (_m: unknown, _w: unknown, _r: unknown, _a: unknown, _e: string) => {};
    // @ts-expect-error a handler receives at most (msg, ws, req, auth)
    const handler: Handler = extra;
    void handler;
  });
});
