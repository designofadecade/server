# Logger Usage Guide

Complete guide for using the production-ready CloudWatch Logger in AWS Lambda environments.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [CloudWatch Best Practices](#cloudwatch-best-practices)
- [Security & Compliance](#security--compliance)
- [Performance Tracking](#performance-tracking)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```typescript
import { logger } from '@designofadecade/server';

// Basic logging
logger.info('Application started');
logger.error('Something went wrong', { code: 'APP_ERROR' });
```

---

## Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `LOG_LEVEL` | Log verbosity level | `INFO` | `ERROR`, `WARN`, `INFO`, `DEBUG` |
| `ENVIRONMENT` or `STAGE` | Environment name | - | `dev`, `staging`, `production` |
| `AWS_REQUEST_ID` | Lambda request ID | Auto-captured | - |
| `_X_AMZN_TRACE_ID` | X-Ray trace ID | Auto-captured | - |
| `AWS_LAMBDA_FUNCTION_NAME` | Function name | Auto-captured | - |
| `AWS_LAMBDA_FUNCTION_VERSION` | Function version | Auto-captured | - |

### Log Levels

```typescript
ERROR (0) - Critical failures requiring immediate attention
WARN  (1) - Potentially harmful situations
INFO  (2) - Application progress (default)
DEBUG (3) - Detailed diagnostic information
```

---

## Use Cases

### 1. Basic Logging

```typescript
import { logger } from '@designofadecade/server';

// Informational logging
logger.info('User registration completed', {
  source: 'UserController.register',
  userId: '12345',
  email: 'user@example.com'
});

// Warning logging
logger.warn('API rate limit approaching', {
  source: 'RateLimiter.check',
  current: 95,
  limit: 100
});

// Error logging
logger.error('Database connection failed', {
  source: 'DatabaseService.connect',
  database: 'users',
  retry: 3
});

// Debug logging (only shown when LOG_LEVEL=DEBUG)
logger.debug('Cache state', {
  source: 'CacheManager.get',
  key: 'user:123',
  hit: true,
  ttl: 3600
});
```

### 2. Error Handling with Codes (CloudWatch Alarms)

```typescript
try {
  await connectToDatabase();
} catch (err) {
  logger.error('Database connection failed', {
    code: 'DB_CONNECTION_ERROR', // Use for CloudWatch metric filters
    source: 'DatabaseService.connect',
    error: err, // Automatically serialized with message, name, stack
    host: 'db.example.com',
    port: 5432,
    retry: 3
  });
}
```

**Common Error Codes for Alarms:**
- `DB_CONNECTION_ERROR` - Database failures
- `API_TIMEOUT_ERROR` - External API timeouts
- `AUTH_FAILED` - Authentication failures
- `RATE_LIMIT_EXCEEDED` - Rate limiting
- `VALIDATION_ERROR` - Input validation failures
- `PAYMENT_PROCESSING_ERROR` - Payment gateway issues

### 3. Performance Tracking

#### Manual Timing
```typescript
const start = Date.now();
const result = await processPayment(orderId);
const duration = Date.now() - start;

logger.performance('processPayment', duration, {
  source: 'PaymentService.process',
  orderId,
  amount: result.amount,
  gateway: 'stripe'
});
```

#### Timer Helper
```typescript
const timer = logger.startTimer();

try {
  await expensiveOperation();
  timer.end('expensiveOperation', {
    source: 'DataProcessor.transform',
    recordCount: 1000,
    success: true
  });
} catch (err) {
  timer.end('expensiveOperation', {
    source: 'DataProcessor.transform',
    success: false,
    error: err
  });
}
```

### 4. API Request/Response Logging

```typescript
// API Gateway event handler
export const handler = async (event: APIGatewayProxyEvent) => {
  logger.info('API request received', {
    source: 'ApiHandler.handler',
    method: event.httpMethod,
    path: event.path,
    userAgent: event.headers['User-Agent']
  });

  const timer = logger.startTimer();

  try {
    const result = await processRequest(event);
    
    timer.end('processRequest', {
      source: 'ApiHandler.handler',
      statusCode: 200,
      path: event.path
    });

    return result;
  } catch (err) {
    logger.error('API request failed', {
      code: 'API_REQUEST_ERROR',
      source: 'ApiHandler.handler',
      path: event.path,
      method: event.httpMethod,
      error: err
    });

    timer.end('processRequest', {
      source: 'ApiHandler.handler',
      statusCode: 500,
      path: event.path
    });

    throw err;
  }
};
```

### 5. Sensitive Data Handling

```typescript
// Passwords, tokens, API keys are automatically redacted
logger.info('User authentication', {
  source: 'AuthService.login',
  username: 'john@example.com',
  password: 'secret123', // Automatically becomes [REDACTED]
  apiKey: 'sk_live_abc123', // Automatically becomes [REDACTED]
  token: 'bearer_xyz789' // Automatically becomes [REDACTED]
});

// Output: { ..., password: '[REDACTED]', apiKey: '[REDACTED]', token: '[REDACTED]' }
```

**Automatically Redacted Fields:**
- password, passwd, pwd
- token, accessToken, refreshToken, bearerToken
- apiKey, api_key
- secret, secretKey, clientSecret
- authorization, auth
- cookie, session, sessionId
- creditCard, cardNumber, cvv
- ssn, socialSecurity
- privateKey, private_key

### 6. Business Logic Tracking

```typescript
// Order processing
logger.info('Order placed', {
  source: 'OrderService.createOrder',
  orderId: 'ORD-12345',
  customerId: 'CUST-67890',
  amount: 99.99,
  items: 3,
  paymentMethod: 'credit_card'
});

// Payment processing
const paymentTimer = logger.startTimer();
try {
  const payment = await processPayment(order);
  
  paymentTimer.end('paymentProcessing', {
    source: 'PaymentService.process',
    orderId: order.id,
    amount: payment.amount,
    status: payment.status,
    gateway: 'stripe'
  });
} catch (err) {
  logger.error('Payment failed', {
    code: 'PAYMENT_PROCESSING_ERROR',
    source: 'PaymentService.process',
    orderId: order.id,
    error: err
  });
}
```

### 7. Lambda Cold Start Monitoring

```typescript
// First log after Lambda cold start automatically includes coldStart: true
export const handler = async (event) => {
  logger.info('Lambda invocation started', {
    source: 'Handler.main'
  });
  // Output on first invocation: { ..., coldStart: true, ... }
  // Output on warm invocations: { ... } (no coldStart field)
  
  // Your handler logic...
};
```

### 8. Distributed Tracing with X-Ray

```typescript
// X-Ray trace ID is automatically captured
logger.info('External API call', {
  source: 'ExternalService.callApi',
  endpoint: 'https://api.example.com/data',
  method: 'GET'
});
// Output includes: traceId: 'Root=1-67891234-abcdef...'
```

### 9. Multi-Service Correlation

```typescript
// Use consistent source naming for tracking across services
logger.info('Message published', {
  source: 'PublisherService.publish',
  topic: 'order-events',
  messageId: 'msg-123',
  correlationId: event.correlationId
});

// In consumer Lambda
logger.info('Message received', {
  source: 'ConsumerService.consume',
  topic: 'order-events',
  messageId: 'msg-123',
  correlationId: message.correlationId
});
```

### 10. Validation Errors

```typescript
function validateOrder(order: Order) {
  if (!order.customerId) {
    logger.warn('Validation failed', {
      code: 'VALIDATION_ERROR',
      source: 'OrderValidator.validate',
      field: 'customerId',
      reason: 'Customer ID is required'
    });
    throw new ValidationError('customerId is required');
  }
}
```

---

## CloudWatch Best Practices

### Creating Metric Filters

**1. Error Rate by Code**
```
Filter Pattern: { $.code = "DB_CONNECTION_ERROR" }
Metric Name: DBConnectionErrors
Metric Namespace: YourApp/Errors
```

**2. Slow Operations**
```
Filter Pattern: { $.duration > 1000 }
Metric Name: SlowOperations
Metric Namespace: YourApp/Performance
```

**3. Cold Starts**
```
Filter Pattern: { $.coldStart = true }
Metric Name: ColdStarts
Metric Namespace: YourApp/Lambda
```

### CloudWatch Insights Queries

**Find Specific Error Codes:**
```
fields @timestamp, message, code, source, error.message
| filter code = "DB_CONNECTION_ERROR"
| sort @timestamp desc
| limit 50
```

**Track Errors by Source:**
```
fields @timestamp, message, source
| filter level = "ERROR"
| stats count() as errorCount by source
| sort errorCount desc
```

**Monitor Cold Starts:**
```
fields @timestamp, message, coldStart, duration
| filter coldStart = true
| stats count() as coldStartCount by bin(5m)
```

**Track Slow Operations:**
```
fields @timestamp, message, duration, source
| filter duration > 1000
| sort duration desc
| limit 20
```

**Trace Request Flow:**
```
fields @timestamp, message, source, requestId
| filter requestId = "abc-123-xyz"
| sort @timestamp asc
```

**Performance Statistics:**
```
fields duration, source
| filter ispresent(duration)
| stats avg(duration) as avgDuration, 
        max(duration) as maxDuration,
        min(duration) as minDuration,
        count() as requestCount
  by source
| sort avgDuration desc
```

### Creating CloudWatch Alarms

**1. Error Rate Alarm**
```yaml
Metric: YourApp/Errors/DBConnectionErrors
Statistic: Sum
Period: 300 seconds (5 minutes)
Threshold: > 5
DatapointsToAlarm: 2
EvaluationPeriods: 2
```

**2. High Duration Alarm**
```yaml
Metric: YourApp/Performance/SlowOperations
Statistic: Sum
Period: 300 seconds
Threshold: > 10
DatapointsToAlarm: 1
EvaluationPeriods: 2
```

---

## Security & Compliance

### PCI DSS Compliance
```typescript
// Credit card data is automatically redacted
logger.info('Payment processed', {
  source: 'PaymentService.process',
  orderId: 'ORD-123',
  cardNumber: '4111111111111111', // [REDACTED]
  cvv: '123', // [REDACTED]
  amount: 99.99
});
```

### GDPR Compliance
```typescript
// Personal data protection
logger.info('User data accessed', {
  source: 'UserService.getUserData',
  userId: '12345',
  operation: 'read',
  // Don't log PII directly - use IDs instead
});
```

### SOC 2 Compliance
```typescript
// Credential protection
logger.info('Service authenticated', {
  source: 'ExternalService.authenticate',
  service: 'stripe',
  apiKey: 'sk_live_abc123', // [REDACTED]
  success: true
});
```

---

## Performance Tracking

### Operation Metrics
```typescript
class DatabaseService {
  async query(sql: string) {
    const timer = logger.startTimer();
    
    try {
      const result = await this.connection.query(sql);
      
      timer.end('databaseQuery', {
        source: 'DatabaseService.query',
        rowCount: result.rows.length,
        success: true
      });
      
      return result;
    } catch (err) {
      logger.error('Database query failed', {
        code: 'DB_QUERY_ERROR',
        source: 'DatabaseService.query',
        error: err
      });
      throw err;
    }
  }
}
```

### Lambda Performance Dashboard

Track these metrics in CloudWatch:
- Average duration by source
- Cold start frequency
- Error rates by code
- API response times
- External service latencies

---

## Troubleshooting

### Log Not Appearing in CloudWatch

**Check LOG_LEVEL:**
```bash
# Ensure LOG_LEVEL allows your log level
export LOG_LEVEL=DEBUG
```

**Verify Lambda Execution Role:**
- Role must have `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

### Sensitive Data Not Redacted

Add custom sensitive keys:
```typescript
// Extend Logger class if needed
// The current implementation redacts common patterns automatically
```

### Large Logs Being Truncated

```typescript
// CloudWatch has 256KB limit per log event
// Logger automatically truncates and marks with _truncated: true

// To avoid truncation:
logger.info('Processing data', {
  source: 'DataProcessor.process',
  recordCount: 1000,
  // Don't include large payloads directly
  // sampleData: largeArray // ❌ Avoid this
});
```

### Performance Impact

The logger is optimized for production:
- Zero-cost log filtering (logs below level are skipped early)
- Efficient sensitive data redaction
- WeakSet for circular reference tracking (no memory leaks)
- Max depth protection prevents stack overflow

---

## Advanced Patterns

### Creating Domain-Specific Loggers

```typescript
export class UserServiceLogger {
  private source = 'UserService';

  logUserAction(action: string, userId: string, metadata?: Record<string, unknown>) {
    logger.info(`User action: ${action}`, {
      source: `${this.source}.${action}`,
      userId,
      ...metadata
    });
  }

  logUserError(action: string, userId: string, error: Error) {
    logger.error(`User action failed: ${action}`, {
      code: `USER_${action.toUpperCase()}_ERROR`,
      source: `${this.source}.${action}`,
      userId,
      error
    });
  }
}
```

### Request Context Wrapper

```typescript
export class RequestLogger {
  constructor(private requestId: string, private userId?: string) {}

  info(message: string, context?: LogContext) {
    logger.info(message, {
      requestId: this.requestId,
      userId: this.userId,
      ...context
    });
  }

  error(message: string, code: string, error: Error, context?: LogContext) {
    logger.error(message, {
      code,
      requestId: this.requestId,
      userId: this.userId,
      error,
      ...context
    });
  }
}

// Usage
const reqLogger = new RequestLogger(event.requestId, user.id);
reqLogger.info('Processing order', { orderId: '123' });
```

---

## Production Tips

1. **Always include `source` field** - Makes debugging across services much easier
2. **Use consistent error codes** - Document your codes and use them consistently
3. **Log at correct levels** - Don't log INFO as ERROR or vice versa
4. **Include correlation IDs** - Track requests across Lambda invocations
5. **Monitor cold starts** - Set up alarms for excessive cold starts
6. **Set up CloudWatch dashboards** - Visualize your logs and metrics
7. **Use X-Ray integration** - Automatically captured for distributed tracing
8. **Test log levels** - Verify DEBUG logs in dev, INFO/WARN/ERROR in production
9. **Review sensitive fields** - Ensure no PII leaks in production logs
10. **Set up log retention** - Configure appropriate retention periods in CloudWatch

---

## Support

For issues or questions:
1. Check CloudWatch Logs for the actual log output
2. Verify LOG_LEVEL environment variable
3. Check Lambda execution role permissions
4. Review this documentation for examples

---

**Version**: 3.0.1  
**Last Updated**: 2026-02-28
