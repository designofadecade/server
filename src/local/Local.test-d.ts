import { describe, it, assertType, expectTypeOf } from 'vitest';
import type { EventFunctionProxyOptions } from '../index.js';

describe('EventFunctionProxyOptions (11.0.0 additions)', () => {
  it('accepts cors as a boolean or an origin list', () => {
    assertType<EventFunctionProxyOptions>({ cors: false });
    assertType<EventFunctionProxyOptions>({ cors: true });
    assertType<EventFunctionProxyOptions>({ cors: ['http://localhost:5173'] });
    expectTypeOf<EventFunctionProxyOptions['cors']>().toEqualTypeOf<
      boolean | string[] | undefined
    >();
  });

  it('accepts allowedHosts as a host list or true', () => {
    assertType<EventFunctionProxyOptions>({ allowedHosts: ['192.168.1.20'] });
    assertType<EventFunctionProxyOptions>({ allowedHosts: true });
    expectTypeOf<EventFunctionProxyOptions['allowedHosts']>().toEqualTypeOf<
      string[] | true | undefined
    >();
  });

  it('accepts allowedPeers as an address/CIDR list or true', () => {
    assertType<EventFunctionProxyOptions>({ allowedPeers: ['192.168.1.30', '10.0.0.0/8'] });
    assertType<EventFunctionProxyOptions>({ allowedPeers: ['fd00::/8'] });
    assertType<EventFunctionProxyOptions>({ allowedPeers: true });
    assertType<EventFunctionProxyOptions>({
      allowedHosts: ['192.168.1.20'],
      allowedPeers: ['192.168.1.0/24'],
    });
    expectTypeOf<EventFunctionProxyOptions['allowedPeers']>().toEqualTypeOf<
      string[] | true | undefined
    >();
  });

  it('rejects wrongly typed values', () => {
    // @ts-expect-error cors is not a single origin string
    assertType<EventFunctionProxyOptions>({ cors: 'http://localhost:5173' });
    // @ts-expect-error allowedHosts: false is not a setting (omit it instead)
    assertType<EventFunctionProxyOptions>({ allowedHosts: false });
    // @ts-expect-error allowedHosts is not a single host string
    assertType<EventFunctionProxyOptions>({ allowedHosts: 'dev.example.test' });
    // @ts-expect-error allowedPeers: false is not a setting (omit it instead)
    assertType<EventFunctionProxyOptions>({ allowedPeers: false });
    // @ts-expect-error allowedPeers is not a single address string
    assertType<EventFunctionProxyOptions>({ allowedPeers: '192.168.1.30' });
  });
});
