import { describe, it, assertType, expectTypeOf } from 'vitest';
import {
  logRequest,
  logResponse,
  createRequestLogger,
  type LogRequestOptions,
  type RequestLogOptions,
  type LoggableRequest,
  type RouterRequest,
} from '../index.js';

describe('LogRequestOptions', () => {
  it('accepts logBody, bodyFields, paramFields and logPath', () => {
    const options: LogRequestOptions = {
      logBody: true,
      bodyFields: ['email', 'plan'],
      paramFields: ['page'],
      logPath: true,
    };
    expectTypeOf(logRequest).parameter(1).toEqualTypeOf<LogRequestOptions | undefined>();
    assertType<LogRequestOptions>(options);
  });

  it('accepts readonly field lists', () => {
    const fields = ['email'] as const;
    assertType<LogRequestOptions>({ logBody: true, bodyFields: fields, paramFields: fields });
  });

  it('rejects wrongly typed values', () => {
    // @ts-expect-error bodyFields is a list of names
    assertType<LogRequestOptions>({ logBody: true, bodyFields: 'email' });
    // @ts-expect-error logBody is a boolean
    assertType<LogRequestOptions>({ logBody: 'yes' });
    // @ts-expect-error bodyFields belongs to logRequest only, not createRequestLogger
    assertType<RequestLogOptions>({ bodyFields: ['email'] });
  });

  it('gives createRequestLogger and logResponse the logPath option', () => {
    expectTypeOf(createRequestLogger).parameter(1).toEqualTypeOf<RequestLogOptions | undefined>();
    expectTypeOf(logResponse).parameter(3).toEqualTypeOf<RequestLogOptions | undefined>();
  });
});

describe('LoggableRequest', () => {
  it('accepts a RouterRequest', () => {
    expectTypeOf<RouterRequest>().toMatchTypeOf<LoggableRequest>();
    const request = {} as RouterRequest;
    logRequest(request, { logPath: true });
  });
});
