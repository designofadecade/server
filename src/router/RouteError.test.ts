import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RouteError from './RouteError.ts';

describe('RouteError', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
        originalEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('create()', () => {
        it('should create error response with status and error', () => {
            const response = RouteError.create(404, 'Not Found');

            expect(response.status).toBe(404);
            expect(response.headers).toEqual({ 'Content-Type': 'application/json' });

            const body = JSON.parse(response.body);
            expect(body.error).toBe('Not Found');
            expect(body.statusCode).toBe(404);
        });

        it('should include message in development mode', () => {
            process.env.NODE_ENV = 'development';

            const response = RouteError.create(500, 'Internal Server Error', 'Database connection failed');
            const body = JSON.parse(response.body);

            expect(body.error).toBe('Internal Server Error');
            expect(body.message).toBe('Database connection failed');
            expect(body.statusCode).toBe(500);
        });

        it('should exclude message in production mode', () => {
            process.env.NODE_ENV = 'production';

            const response = RouteError.create(500, 'Internal Server Error', 'Database connection failed');
            const body = JSON.parse(response.body);

            expect(body.error).toBe('Internal Server Error');
            expect(body.message).toBeUndefined();
            expect(body.statusCode).toBe(500);
        });

        it('should exclude message when NODE_ENV is not set', () => {
            delete process.env.NODE_ENV;

            const response = RouteError.create(403, 'Forbidden', 'Access denied');
            const body = JSON.parse(response.body);

            expect(body.error).toBe('Forbidden');
            expect(body.message).toBeUndefined();
        });

        it('should work without message parameter', () => {
            process.env.NODE_ENV = 'development';

            const response = RouteError.create(400, 'Bad Request');
            const body = JSON.parse(response.body);

            expect(body.error).toBe('Bad Request');
            expect(body.message).toBeUndefined();
            expect(body.statusCode).toBe(400);
        });

        it('should handle various HTTP status codes', () => {
            const testCases = [
                { status: 400, error: 'Bad Request' },
                { status: 401, error: 'Unauthorized' },
                { status: 403, error: 'Forbidden' },
                { status: 404, error: 'Not Found' },
                { status: 500, error: 'Internal Server Error' },
                { status: 502, error: 'Bad Gateway' },
                { status: 503, error: 'Service Unavailable' }
            ];

            testCases.forEach(({ status, error }) => {
                const response = RouteError.create(status, error);
                expect(response.status).toBe(status);

                const body = JSON.parse(response.body);
                expect(body.error).toBe(error);
                expect(body.statusCode).toBe(status);
            });
        });

        it('should always return JSON content type', () => {
            const response = RouteError.create(404, 'Not Found');
            expect(response.headers?.['Content-Type']).toBe('application/json');
        });

        it('should create valid JSON in body', () => {
            const response = RouteError.create(500, 'Server Error', 'Something went wrong');

            // Should not throw when parsing
            expect(() => JSON.parse(response.body)).not.toThrow();
        });
    });
});
