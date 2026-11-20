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

      logRequest(event);

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          body: { name: 'John' },
          queryParams: { filter: 'active' },
          pathParams: { id: '123' },
        })
      );
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

      expect(() => logRequest(event)).not.toThrow();
      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ body: '[text body omitted, 12 chars]' })
      );
    });

    it('never logs a form-encoded body, which key-based redaction cannot reach', () => {
      const body = 'email=user%40example.com&password=hunter2';
      logRequest({
        requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/login' } },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ body: `[text body omitted, ${body.length} chars]` })
      );
      const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
      expect(logged).not.toContain('hunter2');
      expect(logged).not.toContain('example.com');
    });

    it('never logs a base64-encoded event body', () => {
      const body = Buffer.from('password=hunter2').toString('base64');
      logRequest({
        requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/login' } },
        headers: {},
        body,
      });

      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(body);
    });

    it('omits a body that is a bare JSON string', () => {
      logRequest({
        requestContext: { requestId: 'test-id', http: { method: 'POST', path: '/x' } },
        headers: {},
        body: '"hunter2"',
      });

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

  it('logs the parsed body, query and params', () => {
    logRequest(request);
    expect(logger.info).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({
        body: { name: 'John' },
        queryParams: { q: '1' },
        pathParams: { id: '7' },
      })
    );
  });

  it('omits a string body the router left unparsed (non-JSON content type)', () => {
    const body = 'username=demo&pass=hunter2';
    logRequest({
      ...request,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
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
