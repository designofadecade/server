import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequestLogger, logRequest, logResponse } from './RequestLogger.ts';
import { logger } from '@designofadecade/logger/Logger';

vi.mock('@designofadecade/logger/Logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RequestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRequestLogger', () => {
    it('should create a logger with request context', () => {
      const event = {
        requestContext: {
          requestId: 'test-request-id',
          http: {
            method: 'GET',
            path: '/api/test',
          },
          identity: {
            sourceIp: '127.0.0.1',
          },
        },
        httpMethod: 'GET',
        path: '/api/test',
        headers: {
          'user-agent': 'test-agent',
        },
      };

      const requestLogger = createRequestLogger(event);

      expect(requestLogger).toHaveProperty('info');
      expect(requestLogger).toHaveProperty('error');
      expect(requestLogger).toHaveProperty('warn');
      expect(requestLogger).toHaveProperty('debug');
    });

    it('should handle missing requestContext', () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test message');

      expect(logger.info).toHaveBeenCalledWith(
        'test message',
        expect.objectContaining({
          requestId: 'unknown',
        })
      );
    });

    it('should extract method from httpMethod', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
        },
        httpMethod: 'POST',
        path: '/api/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should extract method from requestContext.http.method', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'PUT',
            path: '/api/test',
          },
        },
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should extract path from path property', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
        },
        path: '/api/users',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          path: '/api/users',
        })
      );
    });

    it('should extract path from requestContext.http.path', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            path: '/api/products',
          },
        },
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          path: '/api/products',
        })
      );
    });

    it('should log info messages with context', () => {
      const event = {
        requestContext: { requestId: 'test-id' },
        httpMethod: 'GET',
        path: '/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('Test message', { extra: 'data' });

      expect(logger.info).toHaveBeenCalledWith(
        'Test message',
        expect.objectContaining({
          requestId: 'test-id',
          extra: 'data',
        })
      );
    });

    it('should log error messages with context', () => {
      const event = {
        requestContext: { requestId: 'test-id' },
        httpMethod: 'GET',
        path: '/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.error('Error message', { error: 'details' });

      expect(logger.error).toHaveBeenCalledWith(
        'Error message',
        expect.objectContaining({
          requestId: 'test-id',
          error: 'details',
        })
      );
    });

    it('should log warn messages with context', () => {
      const event = {
        requestContext: { requestId: 'test-id' },
        httpMethod: 'GET',
        path: '/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.warn('Warning message', { warning: 'data' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Warning message',
        expect.objectContaining({
          requestId: 'test-id',
          warning: 'data',
        })
      );
    });

    it('should log debug messages with context', () => {
      const event = {
        requestContext: { requestId: 'test-id' },
        httpMethod: 'GET',
        path: '/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.debug('Debug message', { debug: 'info' });

      expect(logger.debug).toHaveBeenCalledWith(
        'Debug message',
        expect.objectContaining({
          requestId: 'test-id',
          debug: 'info',
        })
      );
    });

    it('should include sourceIp when available', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          identity: {
            sourceIp: '192.168.1.1',
          },
        },
        httpMethod: 'GET',
        path: '/test',
        headers: {},
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          sourceIp: '192.168.1.1',
        })
      );
    });

    it('should include userAgent when available', () => {
      const event = {
        requestContext: { requestId: 'test-id' },
        httpMethod: 'GET',
        path: '/test',
        headers: {
          'user-agent': 'Mozilla/5.0',
        },
      };

      const requestLogger = createRequestLogger(event);
      requestLogger.info('test');

      expect(logger.info).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          userAgent: 'Mozilla/5.0',
        })
      );
    });
  });

  describe('client-controlled field caps', () => {
    const ctx = () => (logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];

    it('cuts a long user agent at 256 characters', () => {
      createRequestLogger({
        requestContext: { requestId: 'id' },
        httpMethod: 'GET',
        path: '/x',
        headers: { 'user-agent': 'U'.repeat(10_000) },
      }).info('t');
      expect(ctx().userAgent).toBe(`${'U'.repeat(256)}…[truncated, 10000 chars]`);
    });

    it('cuts a long event path at 256 characters', () => {
      createRequestLogger({
        requestContext: { requestId: 'id', http: { method: 'GET', path: `/${'p'.repeat(999)}` } },
      }).info('t');
      expect(ctx().path).toBe(`/${'p'.repeat(255)}…[truncated, 1000 chars]`);
    });

    it('cuts a long RouterRequest path and joined user agent', () => {
      logRequest({
        method: 'GET',
        path: `/${'r'.repeat(300)}`,
        headers: { 'user-agent': ['a'.repeat(200), 'b'.repeat(200)] },
      });
      expect(ctx().path).toHaveLength(256 + '…[truncated, 301 chars]'.length);
      expect(ctx().userAgent).toMatch(/^a{200}, b{54}…\[truncated, 402 chars\]$/);
    });

    it('leaves short values untouched', () => {
      logRequest({ method: 'GET', path: '/ok', headers: { 'user-agent': 'curl/8' } });
      expect(ctx()).toMatchObject({ path: '/ok', userAgent: 'curl/8' });
    });
  });

  describe('logRequest', () => {
    it('should log incoming request', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'POST',
            path: '/api/users',
          },
        },
        body: JSON.stringify({ name: 'John' }),
        queryStringParameters: { filter: 'active' },
        pathParameters: { id: '123' },
        headers: {},
      };

      logRequest(event, { logBody: true, bodyFields: ['name'], paramFields: ['filter', 'id'] });

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          body: { name: 'John' },
          queryParams: { filter: 'active' },
          pathParams: { id: '123' },
        })
      );
    });

    it('logs only parameter names by default', () => {
      logRequest({
        requestContext: { requestId: 'test-id', http: { method: 'GET', path: '/api/users' } },
        queryStringParameters: { email: 'ana@example.test', page: '2' },
        pathParameters: { id: '123' },
        headers: {},
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ queryParams: ['email', 'page'], pathParams: ['id'] })
      );
      const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
      expect(logged).not.toContain('ana@example.test');
      expect(logged).not.toContain('123');
    });

    it('should handle request without body', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'GET',
            path: '/api/users',
          },
        },
        queryStringParameters: {},
        headers: {},
      };

      logRequest(event);

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          body: undefined,
        })
      );
    });

    it('omits a non-JSON body, keeping only its length, instead of throwing', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'POST',
            path: '/api/users',
          },
        },
        body: 'invalid json',
        headers: {},
      };

      expect(() => logRequest(event, { logBody: true, bodyFields: ['name'] })).not.toThrow();
      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ body: '[text body omitted, 12 chars]' })
      );
    });

    it('never logs a form-encoded body, which key-based redaction cannot reach', () => {
      const body = 'email=user%40example.com&password=hunter2';
      const event = {
        requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/login' } },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      };
      logRequest(event, { logBody: true, bodyFields: ['name'] });

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ body: `[text body omitted, ${body.length} chars]` })
      );
      logRequest(event);
      const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
      expect(logged).not.toContain('hunter2');
      expect(logged).not.toContain('example.com');
    });

    it('never logs a base64-encoded event body', () => {
      const body = Buffer.from('password=hunter2').toString('base64');
      const event = {
        requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/login' } },
        headers: {},
        body,
      };
      logRequest(event);
      logRequest(event, { logBody: true, bodyFields: ['name'] });

      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(body);
    });

    it('omits a body that is a bare JSON string', () => {
      logRequest(
        {
          requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/x' } },
          headers: {},
          body: '"hunter2"',
        },
        { logBody: true, bodyFields: ['name'] }
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ body: '[text body omitted, 9 chars]' })
      );
    });
  });

  describe('logResponse', () => {
    it('should log successful response as info', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'GET',
            path: '/api/users',
          },
        },
        headers: {},
      };

      const response = {
        statusCode: 200,
      };

      logResponse(event, response, 123);

      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          statusCode: 200,
          durationMs: 123,
          success: true,
        })
      );
    });

    it('should log client error as error level', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'GET',
            path: '/api/users',
          },
        },
        headers: {},
      };

      const response = {
        statusCode: 404,
      };

      logResponse(event, response, 50);

      expect(logger.error).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          statusCode: 404,
          durationMs: 50,
          success: false,
        })
      );
    });

    it('should log server error as error level', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'POST',
            path: '/api/users',
          },
        },
        headers: {},
      };

      const response = {
        statusCode: 500,
      };

      logResponse(event, response, 200);

      expect(logger.error).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          statusCode: 500,
          durationMs: 200,
          success: false,
        })
      );
    });

    it('should handle 3xx responses as success', () => {
      const event = {
        requestContext: {
          requestId: 'test-id',
          http: {
            method: 'GET',
            path: '/api/redirect',
          },
        },
        headers: {},
      };

      const response = {
        statusCode: 301,
      };

      logResponse(event, response, 25);

      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          statusCode: 301,
          success: true,
        })
      );
    });
  });
});

describe('RequestLogger with a RouterRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  const request = {
    method: 'POST',
    path: '/api/users',
    headers: { 'user-agent': ['a', 'b'] },
    clientIp: '203.0.113.5',
    requestId: 'req-9',
    body: { name: 'John' },
    query: { q: '1' },
    params: { id: '7' },
  };

  it('takes identity from the RouterRequest', () => {
    createRequestLogger(request).info('test');
    expect(logger.info).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({
        requestId: 'req-9',
        method: 'POST',
        path: '/api/users',
        sourceIp: '203.0.113.5',
        userAgent: 'a, b',
      })
    );
  });

  it('logs a body summary, query and params by default', () => {
    logRequest(request);
    expect(logger.info).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({
        body: { contentType: undefined, fields: 1 },
        queryParams: ['q'],
        pathParams: ['id'],
      })
    );
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('John');
  });

  it('logs the parsed body when opted in', () => {
    logRequest(request, { logBody: true, bodyFields: ['name'] });
    expect(logger.info).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({ body: { name: 'John' } })
    );
  });

  it('omits a string body the router left unparsed (non-JSON content type)', () => {
    const body = 'username=demo&pass=hunter2';
    logRequest(
      {
        ...request,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      { logBody: true, bodyFields: ['name'] }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({ body: `[text body omitted, ${body.length} chars]` })
    );
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('hunter2');
  });

  it('reads status from a RouterResponse, defaulting to 200', () => {
    logResponse(request, { status: 404 }, 5);
    expect(logger.error).toHaveBeenCalledWith(
      'Request completed',
      expect.objectContaining({ statusCode: 404, success: false })
    );
    logResponse(request, {}, 5);
    expect(logger.info).toHaveBeenCalledWith(
      'Request completed',
      expect.objectContaining({ statusCode: 200, success: true })
    );
  });

  it('treats a minimal { method, path, headers } object as a RouterRequest', () => {
    createRequestLogger({ method: 'GET', path: '/x', headers: {} }).info('test');
    expect(logger.info).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ method: 'GET', path: '/x', requestId: 'unknown' })
    );
  });

  it('reads the format 2.0 sourceIp from a raw event', () => {
    createRequestLogger({
      requestContext: {
        requestId: 'r',
        http: { method: 'GET', path: '/', sourceIp: '198.51.100.1' },
      },
      headers: { 'x-forwarded-for': '6.6.6.6' },
    }).info('test');
    expect(logger.info).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ sourceIp: '198.51.100.1' })
    );
  });
});

describe('logRequest body logging options', () => {
  beforeEach(() => vi.clearAllMocks());

  const loggedBody = () =>
    (vi.mocked(logger.info).mock.calls[0][1] as Record<string, unknown>).body;

  const event = (body: unknown, contentType = 'application/json') => ({
    method: 'POST',
    path: '/patients',
    headers: { 'content-type': contentType },
    body,
  });

  const patient = {
    name: 'Ana',
    ssn: '123-45-6789',
    dob: '1990-01-01',
    cardNumber: '4111111111111111',
    diagnosis: 'private',
  };

  it('logs no body content by default, only content type and size', () => {
    const raw = JSON.stringify(patient);
    logRequest({
      requestContext: { requestId: 'r', http: { method: 'POST', path: '/patients' } },
      headers: { 'content-type': 'application/json' },
      body: raw,
    });

    expect(loggedBody()).toEqual({
      contentType: 'application/json',
      bytes: Buffer.byteLength(raw),
    });
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    for (const value of ['Ana', '1990-01-01', 'private', '123-45-6789']) {
      expect(logged).not.toContain(value);
    }
  });

  it('summarises a parsed array body by item count', () => {
    logRequest(event([1, 2, 3]));
    expect(loggedBody()).toEqual({ contentType: 'application/json', items: 3 });
  });

  it('counts bytes, not characters, for a raw body', () => {
    logRequest({ ...event('é'), headers: { 'content-type': 'text/plain' } });
    expect(loggedBody()).toEqual({ contentType: 'text/plain', bytes: 2 });
  });

  it('truncates a long Content-Type in the summary', () => {
    logRequest(event({ a: 1 }, 'application/json;' + 'x'.repeat(500)));
    expect((loggedBody() as { contentType: string }).contentType).toHaveLength(100);
  });

  it('logs only the summary when logBody has no (or an empty) bodyFields allowlist', () => {
    logRequest(event(patient), { logBody: true });
    logRequest(event(patient), { logBody: true, bodyFields: [] });
    for (const call of vi.mocked(logger.info).mock.calls) {
      expect((call[1] as Record<string, unknown>).body).toEqual({
        contentType: 'application/json',
        fields: 5,
      });
    }
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('Ana');
  });

  it('warns once, not per request, when logBody lacks bodyFields', async () => {
    vi.resetModules();
    const fresh = await import('./RequestLogger.ts');
    const { logger: freshLogger } = await import('@designofadecade/logger/Logger');
    vi.mocked(freshLogger.warn).mockClear();

    expect(() => {
      fresh.logRequest(event(patient), { logBody: true });
      fresh.logRequest(event(patient), { logBody: true });
    }).not.toThrow();

    expect(freshLogger.warn).toHaveBeenCalledTimes(1);
    expect(freshLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'REQUEST_LOGGER_BODY_FIELDS_REQUIRED' })
    );
  });

  it('logs allowlisted parameter values, redacting the rest and sensitive names', () => {
    logRequest(
      {
        ...event(undefined),
        query: { page: '2', email: 'ana@example.test', token: 't-1', q: 'x'.repeat(400) },
        params: { id: '7', slug: 'private-slug' },
      },
      { paramFields: ['page', 'id', 'token', 'q'] }
    );
    const context = vi.mocked(logger.info).mock.calls[0][1] as Record<string, unknown>;
    expect(context.queryParams).toEqual({
      page: '2',
      email: '[REDACTED]',
      token: '[REDACTED]',
      q: expect.stringContaining('[truncated, 400 chars]'),
    });
    expect(context.pathParams).toEqual({ id: '7', slug: '[REDACTED]' });
  });

  it('bounds the number of parameter names logged', () => {
    const query = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v']));
    logRequest({ ...event(undefined), query });
    const names = (vi.mocked(logger.info).mock.calls[0][1] as { queryParams: string[] })
      .queryParams;
    expect(names).toHaveLength(51);
    expect(names[50]).toBe('…[10 more]');
  });

  it('with bodyFields, logs only the listed fields', () => {
    logRequest(event(patient), { logBody: true, bodyFields: ['name'] });
    expect(loggedBody()).toEqual({
      name: 'Ana',
      ssn: '[REDACTED]',
      dob: '[REDACTED]',
      cardNumber: '[REDACTED]',
      diagnosis: '[REDACTED]',
    });
  });

  it('ignores bodyFields unless logBody is on', () => {
    logRequest(event(patient), { bodyFields: ['name'] });
    expect(loggedBody()).toEqual({ contentType: 'application/json', fields: 5 });
  });

  it('applies the allowlist recursively through nested objects and arrays', () => {
    logRequest(
      event({
        order: {
          id: 7,
          items: [
            { sku: 'A1', qty: 2, note: 'leave at door' },
            { sku: 'B2', qty: 1 },
          ],
          shipping: { street: '1 Main St' },
        },
        tags: ['x', 'y'],
        owner: { id: 9, email: 'a@b.test' },
      }),
      { logBody: true, bodyFields: ['order', 'id', 'items', 'sku', 'qty', 'tags', 'owner'] }
    );
    expect(loggedBody()).toEqual({
      order: {
        id: 7,
        items: [
          { sku: 'A1', qty: 2, note: '[REDACTED]' },
          { sku: 'B2', qty: 1 },
        ],
        shipping: '[REDACTED]',
      },
      tags: ['x', 'y'],
      owner: { id: 9, email: '[REDACTED]' },
    });
  });

  it('redacts primitives in a top-level array, which have no field name', () => {
    logRequest(event(['secret-ish', 3]), { logBody: true, bodyFields: ['id'] });
    expect(loggedBody()).toEqual(['[REDACTED]', '[REDACTED]']);
  });

  it('keeps sensitive keys redacted even when allowlisted, at any depth', () => {
    logRequest(event({ password: 'hunter2', user: { apiKey: 'k-123', name: 'Ana' } }), {
      logBody: true,
      bodyFields: ['password', 'user', 'apiKey', 'name'],
    });
    expect(loggedBody()).toEqual({
      password: '[REDACTED]',
      user: { apiKey: '[REDACTED]', name: 'Ana' },
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('hunter2');
  });

  it('parses a raw JSON event body before applying the allowlist', () => {
    logRequest(
      {
        requestContext: { requestId: 'r', http: { method: 'POST', path: '/x' } },
        headers: {},
        body: JSON.stringify(patient),
      },
      { logBody: true, bodyFields: ['dob'] }
    );
    expect(loggedBody()).toEqual(
      expect.objectContaining({ dob: '1990-01-01', name: '[REDACTED]' })
    );
  });

  it('caps long string values', () => {
    logRequest(event({ note: 'a'.repeat(1000) }), { logBody: true, bodyFields: ['note'] });
    const note = (loggedBody() as { note: string }).note;
    expect(note.startsWith('a'.repeat(256))).toBe(true);
    expect(note).toContain('[truncated, 1000 chars]');
    expect(note.length).toBeLessThan(300);
  });

  it('stops at a depth limit', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    logRequest(event(deep), { logBody: true, bodyFields: ['n', 'leaf'] });
    expect(JSON.stringify(loggedBody())).toContain('[MAX_DEPTH]');
  });
});
