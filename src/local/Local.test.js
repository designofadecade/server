import { describe, it, expect, beforeEach, vi } from 'vitest';
import Local from './Local.ts';

describe('Local', () => {
    describe('LambdaProxyRouter', () => {
        let mockLambdaHandler;
        let localProxy;
        let mockReq;
        let mockRes;

        beforeEach(() => {
            mockLambdaHandler = vi.fn(async (event) => ({
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ success: true })
            }));

            mockReq = {
                url: 'http://localhost:3000/test',
                method: 'GET',
                headers: {
                    'content-type': 'application/json',
                    'host': 'localhost:3000'
                },
                on: vi.fn()
            };

            mockRes = {
                setHeader: vi.fn(),
                end: vi.fn(),
                statusCode: 0
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
                            path: '/test'
                        })
                    })
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
                            path: '/api/users'
                        })
                    }),
                    body: JSON.stringify(requestBody)
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
                        baz: 'qux'
                    })
                })
            );
        });

        it('should handle Lambda response with JSON body', async () => {
            const responseBody = { data: 'test' };
            mockLambdaHandler.mockResolvedValue({
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(responseBody)
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

        it('should handle Lambda response without content-type', async () => {
            mockLambdaHandler.mockResolvedValue({
                statusCode: 204,
                headers: {},
                body: null
            });

            mockReq.on.mockImplementation((event, callback) => {
                if (event === 'end') callback();
                return mockReq;
            });

            localProxy = Local.LambdaProxyRouter(mockLambdaHandler);
            await localProxy.request(mockReq, mockRes);

            expect(mockRes.statusCode).toBe(204);
        });

        it('should handle base64 encoded responses', async () => {
            mockLambdaHandler.mockResolvedValue({
                statusCode: 200,
                headers: { 'content-type': 'image/png' },
                body: Buffer.from('image data').toString('base64'),
                isBase64Encoded: true
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
                requestContext: { customField: 'value' }
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
                        customField: 'value'
                    })
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
                            method: 'PUT'
                        })
                    })
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
                            method: 'PATCH'
                        })
                    })
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
                            method: 'DELETE'
                        })
                    })
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
                    cookies: expect.any(Object)
                })
            );
        });

        it('should merge requestContext from request options', async () => {
            const globalContext = {
                requestContext: { global: 'value' }
            };

            const requestContext = {
                requestContext: { request: 'value' }
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
                        request: 'value'
                    })
                })
            );
        });
    });
});
