import { describe, it, assertType, expectTypeOf } from 'vitest';
import RouteError from './RouteError.js';
import type { RouterResponse } from './Router.js';
import type { RouteErrorResponse } from './RouteError.js';

/**
 * `fromError` populates `status` unconditionally (it destructures with a
 * `= 500` default), so its return type must not widen it back to
 * `number | undefined`. A consumer whose handler signature requires
 * `status: number` otherwise gets TS2322 on every `return RouteError.fromError(...)`.
 */
describe('RouteError.fromError return type', () => {
  it('guarantees status is present', () => {
    expectTypeOf(
      RouteError.fromError(new Error('x'), { defaultMessage: 'm' }).status
    ).toEqualTypeOf<number>();
  });

  it('is assignable to a handler signature that requires status', () => {
    interface HandlerResponse {
      status: number;
      headers?: Record<string, string>;
      body?: unknown;
    }
    assertType<HandlerResponse>(
      RouteError.fromError(new Error('x'), { defaultMessage: 'm', status: 400 })
    );
  });

  it('guarantees headers is present', () => {
    expectTypeOf(
      RouteError.fromError(new Error('x'), { defaultMessage: 'm' }).headers
    ).toEqualTypeOf<Record<string, string>>();
  });

  /**
   * `fromError` assigns `body` unconditionally, exactly as it does `status` and
   * `headers`, so leaving it optional understates the guarantee in the same way.
   * A consumer whose handler type declares `body` required got TS2322 one field
   * over: "Property 'body' is optional in type 'RouteErrorResponse' but
   * required in type 'RouteResponse'".
   */
  it('guarantees body is present', () => {
    expectTypeOf(
      RouteError.fromError(new Error('x'), { defaultMessage: 'm' }).body
    ).toEqualTypeOf<unknown>();
  });

  it('is assignable to a handler signature that requires body', () => {
    interface HandlerResponse {
      status: number;
      headers?: Record<string, string>;
      body: unknown;
    }
    assertType<HandlerResponse>(RouteError.fromError(new Error('x'), { defaultMessage: 'm' }));
  });

  it('stays assignable to the wider RouterResponse handlers return', () => {
    assertType<RouterResponse>(RouteError.fromError(new Error('x'), { defaultMessage: 'm' }));
  });

  it('exports the narrowed response type', () => {
    expectTypeOf<RouteErrorResponse>().toExtend<RouterResponse>();
  });
});
