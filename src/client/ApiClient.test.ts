import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ApiClient from './ApiClient.ts';

// Mock global fetch
global.fetch = vi.fn();

describe('ApiClient', () => {
    let client: ApiClient;
    const baseUrl = 'https://api.example.com';

    beforeEach(() => {
        client = new ApiClient(baseUrl);
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should create client with baseUrl', () => {
            const testClient = new ApiClient('https://test.com');
            expect(testClient).toBeInstanceOf(ApiClient);
        });

        it('should accept timeout option', () => {
            const testClient = new ApiClient(baseUrl, { timeout: 5000 });
            expect(testClient).toBeInstanceOf(ApiClient);
        });

        it('should accept retryAttempts option', () => {
            const testClient = new ApiClient(baseUrl, { retryAttempts: 3 });
            expect(testClient).toBeInstanceOf(ApiClient);
        });

        it('should accept retryDelay option', () => {
            const testClient = new ApiClient(baseUrl, { retryDelay: 2000 });
            expect(testClient).toBeInstanceOf(ApiClient);
        });

        it('should accept multiple options', () => {
            const testClient = new ApiClient(baseUrl, {
                timeout: 10000,
                retryAttempts: 2,
                retryDelay: 500
            });
            expect(testClient).toBeInstanceOf(ApiClient);
        });
    });

    describe('Authentication', () => {
        it('should set auth token with default Bearer type', () => {
            client.setAuthToken('test-token');
            // Token should be used in requests (tested in HTTP method tests)
            expect(client).toBeDefined();
        });

        it('should set auth token with custom type', () => {
            client.setAuthToken('test-token', 'Token');
            expect(client).toBeDefined();
        });

        it('should clear auth token', () => {
            client.setAuthToken('test-token');
            client.clearAuthToken();
            expect(client).toBeDefined();
        });
    });

    describe('Default Headers', () => {
        it('should set default headers', () => {
            client.setDefaultHeaders({
                'X-Custom-Header': 'value',
                'X-App-Version': '1.0.0'
            });
            expect(client).toBeDefined();
        });

        it('should accept empty headers object', () => {
            client.setDefaultHeaders({});
            expect(client).toBeDefined();
        });
    });

    describe('Interceptors', () => {
        it('should add request interceptor', () => {
            const interceptor = vi.fn((config) => config);
            client.addRequestInterceptor(interceptor);
            expect(client).toBeDefined();
        });

        it('should add response interceptor', () => {
            const interceptor = vi.fn((response) => response);
            client.addResponseInterceptor(interceptor);
            expect(client).toBeDefined();
        });

        it('should add multiple request interceptors', () => {
            const interceptor1 = vi.fn((config) => config);
            const interceptor2 = vi.fn((config) => config);
            client.addRequestInterceptor(interceptor1);
            client.addRequestInterceptor(interceptor2);
            expect(client).toBeDefined();
        });

        it('should add multiple response interceptors', () => {
            const interceptor1 = vi.fn((response) => response);
            const interceptor2 = vi.fn((response) => response);
            client.addResponseInterceptor(interceptor1);
            client.addResponseInterceptor(interceptor2);
            expect(client).toBeDefined();
        });
    });

    describe('GET requests', () => {
        it('should make successful GET request', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ data: 'test' })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.get('/users');

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users`,
                expect.objectContaining({
                    method: 'GET'
                })
            );
            expect(response.ok).toBe(true);
            expect(response.status).toBe(200);
            expect(response.data).toEqual({ data: 'test' });
        });

        it('should make GET request with query parameters', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ items: [] })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/users', { page: 1, limit: 10 });

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users?page=1&limit=10`,
                expect.any(Object)
            );
        });

        it('should include auth token in headers', async () => {
            client.setAuthToken('test-token');
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/protected');

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-token'
                    })
                })
            );
        });

        it('should handle custom headers', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/users', null, {
                headers: { 'X-Custom': 'value' }
            });

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Custom': 'value'
                    })
                })
            );
        });

        it('should handle non-JSON response', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'text/plain' }),
                text: async () => 'Plain text response'
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.get('/text');

            expect(response.data).toBe('Plain text response');
        });

        it('should handle error response', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ error: 'Resource not found' })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.get('/missing');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
            expect(response.error).toBe('Not Found');
        });
    });

    describe('POST requests', () => {
        it('should make successful POST request', async () => {
            const mockResponse = {
                ok: true,
                status: 201,
                statusText: 'Created',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ id: 123 })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.post('/users', { name: 'John' });

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users`,
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ name: 'John' })
                })
            );
            expect(response.status).toBe(201);
            expect(response.data).toEqual({ id: 123 });
        });

        it('should handle FormData', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ success: true })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const formData = new FormData();
            formData.append('file', 'test');

            await client.post('/upload', formData);

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    method: 'POST',
                    body: formData
                })
            );
        });

        it('should include auth token', async () => {
            client.setAuthToken('auth-token');
            const mockResponse = {
                ok: true,
                status: 201,
                statusText: 'Created',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.post('/data', { value: 'test' });

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer auth-token'
                    })
                })
            );
        });
    });

    describe('PUT requests', () => {
        it('should make successful PUT request', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ updated: true })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.put('/users/123', { name: 'Updated' });

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users/123`,
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ name: 'Updated' })
                })
            );
            expect(response.ok).toBe(true);
        });
    });

    describe('DELETE requests', () => {
        it('should make successful DELETE request', async () => {
            const mockResponse = {
                ok: true,
                status: 204,
                statusText: 'No Content',
                headers: new Headers({}),
                json: async () => null
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.delete('/users/123');

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users/123`,
                expect.objectContaining({
                    method: 'DELETE'
                })
            );
            expect(response.ok).toBe(true);
            expect(response.status).toBe(204);
        });

        it('should include auth token in DELETE request', async () => {
            client.setAuthToken('delete-token');
            const mockResponse = {
                ok: true,
                status: 204,
                statusText: 'No Content',
                headers: new Headers({}),
                json: async () => null
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.delete('/items/1');

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer delete-token'
                    })
                })
            );
        });
    });

    describe('PATCH requests', () => {
        it('should make successful PATCH request', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ patched: true })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.patch('/users/123', { status: 'active' });

            expect(fetch).toHaveBeenCalledWith(
                `${baseUrl}/users/123`,
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'active' })
                })
            );
            expect(response.ok).toBe(true);
        });
    });

    describe('Error handling', () => {
        it('should handle network errors', async () => {
            vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

            const response = await client.get('/users');

            expect(response.ok).toBe(false);
            expect(response.error).toBe('Network error');
            expect(response.statusText).toBe('Network Error');
        });

        it('should handle timeout with AbortError', async () => {
            const abortError = new Error('AbortError');
            abortError.name = 'AbortError';
            vi.mocked(fetch).mockRejectedValue(abortError);

            const response = await client.get('/slow');

            expect(response.ok).toBe(false);
            expect(response.statusText).toBe('Request Timeout');
            expect(response.error).toBe('Request timed out');
        });

        it('should handle JSON parse errors gracefully', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => { throw new Error('Invalid JSON'); }
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.get('/bad-json');

            expect(response.ok).toBe(true);
            expect(response.data).toBeNull();
        });
    });

    describe('Request interceptors', () => {
        it('should call request interceptor', async () => {
            const interceptor = vi.fn((config) => config);
            client.addRequestInterceptor(interceptor);

            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/test');

            expect(interceptor).toHaveBeenCalled();
        });

        it('should modify request through interceptor', async () => {
            const interceptor = (config: RequestInit & { signal: AbortSignal }) => {
                (config.headers as Record<string, string>)['X-Modified'] = 'true';
                return config;
            };
            client.addRequestInterceptor(interceptor);

            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/test');

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Modified': 'true'
                    })
                })
            );
        });
    });

    describe('Response interceptors', () => {
        it('should call response interceptor', async () => {
            const interceptor = vi.fn((response) => response);
            client.addResponseInterceptor(interceptor);

            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ data: 'test' })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.get('/test');

            expect(interceptor).toHaveBeenCalled();
        });

        it('should modify response through interceptor', async () => {
            const interceptor = (response: { ok: boolean; status: number | null; statusText: string; data: unknown; error: string | null; headers: Record<string, string>; modified?: boolean }) => {
                response.modified = true;
                return response;
            };
            client.addResponseInterceptor(interceptor);

            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ data: 'test' })
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const response = await client.get('/test') as { modified?: boolean };

            expect(response.modified).toBe(true);
        });

        it('should call response interceptor on error', async () => {
            const interceptor = vi.fn((response) => response);
            client.addResponseInterceptor(interceptor);

            vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

            await client.get('/test');

            expect(interceptor).toHaveBeenCalled();
        });
    });

    describe('Content-Type handling', () => {
        it('should set JSON content-type by default', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            await client.post('/data', { test: 'value' });

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        it('should not set content-type for FormData', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({})
            };
            vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

            const formData = new FormData();
            await client.post('/upload', formData);

            const fetchCall = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
            expect((fetchCall.headers as Record<string, string>)['Content-Type']).toBeUndefined();
        });
    });
});
