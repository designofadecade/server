# RouteError

Standardized error response utility for creating secure and consistent API error responses with automatic logging and sensitive data protection.

## Overview

The `RouteError` class provides intelligent error handling with security built-in through the `fromError()` method.

The `fromError()` method automatically:
- ✅ Distinguishes between safe (ValidationError) and unsafe (system) errors
- ✅ Prevents leaking sensitive data (credentials, paths, ARNs)
- ✅ Logs full error details internally for debugging
- ✅ Provides consistent behavior in dev and production
- ✅ Returns user-friendly messages when appropriate

## Installation

```typescript
import RouteError from '@designofadecade/server/router/RouteError';
```

## API Reference

```typescript
import RouteError from '@designofadecade/server/router/RouteError';
import Routes from '@designofadecade/server/router/Routes';

class UserRoutes extends Routes {
  addRoute('/users', 'POST', async (request) => {
    try {
      const user = await usersService.create(request.body);
      return { status: 201, body: { success: true, data: user } };
    } catch (error) {
      // ✅ Automatic safe handling + logging
      return RouteError.fromError(error, {
        defaultMessage: 'Error creating user',
        status: 400,
        context: {
          userId: request.user?.id,
          endpoint: '/users'
        }
      });
    }
  });
}
```

## API Reference

### RouteError.fromError()

Creates a safe error response from an Error object with automatic security and logging.

```typescript
static fromError(
  error: unknown,
  options: FromErrorOptions
): RouterResponse
```

#### Parameters

**error** (unknown)
- The error to handle - can be Error, string, or any object
- Will be safely processed regardless of type

**options** (FromErrorOptions)
- `defaultMessage` (string, required) - Message shown for unsafe errors
- `status` (number, optional) - HTTP status code (default: 500)
- `error` (string, optional) - Error type/category (default: derived from status)
- `safeErrorClasses` (string[], optional) - Additional safe error class names
- `context` (Record<string, unknown>, optional) - Additional logging context

#### Returns

RouterResponse with:
- `status` - HTTP status code
- `headers` - JSON content type header
- `body` - JSON string with error, message, statusCode, and optionally code

#### Safe Error Classes (Default)

These error classes are considered safe and their messages will be exposed to clients:

- `ValidationError` - Input validation failures
- `ConflictError` - Resource conflicts (e.g., duplicate emails)
- `NotFoundError` - Resource not found
- `AuthenticationError` - Authentication failures
- `AuthorizationError` - Permission denied
- `UserError` - Generic user-facing errors
- `BadRequestError` - Malformed requests
- `ForbiddenError` - Access forbidden

**All other error types are considered unsafe** and their messages are hidden behind `defaultMessage`.

#### Example: Basic Usage

```typescript
try {
  const result = await dangerousOperation();
  return { status: 200, body: result };
} catch (error) {
  return RouteError.fromError(error, {
    defaultMessage: 'Operation failed',
    status: 500
  });
}
```

#### Example: Safe Error (Shown to Client)

```typescript
// Service throws ValidationError
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

throw new ValidationError('Email format is invalid');

// Client receives:
{
  "error": "Bad Request",
  "message": "Email format is invalid",  // ✅ Message shown
  "statusCode": 400
}

// Server logs:
// Full error details with context, stack trace, etc.
```

#### Example: Unsafe Error (Protected)

```typescript
// Database throws:
throw new Error('Connection failed: postgresql://admin:password@host/db');

// Client receives:
{
  "error": "Internal Server Error",
  "message": "Database error",  // ✅ Generic message
  "statusCode": 500
}

// Server logs:
// Full error: "Connection failed: postgresql://admin:password@host/db"
// Stack trace, context, etc.
```

#### Example: With Custom Safe Errors

```typescript
// Define custom error class
class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

// Use with custom safe class
try {
  await processPayment(data);
} catch (error) {
  return RouteError.fromError(error, {
    defaultMessage: 'Payment processing failed',
    status: 402,
    safeErrorClasses: ['PaymentError'], // Add to safe list
    context: { orderId: '12345' }
  });
}
```

#### Example: With Error Codes

```typescript
// Define error with code
class ConflictError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

throw new ConflictError('EMAIL_TAKEN', 'Email already exists');

// Client receives:
{
  "error": "Conflict",
  "message": "Email already exists",
  "code": "EMAIL_TAKEN",  // ✅ Code included for safe errors
  "statusCode": 409
}
```

## Security Features

### What fromError() Protects Against

The `fromError()` method automatically prevents exposure of:

1. **Database Credentials**
   ```typescript
   // ERROR: "Connection failed: postgresql://admin:MyP@ssw0rd@prod-db:5432/app"
   // CLIENT SEES: "Database error"
   ```

2. **AWS Credentials & ARNs**
   ```typescript
   // ERROR: "AccessDenied for arn:aws:iam::123456789012:user/service-account"
   // CLIENT SEES: "Service error"
   ```

3. **File System Paths**
   ```typescript
   // ERROR: "ENOENT: no such file or directory '/var/app/secrets/.env'"
   // CLIENT SEES: "File operation failed"
   ```

4. **SQL Schema Details**
   ```typescript
   // ERROR: "column 'internal_secret_field' does not exist in table 'users'"
   // CLIENT SEES: "Database query failed"
   ```

5. **API Keys & Tokens**
   ```typescript
   // ERROR: "Invalid API key: sk_live_EXAMPLE123456789"
   // CLIENT SEES: "API error"
   ```

6. **Stack Traces**
   - Never exposed in response body
   - Always logged internally for debugging

### Defense in Depth

Unlike traditional error handling that relies on `NODE_ENV`, `fromError()` provides security by default:
- Safe errors always show messages (dev AND prod)
- Unsafe errors never show messages (dev AND prod)
- Works correctly regardless of environment configuration

## Logging Integration

All errors handled by `fromError()` are automatically logged with full details:

```typescript
// What gets logged (never shown to client):
{
  source: 'RouteError.fromError',
  code: 'ROUTE_ERROR',
  isSafeError: false,
  errorName: 'Error',
  errorMessage: 'Full error message with sensitive data',
  stack: '... full stack trace ...',
  status: 500,
  defaultMessage: 'Error occurred',
  // Plus any context you provided
  userId: '123',
  endpoint: '/users',
  method: 'POST'
}
```

This allows developers to debug issues while keeping clients safe.

## Response Format

```typescript
{
  "error": "Error Type",        // HTTP error category
  "message": "Error message",   // Safe message or defaultMessage
  "code": "ERROR_CODE",         // Optional: For safe errors with codes
  "statusCode": 400             // HTTP status code
}
```

## Best Practices

### 1. Always Use fromError() for Exception Handling

```typescript
// ✅ Good - Secure and simple
try {
  await operation();
} catch (error) {
  return RouteError.fromError(error, {
    defaultMessage: 'Operation failed'
  });
}

// ❌ Bad - Manual checking, security gaps
try {
  await operation();
} catch (error) {
  // Risky: Might expose sensitive data
  logger.error('Failed:', error);
  return { status: 500, body: { error: 'Server Error' } };
}
```

### 2. Provide Helpful Default Messages

```typescript
// ✅ Good - Tells user what failed
return RouteError.fromError(error, {
  defaultMessage: 'Error creating user account'
});

// ❌ Bad - Too generic
return RouteError.fromError(error, {
  defaultMessage: 'An error occurred'
});
```

### 3. Include Context for Debugging

```typescript
return RouteError.fromError(error, {
  defaultMessage: 'Error processing payment',
  context: {
    userId: request.user.id,
    orderId: order.id,
    amount: payment.amount,
    provider: 'stripe'
  }
});

// Logs will include all context for debugging
```

### 4. Use Appropriate Status Codes

```typescript
// Validation errors
return RouteError.fromError(error, {
  defaultMessage: 'Invalid input',
  status: 400  // Bad Request
});

// Not found
return RouteError.fromError(error, {
  defaultMessage: 'Resource not found',
  status: 404  // Not Found
});

// Server errors (default)
return RouteError.fromError(error, {
  defaultMessage: 'Server error'
  // status: 500 (default)
});
```

### 5. Define Application-Specific Safe Errors

```typescript
// Define once in your application
class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

class OrderError extends DomainError {}
class PaymentError extends DomainError {}

// Use everywhere
throw new OrderError('ORDER_CANCELLED', 'Order was cancelled by user');

// Handle with fromError
return RouteError.fromError(error, {
  defaultMessage: 'Order processing failed',
  safeErrorClasses: ['DomainError', 'OrderError', 'PaymentError']
});
```

## Common Patterns

### REST API Error Handling

```typescript
class UserRoutes extends Routes {
  addRoute('/users/:id', 'GET', async (request) => {
    try {
      const user = await this.getUserById(request.params.id);
      if (!user) {
        // Throw safe error for not found
        throw new NotFoundError('User not found');
      }
      return { status: 200, body: user };
    } catch (error) {
      // fromError handles both NotFoundError and unexpected errors
      return RouteError.fromError(error, {
        defaultMessage: 'Error retrieving user',
        status: error.name === 'NotFoundError' ? 404 : 500,
        context: { userId: request.params.id }
      });
    }
  });
}
```

### Validation Error Handling

```typescript
class ValidationError extends Error {
  fields: Record<string, string>;
  
  constructor(fields: Record<string, string>) {
    super(Object.values(fields).join(', '));
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

// In route handler
try {
  const errors = validateInput(request.body);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
  // ... process valid input
} catch (error) {
  return RouteError.fromError(error, {
    defaultMessage: 'Validation failed',
    status: 400
  });
}
```

### Database Error Handling

```typescript
try {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return { status: 200, body: result };
} catch (error) {
  // Database errors often contain sensitive information
  // fromError() automatically hides connection strings, passwords, etc.
  return RouteError.fromError(error, {
    defaultMessage: 'Database query failed',
    status: 500,
    context: {
      operation: 'getUserById',
      userId: id
    }
  });
}
```

### Third-Party API Error Handling

```typescript
try {
  const response = await stripe.charges.create({
    amount: 1000,
    currency: 'usd',
    source: 'tok_visa'
  });
  return { status: 200, body: response };
} catch (error) {
  // Stripe errors may contain API keys or sensitive account info
  // fromError() protects against leaking this data
  return RouteError.fromError(error, {
    defaultMessage: 'Payment processing failed',
    status: 402,
    context: {
      provider: 'stripe',
      amount: 1000
    }
  });
}
```

## Migration Guide

### From create() to fromError()

**Before:**
```typescript
try {
  const result = await operation();
  return { status: 200, body: result };
} catch (error) {
  logger.error('Operation failed:', error);
  
  if (error.name === 'ValidationError') {
    return RouteError.create(400, 'Validation Failed', error.message);
  }
  
  // ⚠️ Risk: What if error.message contains sensitive data?
  return RouteError.create(500, 'Server Error', 'Operation failed');
}
```

**After:**
```typescript
try {
  const result = await operation();
  return { status: 200, body: result };
} catch (error) {
  // ✅ Automatic logging + security
  return RouteError.fromError(error, {
    defaultMessage: 'Operation failed',
    status: 400,
    context: { operation: 'operationName' }
  });
}
```

Benefits:
- No manual logging needed
- No manual safe/unsafe error checking
- No risk of exposing sensitive data
- Cleaner, more maintainable code

## Error Handling Flow

```
User Request
    ↓
Route Handler
    ↓
Try/Catch Block
    ↓
Error Thrown
    ↓
RouteError.fromError()
    ↓
┌────────────────────┐
│  Check Error Type  │
└─────────┬──────────┘
          │
    ┌─────┴─────┐
    │           │
Safe Error   Unsafe Error
    │           │
    ├──→ Show message
    │           │
    │      Hide message
    │           │
    └─────┬─────┘
          │
    Log Full Details
          │
    Return to Client
```

## Performance

- Minimal overhead: Simple error type checking
- No regex or complex parsing
- Efficient JSON serialization
- Negligible impact on response time

## TypeScript Support

Full TypeScript definitions included:

```typescript
interface FromErrorOptions {
  defaultMessage: string;
  status?: number;
  error?: string;
  safeErrorClasses?: string[];
  context?: Record<string, unknown>;
}

static fromError(
  error: unknown,
  options: FromErrorOptions
): RouterResponse
```

## Related Documentation

- [Router](./router.md) - Request routing
- [Routes](./router.md#routes-class) - Route organization
- [Logger](./logger.md) - Structured logging
- [Server](./server.md) - HTTP server

## References

- [OWASP: Error Handling and Logging](https://owasp.org/www-project-top-ten/)
- [CWE-209: Information Exposure Through Error Message](https://cwe.mitre.org/data/definitions/209.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
