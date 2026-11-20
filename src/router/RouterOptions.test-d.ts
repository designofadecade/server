import { describe, it, assertType, expectTypeOf } from 'vitest';
import Router from './Router.js';
import type { RouterOptions, RouterRequest } from '../index.js';

/**
 * Options and request fields added in 11.0.0. These are what consumers write
 * in their own code, so a rename or a type change here is a breaking change
 * even when every runtime test still passes.
 */
describe('RouterOptions (11.0.0 additions)', () => {
  it('accepts maxBodyBytes, logPath, webFunction and trustedProxies', () => {
    const options: RouterOptions = {
      maxBodyBytes: 5 * 1024 * 1024,
      logPath: true,
      webFunction: true,
      trustedProxies: 1,
    };
    expectTypeOf(new Router(options)).toEqualTypeOf<Router>();
  });

  it('types each option precisely', () => {
    expectTypeOf<RouterOptions['maxBodyBytes']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RouterOptions['logPath']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<RouterOptions['webFunction']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<RouterOptions['trustedProxies']>().toEqualTypeOf<number | undefined>();
  });

  it('rejects wrongly typed values', () => {
    // @ts-expect-error maxBodyBytes is a byte count, not a size string
    assertType<RouterOptions>({ maxBodyBytes: '1mb' });
    // @ts-expect-error logPath is a boolean
    assertType<RouterOptions>({ logPath: 'yes' });
    // @ts-expect-error trustedProxies is a hop count
    assertType<RouterOptions>({ trustedProxies: ['10.0.0.1'] });
  });
});

describe('RouterRequest fields', () => {
  const base = {
    path: '/users/1',
    method: 'GET',
    body: null,
    cookies: {},
    params: { id: '1' },
    query: {},
    headers: {},
  };

  it('requires clientIp and requestId, and leaves route optional', () => {
    assertType<RouterRequest>({ ...base, clientIp: '', requestId: 'r-1' });
    assertType<RouterRequest>({ ...base, clientIp: '', requestId: 'r-1', route: '/users/:id' });
    expectTypeOf<RouterRequest['route']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RouterRequest['clientIp']>().toEqualTypeOf<string>();
    expectTypeOf<RouterRequest['requestId']>().toEqualTypeOf<string>();
  });

  it('rejects a hand-built request without clientIp', () => {
    // @ts-expect-error clientIp is required
    assertType<RouterRequest>({ ...base, requestId: 'r-1' });
  });

  it('rejects a hand-built request without requestId', () => {
    // @ts-expect-error requestId is required
    assertType<RouterRequest>({ ...base, clientIp: '' });
  });
});
