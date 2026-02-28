/**
 * Structured logger for AWS Lambda with CloudWatch Logs
 *
 * @module Logger
 * @description Provides JSON-formatted logging for better CloudWatch Insights queries
 * with configurable log levels and structured context support. Automatically captures
 * AWS Lambda request IDs and properly serializes Error objects.
 *
 * Best Practices for CloudWatch Alarms:
 * - Add a `code` field to log entries (e.g., 'DB_CONNECTION_ERROR') for alarm filtering
 * - Add a `source` field to track where logs originated (e.g., 'UserService.login')
 * - Use consistent error codes across your application
 * - Create CloudWatch metric filters based on specific codes
 *
 * Features:
 * ✅ JSON-formatted logs for CloudWatch Insights
 * ✅ Automatic error serialization (message, name, stack)
 * ✅ AWS Lambda context (request ID, X-Ray trace ID, function name, version)
 * ✅ Environment metadata (stage/environment tracking)
 * ✅ Cold start detection (Lambda performance monitoring)
 * ✅ Sensitive data redaction (passwords, tokens, API keys, etc.)
 * ✅ Performance timing helpers (duration tracking)
 * ✅ Error codes for alarm creation
 * ✅ Source tracking for debugging
 *
 * @example
 * import { logger } from './Logger';
 *
 * logger.info('User action completed', {
 *   source: 'UserController.login',
 *   userId: '123',
 *   action: 'login'
 * });
 *
 * // Error objects are automatically serialized with message, name, and stack
 * // Use 'code' field for CloudWatch alarms
 * try {
 *   await riskyOperation();
 * } catch (err) {
 *   logger.error('Operation failed', {
 *     code: 'PAYMENT_PROCESSING_ERROR', // For CloudWatch alarm filtering
 *     source: 'PaymentService.processPayment', // For debugging
 *     error: err
 *   });
 * }
 *
 * // Performance timing
 * const timer = logger.startTimer();
 * await expensiveOperation();
 * timer.end('expensiveOperation', { source: 'MyService.process' });
 *
 * // Sensitive data is automatically redacted
 * logger.info('User logged in', {
 *   username: 'john',
 *   password: 'secret123' // Automatically redacted as [REDACTED]
 * });
 */

/**
 * Log level enumeration
 * Lower values indicate higher priority
 *
 * Log Level Guidelines:
 *
 * ERROR (0) - Critical failures requiring immediate attention
 * - Application crashes or unrecoverable errors
 * - Failed database connections or critical service failures
 * - Data corruption or loss scenarios
 * - Security violations or authentication failures
 * - Use when: The application cannot continue normal operation
 *
 * WARN (1) - Potentially harmful situations that don't stop execution
 * - Deprecated API usage or configuration issues
 * - Rate limiting being approached
 * - Retryable failures (e.g., temporary network issues)
 * - Resource constraints (low memory, disk space)
 * - Use when: Something unexpected happened but the app can continue
 *
 * INFO (2) - Informational messages highlighting application progress
 * - Application startup/shutdown events
 * - Successful business operations (user login, order placed)
 * - Configuration loaded successfully
 * - API request/response summaries
 * - Use when: Tracking normal application flow and important milestones
 *
 * DEBUG (3) - Detailed diagnostic information for troubleshooting
 * - Variable values and state changes
 * - Cache hits/misses
 * - Detailed request/response payloads
 * - Function entry/exit points
 * - Use when: Debugging issues in development or production
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * String representations of log levels
 */
export type LogLevelString = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * Context object that can be attached to log entries
 */
export type LogContext = Record<string, unknown>;

/**
 * Structure of a log entry output optimized for CloudWatch Insights
 */
interface LogEntry {
  timestamp: string;
  level: LogLevelString;
  message: string;
  code?: string; // Error/warning code for CloudWatch alarms and filtering
  source?: string; // Source class/module for debugging (e.g., 'UserService.login')
  requestId?: string; // AWS Lambda request ID for correlation
  traceId?: string; // AWS X-Ray trace ID for distributed tracing
  environment?: string; // Environment name (dev/staging/prod)
  functionName?: string; // AWS Lambda function name
  functionVersion?: string; // AWS Lambda function version
  coldStart?: boolean; // Lambda cold start indicator
  duration?: number; // Operation duration in milliseconds
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
  [key: string]: unknown;
}

/**
 * Mapping of string log levels to numeric values
 */
const LOG_LEVEL_MAP: Record<LogLevelString, LogLevel> = {
  ERROR: LogLevel.ERROR,
  WARN: LogLevel.WARN,
  INFO: LogLevel.INFO,
  DEBUG: LogLevel.DEBUG,
} as const;

/**
 * Structured logger class for AWS Lambda with CloudWatch Logs integration
 *
 * @class Logger
 * @description Outputs JSON-formatted logs for optimal CloudWatch Insights querying.
 * Log level can be configured via LOG_LEVEL environment variable.
 *
 * @example
 * const logger = new Logger();
 * logger.info('Processing started', { requestId: '12345' });
 * logger.error('Failed to process', { error: 'Connection timeout', retries: 3 });
 */
export class Logger {
  private readonly level: LogLevel;
  // Sensitive field patterns - more specific to avoid false positives
  private readonly sensitiveKeys = [
    'password',
    'passwd',
    'pwd',
    'token',
    'accesstoken',
    'refreshtoken',
    'bearertoken',
    'apikey',
    'api_key',
    'secret',
    'secretkey',
    'clientsecret',
    'authorization',
    'auth',
    'cookie',
    'session',
    'sessionid',
    'creditcard',
    'cardnumber',
    'cvv',
    'ccv',
    'ssn',
    'socialsecurity',
    'privatekey',
    'private_key',
  ];
  private isColdStart = true; // Track Lambda cold starts
  private readonly maxLogSize = 256000; // CloudWatch limit is 256KB per log event

  /**
   * Creates a new Logger instance
   * Reads LOG_LEVEL from environment variable (defaults to INFO)
   */
  constructor() {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevelString;
    this.level = LOG_LEVEL_MAP[envLevel] ?? LogLevel.INFO;
  }

  /**
   * Determines if a message at the given level should be logged
   *
   * @param level - The log level to check
   * @returns True if the message should be logged
   * @private
   */
  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  /**
   * Serializes an Error object for CloudWatch
   * Extracts message, name, and stack trace for better CloudWatch Insights queries
   *
   * @param error - The error to serialize
   * @returns Serialized error object
   * @private
   */
  private serializeError(error: Error): { message: string; name: string; stack?: string } {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  /**
   * Redacts sensitive data from log context for security/compliance
   * Handles circular references and prevents infinite recursion
   *
   * @param obj - The object to redact
   * @param seen - WeakSet to track visited objects (prevents circular references)
   * @param depth - Current recursion depth (prevents stack overflow)
   * @returns Redacted object
   * @private
   */
  private redactSensitiveData(obj: unknown, seen = new WeakSet(), depth = 0): unknown {
    // Prevent infinite recursion
    if (depth > 10) return '[MAX_DEPTH]';

    if (obj === null || obj === undefined) return obj;

    // Handle primitives and special types before object check
    if (typeof obj !== 'object') {
      // Handle Symbol (convert to string for JSON compatibility)
      if (typeof obj === 'symbol') {
        return obj.toString();
      }
      // Handle BigInt (convert to string for JSON compatibility)
      if (typeof obj === 'bigint') {
        return obj.toString() + 'n';
      }
      // Handle functions
      if (typeof obj === 'function') {
        return '[Function]';
      }
      return obj;
    }

    // Handle circular references
    if (seen.has(obj as object)) {
      return '[CIRCULAR]';
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactSensitiveData(item, seen, depth + 1));
    }

    // Mark this object as seen
    seen.add(obj as object);

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = this.sensitiveKeys.some((sensitive) =>
        lowerKey.includes(sensitive.toLowerCase())
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else {
        // Always recursively process values to handle BigInt, Symbol, Function, etc.
        redacted[key] = this.redactSensitiveData(value, seen, depth + 1);
      }
    }

    return redacted;
  }

  /**
   * Processes context to handle special types (Errors) for CloudWatch compatibility
   *
   * @param context - The context object to process
   * @returns Processed context
   * @private
   */
  private processContext(context?: LogContext): LogContext {
    if (!context) return {};

    const processed: LogContext = {};

    for (const [key, value] of Object.entries(context)) {
      if (value instanceof Error) {
        // Serialize Error objects properly for CloudWatch
        processed[key] = this.serializeError(value);
      } else {
        processed[key] = value;
      }
    }

    // Redact sensitive data
    return this.redactSensitiveData(processed) as LogContext;
  }

  /**
   * Safely stringifies an object, handling BigInt, circular refs, and other edge cases
   *
   * @param obj - The object to stringify
   * @returns JSON string
   * @private
   */
  private safeStringify(obj: unknown): string {
    return JSON.stringify(obj, (_key, value) => {
      // Handle BigInt (convert to string with 'n' suffix)
      if (typeof value === 'bigint') {
        return value.toString() + 'n';
      }
      // Handle Symbol (convert to string)
      if (typeof value === 'symbol') {
        return value.toString();
      }
      // Handle functions (skip them)
      if (typeof value === 'function') {
        return '[Function]';
      }
      return value;
    });
  }

  /**
   * Outputs a structured log entry to stdout optimized for CloudWatch Logs
   * Handles CloudWatch's 256KB log size limit
   *
   * @param level - The log level string
   * @param message - The log message
   * @param context - Additional context data to include in the log entry
   * @private
   */
  private log(level: LogLevelString, message: string, context?: LogContext): void {
    try {
      const processedContext = this.processContext(context);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        // AWS Lambda context
        ...(process.env.AWS_REQUEST_ID && { requestId: process.env.AWS_REQUEST_ID }),
        ...(process.env._X_AMZN_TRACE_ID && { traceId: process.env._X_AMZN_TRACE_ID }),
        ...(process.env.AWS_LAMBDA_FUNCTION_NAME && {
          functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        }),
        ...(process.env.AWS_LAMBDA_FUNCTION_VERSION && {
          functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
        }),
        // Environment metadata
        ...(process.env.ENVIRONMENT && { environment: process.env.ENVIRONMENT }),
        ...(process.env.STAGE && { environment: process.env.STAGE }),
        // Cold start tracking
        ...(this.isColdStart && level !== 'DEBUG' && { coldStart: true }),
        ...processedContext,
      };

      // Mark cold start as false after first log
      if (this.isColdStart) {
        this.isColdStart = false;
      }

      let logString = this.safeStringify(logEntry);

      // CloudWatch has a 256KB limit per log event
      if (logString.length > this.maxLogSize) {
        const truncated = {
          ...logEntry,
          _truncated: true,
          _originalSize: logString.length,
          message: logEntry.message.substring(0, 1000),
        };
        // Remove large fields if still too big
        const truncatedRecord = truncated as Record<string, unknown>;
        if (truncatedRecord.error && typeof truncatedRecord.error === 'object') {
          delete (truncatedRecord.error as Record<string, unknown>).stack;
        }
        logString = this.safeStringify(truncated);

        // If still too large, just log basic info
        if (logString.length > this.maxLogSize) {
          logString = this.safeStringify({
            timestamp: logEntry.timestamp,
            level: logEntry.level,
            message: 'Log too large to output',
            _truncated: true,
            _originalSize: logString.length,
          });
        }
      }

      console.log(logString);
    } catch (err) {
      // Fallback to plain console.log if JSON serialization fails
      try {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message,
            _error: 'Failed to serialize log entry',
            _errorMessage: err instanceof Error ? err.message : String(err),
          })
        );
      } catch {
        // Last resort fallback
        console.log(`[${level}] ${message}`);
      }
    }
  }

  /**
   * Logs an error message
   *
   * @param message - The error message
   * @param context - Additional context data (error details, stack traces, etc.)
   *
   * @example
   * // Pass Error objects directly - they'll be serialized automatically
   * try {
   *   await connectToDatabase();
   * } catch (err) {
   *   logger.error('Database connection failed', {
   *     code: 'DB_CONNECTION_ERROR', // For CloudWatch alarms
   *     source: 'DatabaseService.connect', // Track where error occurred
   *     error: err, // Error object is automatically serialized
   *     database: 'users',
   *     retry: 3
   *   });
   * }
   *
   * @example
   * // CloudWatch Alarm can filter on code field:
   * // fields @timestamp, message, code
   * // | filter code = "DB_CONNECTION_ERROR"
   */
  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.log('ERROR', message, context);
    }
  }

  /**
   * Logs a warning message
   *
   * @param message - The warning message
   * @param context - Additional context data
   *
   * @example
   * logger.warn('Rate limit approaching', {
   *   code: 'RATE_LIMIT_WARNING',
   *   source: 'ApiGateway.checkRateLimit',
   *   current: 95,
   *   limit: 100,
   *   timeWindow: '1m'
   * });
   */
  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.log('WARN', message, context);
    }
  }

  /**
   * Logs an informational message
   *
   * @param message - The info message
   * @param context - Additional context data
   *
   * @example
   * logger.info('Request processed successfully', {
   *   source: 'ApiHandler.processRequest',
   *   requestId: 'req-123',
   *   duration: 245,
   *   statusCode: 200
   * });
   */
  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.log('INFO', message, context);
    }
  }

  /**
   * Logs a debug message
   *
   * @param message - The debug message
   * @param context - Additional context data
   *
   * @example
   * logger.debug('Cache lookup', {
   *   key: 'user:123',
   *   hit: true,
   *   ttl: 3600
   * });
   */
  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.log('DEBUG', message, context);
    }
  }

  /**
   * Gets the current log level
   *
   * @returns The current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Gets the current log level as a string
   *
   * @returns The current log level string
   */
  getLevelString(): LogLevelString {
    const entry = Object.entries(LogLevel).find(([, val]) => val === this.level);
    return (entry?.[0] as LogLevelString) || 'INFO';
  }

  /**
   * Logs operation performance metrics
   * Helper method for tracking duration of operations
   *
   * @param operation - Name of the operation
   * @param durationMs - Duration in milliseconds
   * @param context - Additional context data
   *
   * @example
   * const start = Date.now();
   * await processPayment();
   * logger.performance('processPayment', Date.now() - start, {
   *   source: 'PaymentService.process',
   *   paymentId: '12345',
   *   amount: 99.99
   * });
   *
   * @example
   * // CloudWatch Insights - Track slow operations:
   * // fields @timestamp, message, duration, source
   * // | filter duration > 1000
   * // | sort duration desc
   */
  performance(operation: string, durationMs: number, context?: LogContext): void {
    this.info(`Operation completed: ${operation}`, {
      duration: durationMs,
      ...context,
    });
  }

  /**
   * Creates a performance timing wrapper
   * Returns start function that returns end function for measuring duration
   *
   * @returns Object with start method that returns end method
   *
   * @example
   * const timer = logger.startTimer();
   * await someAsyncOperation();
   * timer.end('someAsyncOperation', { source: 'MyService.method', userId: '123' });
   */
  startTimer() {
    const startTime = Date.now();
    return {
      /**
       * Ends the timer and logs performance
       * @param operation - Name of the operation
       * @param context - Additional context
       */
      end: (operation: string, context?: LogContext) => {
        this.performance(operation, Date.now() - startTime, context);
      },
    };
  }
}

/**
 * Singleton logger instance
 * Use this for all logging throughout the application
 *
 * Environment Variables:
 * - LOG_LEVEL: Set log level (ERROR, WARN, INFO, DEBUG) - defaults to INFO
 * - ENVIRONMENT or STAGE: Environment name (dev/staging/prod) - auto-included in logs
 * - AWS_REQUEST_ID: Lambda request ID - auto-captured
 * - _X_AMZN_TRACE_ID: X-Ray trace ID - auto-captured
 * - AWS_LAMBDA_FUNCTION_NAME: Function name - auto-captured
 * - AWS_LAMBDA_FUNCTION_VERSION: Function version - auto-captured
 *
 * @example
 * import { logger } from './Logger';
 *
 * logger.info('Application started', { source: 'App.main' });
 *
 * logger.error('Failed to load config', {
 *   code: 'CONFIG_LOAD_ERROR',
 *   source: 'ConfigService.load',
 *   error: err
 * });
 *
 * // Performance tracking
 * const timer = logger.startTimer();
 * await processData();
 * timer.end('processData', { source: 'DataProcessor.process', recordCount: 100 });
 *
 * // CloudWatch Insights query examples:
 *
 * // Find specific error codes:
 * // fields @timestamp, message, code, source
 * // | filter code = "DB_CONNECTION_ERROR"
 * // | sort @timestamp desc
 *
 * // Track errors by source:
 * // fields @timestamp, message, source
 * // | filter source like /UserService/
 * // | stats count() by source
 *
 * // Monitor cold starts:
 * // fields @timestamp, message, coldStart, duration
 * // | filter coldStart = true
 * // | stats count() as coldStartCount
 *
 * // Track slow operations:
 * // fields @timestamp, message, duration, source
 * // | filter duration > 1000
 * // | sort duration desc
 * // | limit 20
 */
export const logger = new Logger();

/**
 * Default export for convenience
 */
export default logger;
