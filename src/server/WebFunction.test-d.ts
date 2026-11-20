import { describe, it, assertType, expectTypeOf } from 'vitest';
import type { ServerOptions, WebFunctionOptions } from '../index.js';

describe('WebFunctionOptions', () => {
  it('accepts cors as a boolean or an origin list', () => {
    assertType<WebFunctionOptions>({ cors: true });
    assertType<WebFunctionOptions>({ cors: ['https://app.example.com'] });
    expectTypeOf<WebFunctionOptions['cors']>().toEqualTypeOf<boolean | string[] | undefined>();
  });

  it('inherits the Server options, handleSignals and shutdownTimeoutMs included', () => {
    expectTypeOf<WebFunctionOptions>().toMatchTypeOf<ServerOptions>();
    assertType<WebFunctionOptions>({
      port: 3000,
      handleSignals: false,
      shutdownTimeoutMs: 500,
      cors: false,
    });
    expectTypeOf<WebFunctionOptions['handleSignals']>().toEqualTypeOf<boolean | undefined>();
  });

  it('rejects wrongly typed values', () => {
    // @ts-expect-error cors is not a single origin string
    assertType<WebFunctionOptions>({ cors: 'https://app.example.com' });
    // @ts-expect-error handleSignals is a boolean
    assertType<WebFunctionOptions>({ handleSignals: 'SIGTERM' });
  });
});
