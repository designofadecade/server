/**
 * Request logging middleware for API routes
 * Extends the base Logger with HTTP-specific context
 *
 * @module RequestLogger
 */
import { logger } from '../logger/Logger.js';
/**
 * Creates a request-scoped logger with HTTP context
 *
 * @param {Object} request - AWS Lambda event or custom request object
 * @param {string} request.requestContext.requestId - Request ID
 * @param {string} request.httpMethod - HTTP method
 * @param {string} request.path - Request path
 * @returns {Object} Logger with request context
 */
export function createRequestLogger(event) {
    const requestContext = {
        requestId: event.requestContext?.requestId || 'unknown',
        method: event.httpMethod || event.requestContext?.http?.method,
        path: event.path || event.requestContext?.http?.path,
        sourceIp: event.requestContext?.identity?.sourceIp,
        userAgent: event.headers?.['user-agent']
    };
    return {
        info: (message, context = {}) => {
            logger.info(message, { ...requestContext, ...context });
        },
        error: (message, context = {}) => {
            logger.error(message, { ...requestContext, ...context });
        },
        warn: (message, context = {}) => {
            logger.warn(message, { ...requestContext, ...context });
        },
        debug: (message, context = {}) => {
            logger.debug(message, { ...requestContext, ...context });
        }
    };
}
/**
 * Middleware to automatically log incoming requests
 *
 * @param {Object} event - AWS Lambda event
 * @returns {void}
 */
export function logRequest(event) {
    const requestLogger = createRequestLogger(event);
    requestLogger.info('Incoming request', {
        body: event.body ? JSON.parse(event.body) : undefined,
        queryParams: event.queryStringParameters,
        pathParams: event.pathParameters
    });
}
/**
 * Middleware to log outgoing responses
 *
 * @param {Object} event - AWS Lambda event
 * @param {Object} response - API response
 * @param {number} durationMs - Request duration in milliseconds
 * @returns {void}
 */
export function logResponse(event, response, durationMs) {
    const requestLogger = createRequestLogger(event);
    const level = response.statusCode >= 400 ? 'error' : 'info';
    requestLogger[level]('Request completed', {
        statusCode: response.statusCode,
        durationMs,
        success: response.statusCode < 400
    });
}
//# sourceMappingURL=RequestLogger.js.map