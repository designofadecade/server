import { describe, it, expect, beforeEach, vi } from 'vitest';
import RouteError from './RouteError.ts';
import { logger } from '../logger/Logger.ts';

// Mock the logger
vi.mock('../logger/Logger.ts', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Custom error classes for testing
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class ConflictError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

class UserError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

class CustomSafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomSafeError';
  }
}

describe('RouteError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fromError()', () => {
    describe('Safe Errors', () => {
      it('should expose ValidationError messages', () => {
        const error = new ValidationError('Email format is invalid');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
          status: 400,
        });

        expect(response.status).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.message).toBe('Email format is invalid');
        expect(body.error).toBe('Bad Request');
        expect(body.statusCode).toBe(400);
      });

      it('should expose ConflictError messages with error codes', () => {
        const error = new ConflictError('EMAIL_TAKEN', 'Email already exists');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Conflict occurred',
          status: 409,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Email already exists');
        expect(body.code).toBe('EMAIL_TAKEN');
        expect(body.error).toBe('Conflict');
      });

      it('should expose UserError messages with custom codes', () => {
        const error = new UserError('INVALID_INPUT', 'Username must be at least 3 characters');
        const response = RouteError.fromError(error, {
          defaultMessage: 'User error',
          status: 400,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Username must be at least 3 characters');
        expect(body.code).toBe('INVALID_INPUT');
      });

      it('should support custom safe error classes', () => {
        const error = new CustomSafeError('Custom error message');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
          safeErrorClasses: ['CustomSafeError'],
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Custom error message');
      });

      it('should expose NotFoundError messages', () => {
        class NotFoundError extends Error {
          constructor(message: string) {
            super(message);
            this.name = 'NotFoundError';
          }
        }

        const error = new NotFoundError('User with ID 123 not found');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Resource not found',
          status: 404,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('User with ID 123 not found');
        expect(body.error).toBe('Not Found');
      });

      it('should expose AuthenticationError messages', () => {
        class AuthenticationError extends Error {
          constructor(message: string) {
            super(message);
            this.name = 'AuthenticationError';
          }
        }

        const error = new AuthenticationError('Invalid credentials');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Authentication failed',
          status: 401,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Invalid credentials');
        expect(body.error).toBe('Unauthorized');
      });
    });

    describe('Unsafe Errors - Security Tests', () => {
      it('should NOT expose database connection strings', () => {
        const error = new Error(
          'Connection failed: postgresql://admin:MyP@ssw0rd@prod-db.internal:5432/app'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Database error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Database error');
        expect(body.message).not.toContain('postgresql://');
        expect(body.message).not.toContain('MyP@ssw0rd');
        expect(body.message).not.toContain('prod-db.internal');
        expect(response.body).not.toContain('postgresql://');
      });

      it('should NOT expose AWS credentials and ARNs', () => {
        const error = new Error(
          'AccessDenied for arn:aws:iam::123456789012:user/service-account with key AKIAIOSFODNN7EXAMPLE'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'AWS error',
          status: 500,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('AWS error');
        expect(body.message).not.toContain('arn:aws:iam');
        expect(body.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
        expect(body.message).not.toContain('123456789012');
        expect(response.body).not.toContain('AKIAIOSFODNN7EXAMPLE');
      });

      it('should NOT expose file system paths', () => {
        const error = new Error("ENOENT: no such file or directory '/var/app/secrets/.env'");
        const response = RouteError.fromError(error, {
          defaultMessage: 'File error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('File error');
        expect(body.message).not.toContain('/var/app/secrets/');
        expect(body.message).not.toContain('.env');
        expect(response.body).not.toContain('/var/app/secrets/');
      });

      it('should NOT expose SQL queries with schema details', () => {
        const error = new Error("column 'internal_secret_field' does not exist in table 'users'");
        const response = RouteError.fromError(error, {
          defaultMessage: 'Database query error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Database query error');
        expect(body.message).not.toContain('internal_secret_field');
        expect(response.body).not.toContain('internal_secret_field');
      });

      it('should NOT expose API keys and tokens', () => {
        const error = new Error('Invalid API key: sk_live_EXAMPLE123456789');
        const response = RouteError.fromError(error, {
          defaultMessage: 'API error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('API error');
        expect(body.message).not.toContain('sk_live_');
        expect(response.body).not.toContain('sk_live_');
      });

      it('should NOT expose internal server configuration', () => {
        const error = new Error(
          'Redis connection failed: redis://localhost:6379/0 (password: secret123)'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Cache error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Cache error');
        expect(body.message).not.toContain('secret123');
        expect(body.message).not.toContain('localhost:6379');
        expect(response.body).not.toContain('secret123');
      });

      it('should NOT expose stack traces to clients', () => {
        const error = new Error('Internal error');
        error.stack = 'Error: Internal error\n    at MyClass.method (/var/app/src/secret.ts:42:13)';

        const response = RouteError.fromError(error, {
          defaultMessage: 'Server error',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Server error');
        expect(response.body).not.toContain('/var/app/src/secret.ts');
        expect(response.body).not.toContain('at MyClass.method');
      });

      it('should handle generic Error objects safely', () => {
        const error = new Error('Something went wrong with internal system');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Operation failed',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Operation failed');
        expect(body.error).toBe('Internal Server Error');
      });
    });

    describe('Error Logging', () => {
      it('should log full error details with context', () => {
        const error = new Error('Internal database error');
        RouteError.fromError(error, {
          defaultMessage: 'Operation failed',
          status: 500,
          context: {
            userId: '123',
            endpoint: '/users',
            method: 'POST',
          },
        });

        expect(logger.error).toHaveBeenCalledWith(
          'Route error occurred',
          expect.objectContaining({
            source: 'RouteError.fromError',
            code: 'ROUTE_ERROR',
            isSafeError: false,
            errorName: 'Error',
            errorMessage: 'Internal database error',
            status: 500,
            defaultMessage: 'Operation failed',
            userId: '123',
            endpoint: '/users',
            method: 'POST',
          })
        );
      });

      it('should log safe errors with isSafeError=true', () => {
        const error = new ValidationError('Invalid input');
        RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
        });

        expect(logger.error).toHaveBeenCalledWith(
          'Route error occurred',
          expect.objectContaining({
            isSafeError: true,
            errorName: 'ValidationError',
            errorMessage: 'Invalid input',
          })
        );
      });

      it('should log stack traces for debugging', () => {
        const error = new Error('Test error');
        error.stack = 'Error: Test error\n    at test.ts:10:5';

        RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        expect(logger.error).toHaveBeenCalledWith(
          'Route error occurred',
          expect.objectContaining({
            stack: expect.stringContaining('Error: Test error'),
          })
        );
      });
    });

    describe('Non-Error Objects', () => {
      it('should handle string errors', () => {
        const response = RouteError.fromError('Something went wrong', {
          defaultMessage: 'Error occurred',
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Error occurred');
        expect(body.error).toBe('Internal Server Error');
      });

      it('should handle object errors', () => {
        const response = RouteError.fromError(
          { message: 'Custom error object' },
          { defaultMessage: 'Error occurred' }
        );

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Error occurred');
      });

      it('should handle null/undefined errors', () => {
        const response1 = RouteError.fromError(null, {
          defaultMessage: 'Error occurred',
        });

        const body1 = JSON.parse(response1.body);
        expect(body1.message).toBe('Error occurred');

        const response2 = RouteError.fromError(undefined, {
          defaultMessage: 'Error occurred',
        });

        const body2 = JSON.parse(response2.body);
        expect(body2.message).toBe('Error occurred');
      });
    });

    describe('HTTP Status Code Handling', () => {
      it('should default to 500 status when not provided', () => {
        const error = new Error('Test error');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        expect(response.status).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Internal Server Error');
      });

      it('should use provided status code', () => {
        const error = new ValidationError('Invalid input');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
          status: 422,
        });

        expect(response.status).toBe(422);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Unprocessable Entity');
      });

      it('should use custom error type when provided', () => {
        const error = new Error('Test error');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Custom error',
          error: 'Custom Error Type',
        });

        const body = JSON.parse(response.body);
        expect(body.error).toBe('Custom Error Type');
      });

      it('should handle various status codes correctly', () => {
        const testCases = [
          { status: 400, expectedError: 'Bad Request' },
          { status: 401, expectedError: 'Unauthorized' },
          { status: 403, expectedError: 'Forbidden' },
          { status: 404, expectedError: 'Not Found' },
          { status: 409, expectedError: 'Conflict' },
          { status: 422, expectedError: 'Unprocessable Entity' },
          { status: 500, expectedError: 'Internal Server Error' },
          { status: 502, expectedError: 'Bad Gateway' },
          { status: 503, expectedError: 'Service Unavailable' },
        ];

        testCases.forEach(({ status, expectedError }) => {
          const error = new Error('Test');
          const response = RouteError.fromError(error, {
            defaultMessage: 'Error',
            status,
          });

          const body = JSON.parse(response.body);
          expect(body.error).toBe(expectedError);
        });
      });
    });

    describe('Response Format', () => {
      it('should return proper RouterResponse structure', () => {
        const error = new ValidationError('Test error');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        expect(response).toHaveProperty('status');
        expect(response).toHaveProperty('headers');
        expect(response).toHaveProperty('body');
        expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
      });

      it('should always include message field in response', () => {
        const error = new Error('Test error');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('error');
        expect(body).toHaveProperty('statusCode');
      });

      it('should include code field for safe errors with codes', () => {
        const error = new UserError('USER_NOT_FOUND', 'User does not exist');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        const body = JSON.parse(response.body);
        expect(body.code).toBe('USER_NOT_FOUND');
      });

      it('should NOT include code field for unsafe errors', () => {
        const error = new Error('Test error');
        const errorWithCode = error as Error & { code: string };
        errorWithCode.code = 'SENSITIVE_CODE';

        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        const body = JSON.parse(response.body);
        expect(body.code).toBeUndefined();
      });
    });

    describe('Real-world Usage Scenarios', () => {
      it('should handle database connection errors safely', () => {
        const error = new Error('connect ECONNREFUSED 10.0.1.45:5432');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Service temporarily unavailable',
          status: 503,
          context: { service: 'database' },
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Service temporarily unavailable');
        expect(body.message).not.toContain('10.0.1.45');
      });

      it('should handle validation errors with helpful messages', () => {
        const error = new ValidationError(
          'Password must be at least 8 characters and contain a number'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
          status: 400,
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Password must be at least 8 characters and contain a number');
      });

      it('should handle third-party API errors safely', () => {
        const error = new Error(
          'Stripe API error: Invalid charge amount with account sk_test_EXAMPLE'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Payment processing failed',
          status: 500,
          context: { provider: 'stripe' },
        });

        const body = JSON.parse(response.body);
        expect(body.message).toBe('Payment processing failed');
        expect(body.message).not.toContain('sk_test_');
      });
    });
  });
});
