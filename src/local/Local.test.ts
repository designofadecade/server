import { describe, it, expect, beforeEach, vi } from 'vitest';
import Local from './Local.ts';

describe('Local', () => {
  describe('LambdaProxyRouter', () => {
    let mockLambdaHandler;
    let localProxy;
    let mockReq;
    let mockRes;

    beforeEach(() => {
      mockLambdaHandler = vi.fn(async (_event) => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true }),
      }));

      mockReq = {
        url: 'http://localhost:3000/test',
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          host: 'localhost:3000',
        },
        on: vi.fn(),
      };

      mockRes = {
        setHeader: vi.fn(),
        end: vi.fn(),
        statusCode: 0,
      };

      vi.clearAllMocks();
    });

    it('should create a local proxy router', () => {
      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      expect(localProxy).toHaveProperty('request');
      expect(typeof localProxy.request).toBe('function');
    });

    it('should forward GET request to Lambda handler', async () => {
      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);

      // Simulate request body handling for GET
      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPath: '/test',
          headers: expect.any(Object),
          requestContext: expect.objectContaining({
            http: expect.objectContaining({
              method: 'GET',
              path: '/test',
            }),
          }),
        })
      );
    });

    it('should forward POST request with body to Lambda handler', async () => {
      mockReq.method = 'POST';
      mockReq.url = 'http://localhost:3000/api/users';

      const requestBody = { name: 'John Doe' };

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(JSON.stringify(requestBody));
        }
        if (event === 'end') {
          callback();
        }
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPath: '/api/users',
          requestContext: expect.objectContaining({
            http: expect.objectContaining({
              method: 'POST',
              path: '/api/users',
            }),
          }),
          body: JSON.stringify(requestBody),
        })
      );
    });

    it('should parse query string parameters', async () => {
      mockReq.url = 'http://localhost:3000/test?foo=bar&baz=qux';

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          queryStringParameters: expect.objectContaining({
            foo: 'bar',
            baz: 'qux',
          }),
        })
      );
    });

    it('should handle Lambda response with JSON body', async () => {
      const responseBody = { data: 'test' };
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(responseBody),
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(responseBody));
    });

    /**
     * Payload format 2.0 lets a handler return a bare value instead of the
     * response envelope, and `APIGatewayProxyResultV2` types that. API Gateway
     * infers 200 / application/json and uses the return value as the body, so
     * local dev has to as well — otherwise the body is silently dropped and
     * local diverges from deployed for a handler AWS considers conforming.
     */
    it('should infer a response from a bare string return', async () => {
      mockLambdaHandler.mockResolvedValue('Hello from Lambda!');

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
      expect(mockRes.end).toHaveBeenCalledWith('Hello from Lambda!');
    });

    it('should infer a response from an object returned without a statusCode', async () => {
      mockLambdaHandler.mockResolvedValue({ message: 'Hello from Lambda!' });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
      // The whole return value becomes the body, exactly as API Gateway does it.
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ message: 'Hello from Lambda!' }));
    });

    /**
     * AWS types header values as `string | number | boolean`. Node's
     * `setHeader` rejects booleans outright, so they have to be collapsed to
     * strings rather than passed through.
     */
    it('should stringify non-string header values', async () => {
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'content-length': 2, 'x-cached': false },
        body: '{}',
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('content-length', '2');
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-cached', 'false');
    });

    it('should handle Lambda response without content-type', async () => {
      mockLambdaHandler.mockResolvedValue({
        statusCode: 204,
        headers: {},
        body: null,
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(204);
    });

    /**
     * Payload format 2.0 returns cookies in a top-level `cookies` array, and
     * API Gateway emits each entry as its own `set-cookie` header. Dropping
     * them meant every cookie a handler set — sessions, auth — silently
     * vanished in local dev while working deployed.
     */
    it('should emit a returned cookies array as set-cookie headers', async () => {
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        cookies: ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'],
        body: '{}',
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('set-cookie', [
        'session=abc; Path=/; HttpOnly',
        'theme=dark; Path=/',
      ]);
    });

    it('should keep a set-cookie header alongside a returned cookies array', async () => {
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'Set-Cookie': 'first=1' },
        cookies: ['second=2'],
        body: '{}',
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('set-cookie', ['first=1', 'second=2']);
    });

    /**
     * API Gateway passes a handler's body through byte for byte. Local dev
     * decoded JSON bodies and let the router re-encode them, which is a no-op
     * for compact JSON — and silently rewrote anything else. A pretty-printed
     * body came back minified, so what a developer saw locally was not what the
     * deployed API would send.
     */
    it('should pass a pretty-printed JSON body through unchanged', async () => {
      const body = JSON.stringify({ a: 1, b: [2, 3] }, null, 2);
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body,
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.end).toHaveBeenCalledWith(body);
    });

    it('should not rewrite escapes or number formatting in a JSON body', async () => {
      // A re-encode turns \u00e9 into a literal é and 1.0 into 1.
      const body = '{"name":"\u00e9","count":1.0}';
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.end).toHaveBeenCalledWith(body);
    });

    it('should handle base64 encoded responses', async () => {
      mockLambdaHandler.mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        body: Buffer.from('image data').toString('base64'),
        isBase64Encoded: true,
      });

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
    });

    it('should pass custom requestContext options', async () => {
      const customContext = {
        requestContext: { customField: 'value' },
      };

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler, customContext);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            customField: 'value',
          }),
        })
      );
    });

    it('should handle PUT requests', async () => {
      mockReq.method = 'PUT';
      mockReq.url = 'http://localhost:3000/api/users/1';

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'data') callback('{"name":"Updated"}');
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            http: expect.objectContaining({
              method: 'PUT',
            }),
          }),
        })
      );
    });

    it('should handle PATCH requests', async () => {
      mockReq.method = 'PATCH';
      mockReq.url = 'http://localhost:3000/api/users/1';

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'data') callback('{"status":"active"}');
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            http: expect.objectContaining({
              method: 'PATCH',
            }),
          }),
        })
      );
    });

    it('should handle DELETE requests', async () => {
      mockReq.method = 'DELETE';
      mockReq.url = 'http://localhost:3000/api/users/1';

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            http: expect.objectContaining({
              method: 'DELETE',
            }),
          }),
        })
      );
    });

    it('should handle cookies', async () => {
      mockReq.headers.cookie = 'session=abc123; user=john';

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
      await localProxy.request(mockReq, mockRes);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          cookies: expect.any(Object),
        })
      );
    });

    it('should merge requestContext from request options', async () => {
      const globalContext = {
        requestContext: { global: 'value' },
      };

      const requestContext = {
        requestContext: { request: 'value' },
      };

      mockReq.on.mockImplementation((event, callback) => {
        if (event === 'end') callback();
        return mockReq;
      });

      localProxy = Local.LambdaProxyRouter(mockLambdaHandler, globalContext);
      await localProxy.request(mockReq, mockRes, requestContext);

      expect(mockLambdaHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            global: 'value',
            request: 'value',
          }),
        })
      );
    });
  });
});
