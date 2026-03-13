import { describe, it, expect, beforeEach, vi } from 'vitest';
import RouteError from './RouteError.ts';
import { logger } from '../logger/Logger.ts';

// Type for the new error response body structure
interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

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
        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Email format is invalid');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      });

      it('should expose ConflictError messages with error codes', () => {
        const error = new ConflictError('EMAIL_TAKEN', 'Email already exists');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Conflict occurred',
          status: 409,
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Email already exists');
        expect(body.error.code).toBe('EMAIL_TAKEN');
      });

      it('should expose UserError messages with custom codes', () => {
        const error = new UserError('INVALID_INPUT', 'Username must be at least 3 characters');
        const response = RouteError.fromError(error, {
          defaultMessage: 'User error',
          status: 400,
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Username must be at least 3 characters');
        expect(body.error.code).toBe('INVALID_INPUT');
      });

      it('should support custom safe error classes', () => {
        const error = new CustomSafeError('Custom error message');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
          safeErrorClasses: ['CustomSafeError'],
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Custom error message');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('User with ID 123 not found');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Invalid credentials');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Database error');
        expect(body.error.message).not.toContain('postgresql://');
        expect(body.error.message).not.toContain('MyP@ssw0rd');
        expect(body.error.message).not.toContain('prod-db.internal');
        expect(JSON.stringify(response.body)).not.toContain('postgresql://');
      });

      it('should NOT expose AWS credentials and ARNs', () => {
        const error = new Error(
          'AccessDenied for arn:aws:iam::123456789012:user/service-account with key AKIAIOSFODNN7EXAMPLE'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'AWS error',
          status: 500,
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('AWS error');
        expect(body.error.message).not.toContain('arn:aws:iam');
        expect(body.error.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
        expect(body.error.message).not.toContain('123456789012');
        expect(JSON.stringify(response.body)).not.toContain('AKIAIOSFODNN7EXAMPLE');
      });

      it('should NOT expose file system paths', () => {
        const error = new Error("ENOENT: no such file or directory '/var/app/secrets/.env'");
        const response = RouteError.fromError(error, {
          defaultMessage: 'File error',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('File error');
        expect(body.error.message).not.toContain('/var/app/secrets/');
        expect(body.error.message).not.toContain('.env');
        expect(JSON.stringify(response.body)).not.toContain('/var/app/secrets/');
      });

      it('should NOT expose SQL queries with schema details', () => {
        const error = new Error("column 'internal_secret_field' does not exist in table 'users'");
        const response = RouteError.fromError(error, {
          defaultMessage: 'Database query error',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Database query error');
        expect(body.error.message).not.toContain('internal_secret_field');
        expect(JSON.stringify(response.body)).not.toContain('internal_secret_field');
      });

      it('should NOT expose API keys and tokens', () => {
        const error = new Error('Invalid API key: sk_live_EXAMPLE123456789');
        const response = RouteError.fromError(error, {
          defaultMessage: 'API error',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('API error');
        expect(body.error.message).not.toContain('sk_live_');
        expect(JSON.stringify(response.body)).not.toContain('sk_live_');
      });

      it('should NOT expose internal server configuration', () => {
        const error = new Error(
          'Redis connection failed: redis://localhost:6379/0 (password: secret123)'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Cache error',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Cache error');
        expect(body.error.message).not.toContain('secret123');
        expect(body.error.message).not.toContain('localhost:6379');
        expect(JSON.stringify(response.body)).not.toContain('secret123');
      });

      it('should NOT expose stack traces to clients', () => {
        const error = new Error('Internal error');
        error.stack = 'Error: Internal error\n    at MyClass.method (/var/app/src/secret.ts:42:13)';

        const response = RouteError.fromError(error, {
          defaultMessage: 'Server error',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Server error');
        expect(JSON.stringify(response.body)).not.toContain('/var/app/src/secret.ts');
        expect(JSON.stringify(response.body)).not.toContain('at MyClass.method');
      });

      it('should handle generic Error objects safely', () => {
        const error = new Error('Something went wrong with internal system');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Operation failed',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Operation failed');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Error occurred');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      });

      it('should handle object errors', () => {
        const response = RouteError.fromError(
          { message: 'Custom error object' },
          { defaultMessage: 'Error occurred' }
        );

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Error occurred');
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      });

      it('should handle null/undefined errors', () => {
        const response1 = RouteError.fromError(null, {
          defaultMessage: 'Error occurred',
        });

        const body1 = response1.body as ErrorResponseBody;
        expect(body1.success).toBe(false);
        expect(body1.error.message).toBe('Error occurred');
        expect(body1.error.code).toBe('UNKNOWN_ERROR');

        const response2 = RouteError.fromError(undefined, {
          defaultMessage: 'Error occurred',
        });

        const body2 = response2.body as ErrorResponseBody;
        expect(body2.success).toBe(false);
        expect(body2.error.message).toBe('Error occurred');
        expect(body2.error.code).toBe('UNKNOWN_ERROR');
      });
    });

    describe('HTTP Status Code Handling', () => {
      it('should default to 500 status when not provided', () => {
        const error = new Error('Test error');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        expect(response.status).toBe(500);
        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      });

      it('should use provided status code', () => {
        const error = new ValidationError('Invalid input');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
          status: 422,
        });

        expect(response.status).toBe(422);
        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Invalid input');
      });

      it('should handle various status codes correctly', () => {
        const testCases = [
          { status: 400 },
          { status: 401 },
          { status: 403 },
          { status: 404 },
          { status: 409 },
          { status: 422 },
          { status: 500 },
          { status: 502 },
          { status: 503 },
        ];

        testCases.forEach(({ status }) => {
          const error = new Error('Test');
          const response = RouteError.fromError(error, {
            defaultMessage: 'Error',
            status,
          });

          expect(response.status).toBe(status);
          const body = response.body as ErrorResponseBody;
          expect(body.success).toBe(false);
          expect(body.error.code).toBe('UNKNOWN_ERROR');
          expect(body.error.message).toBe('Error');
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

        const body = response.body as ErrorResponseBody;
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('error');
        expect(body.error).toHaveProperty('message');
        expect(body.error).toHaveProperty('code');
        expect(body.success).toBe(false);
      });

      it('should include code field for safe errors with codes', () => {
        const error = new UserError('USER_NOT_FOUND', 'User does not exist');
        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.error.code).toBe('USER_NOT_FOUND');
      });

      it('should include UNKNOWN_ERROR code for unsafe errors', () => {
        const error = new Error('Test error');
        const errorWithCode = error as Error & { code: string };
        errorWithCode.code = 'SENSITIVE_CODE';

        const response = RouteError.fromError(error, {
          defaultMessage: 'Error occurred',
        });

        const body = response.body as ErrorResponseBody;
        expect(body.error.code).toBe('UNKNOWN_ERROR');
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Service temporarily unavailable');
        expect(body.error.message).not.toContain('10.0.1.45');
      });

      it('should handle validation errors with helpful messages', () => {
        const error = new ValidationError(
          'Password must be at least 8 characters and contain a number'
        );
        const response = RouteError.fromError(error, {
          defaultMessage: 'Validation failed',
          status: 400,
        });

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe(
          'Password must be at least 8 characters and contain a number'
        );
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

        const body = response.body as ErrorResponseBody;
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Payment processing failed');
        expect(body.error.message).not.toContain('sk_test_');
      });
    });
  });
});
