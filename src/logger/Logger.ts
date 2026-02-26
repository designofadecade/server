/**
 * Structured logger for AWS Lambda with CloudWatch Logs
 * 
 * @module Logger
 * @description Provides JSON-formatted logging for better CloudWatch Insights queries
 * with configurable log levels and structured context support.
 * 
 * @example
 * import { logger } from './Logger';
 * 
 * logger.info('User action completed', { userId: '123', action: 'login' });
 * logger.error('Database connection failed', { error: err.message, service: 'db' });
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
    DEBUG = 3
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
 * Structure of a log entry output
 */
interface LogEntry {
    timestamp: string;
    level: LogLevelString;
    message: string;
    [key: string]: unknown;
}

/**
 * Mapping of string log levels to numeric values
 */
const LOG_LEVEL_MAP: Record<LogLevelString, LogLevel> = {
    ERROR: LogLevel.ERROR,
    WARN: LogLevel.WARN,
    INFO: LogLevel.INFO,
    DEBUG: LogLevel.DEBUG
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
class Logger {
    private readonly level: LogLevel;

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
     * Outputs a structured log entry to stdout
     * 
     * @param level - The log level string
     * @param message - The log message
     * @param context - Additional context data to include in the log entry
     * @private
     */
    private log(level: LogLevelString, message: string, context?: LogContext): void {
        try {
            const logEntry: LogEntry = {
                timestamp: new Date().toISOString(),
                level,
                message,
                ...(context || {})
            };
            console.log(JSON.stringify(logEntry));
        } catch (err) {
            // Fallback to plain console.log if JSON serialization fails
            console.log(`[${level}] ${message}`, context);
        }
    }

    /**
     * Logs an error message
     * 
     * @param message - The error message
     * @param context - Additional context data (error details, stack traces, etc.)
     * 
     * @example
     * logger.error('Database connection failed', { 
     *   error: err.message, 
     *   database: 'users',
     *   retry: 3 
     * });
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
}

/**
 * Singleton logger instance
 * Use this for all logging throughout the application
 * 
 * @example
 * import { logger } from './Logger';
 * 
 * logger.info('Application started');
 * logger.error('Failed to load config', { error: err.message });
 */
export const logger = new Logger();

/**
 * Default export for convenience
 */
export default logger;
