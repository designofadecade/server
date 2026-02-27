/**
 * Request logging middleware for API routes
 * Extends the base Logger with HTTP-specific context
 *
 * @module RequestLogger
 */
interface RequestLoggerInterface {
  info: (message: string, context?: Record<string, any>) => void;
  error: (message: string, context?: Record<string, any>) => void;
  warn: (message: string, context?: Record<string, any>) => void;
  debug: (message: string, context?: Record<string, any>) => void;
}
interface RequestEvent {
  requestContext?: {
    requestId?: string;
    http?: {
      method: string;
      path: string;
    };
    identity?: {
      sourceIp?: string;
    };
  };
  httpMethod?: string;
  path?: string;
  headers?: Record<string, any>;
  body?: string;
  queryStringParameters?: Record<string, any>;
  pathParameters?: Record<string, any>;
}
interface ResponseObject {
  statusCode: number;
  [key: string]: any;
}
/**
 * Creates a request-scoped logger with HTTP context
 *
 * @param {Object} request - AWS Lambda event or custom request object
 * @param {string} request.requestContext.requestId - Request ID
 * @param {string} request.httpMethod - HTTP method
 * @param {string} request.path - Request path
 * @returns {Object} Logger with request context
 */
export declare function createRequestLogger(event: RequestEvent): RequestLoggerInterface;
/**
 * Middleware to automatically log incoming requests
 *
 * @param {Object} event - AWS Lambda event
 * @returns {void}
 */
export declare function logRequest(event: RequestEvent): void;
/**
 * Middleware to log outgoing responses
 *
 * @param {Object} event - AWS Lambda event
 * @param {Object} response - API response
 * @param {number} durationMs - Request duration in milliseconds
 * @returns {void}
 */
export declare function logResponse(
  event: RequestEvent,
  response: ResponseObject,
  durationMs: number
): void;
export {};
//# sourceMappingURL=RequestLogger.d.ts.map
