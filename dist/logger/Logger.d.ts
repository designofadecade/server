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
export declare enum LogLevel {
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
export declare class Logger {
  private readonly level;
  private readonly sensitiveKeys;
  private isColdStart;
  private readonly maxLogSize;
  /**
   * Creates a new Logger instance
   * Reads LOG_LEVEL from environment variable (defaults to INFO)
   */
  constructor();
  /**
   * Determines if a message at the given level should be logged
   *
   * @param level - The log level to check
   * @returns True if the message should be logged
   * @private
   */
  private shouldLog;
  /**
   * Serializes an Error object for CloudWatch
   * Extracts message, name, and stack trace for better CloudWatch Insights queries
   *
   * @param error - The error to serialize
   * @returns Serialized error object
   * @private
   */
  private serializeError;
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
  private redactSensitiveData;
  /**
   * Processes context to handle special types (Errors) for CloudWatch compatibility
   *
   * @param context - The context object to process
   * @returns Processed context
   * @private
   */
  private processContext;
  /**
   * Safely stringifies an object, handling BigInt, circular refs, and other edge cases
   *
   * @param obj - The object to stringify
   * @returns JSON string
   * @private
   */
  private safeStringify;
  /**
   * Outputs a structured log entry to stdout optimized for CloudWatch Logs
   * Handles CloudWatch's 256KB log size limit
   *
   * @param level - The log level string
   * @param message - The log message
   * @param context - Additional context data to include in the log entry
   * @private
   */
  private log;
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
  error(message: string, context?: LogContext): void;
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
  warn(message: string, context?: LogContext): void;
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
  info(message: string, context?: LogContext): void;
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
  debug(message: string, context?: LogContext): void;
  /**
   * Gets the current log level
   *
   * @returns The current log level
   */
  getLevel(): LogLevel;
  /**
   * Gets the current log level as a string
   *
   * @returns The current log level string
   */
  getLevelString(): LogLevelString;
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
  performance(operation: string, durationMs: number, context?: LogContext): void;
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
  startTimer(): {
    /**
     * Ends the timer and logs performance
     * @param operation - Name of the operation
     * @param context - Additional context
     */
    end: (operation: string, context?: LogContext) => void;
  };
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
export declare const logger: Logger;
/**
 * Default export for convenience
 */
export default logger;
//# sourceMappingURL=Logger.d.ts.map
