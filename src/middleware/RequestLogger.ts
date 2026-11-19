/**
 * Request logging middleware for API routes
 * Extends the base Logger with HTTP-specific context
 *
 * @module RequestLogger
 */

import { logger } from '../logger/Logger.js';
import type { RouterRequest } from '../router/Router.js';

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
      sourceIp?: string;
    };
    identity?: {
      sourceIp?: string;
    };
  };
  httpMethod?: string;
  path?: string;
  headers?: Record<string, any>;
  body?: unknown;
  queryStringParameters?: Record<string, any>;
  pathParameters?: Record<string, any>;
}

/**
 * Anything a request logger can describe: a `RouterRequest` (any of the three
 * deployment modes — it already carries a trustworthy `clientIp` and
 * `requestId`), or a raw API Gateway event (format 2.0, or 1.0 for older
 * callers).
 */
export type LoggableRequest = Pick<RouterRequest, 'method' | 'path' | 'headers'> &
  Partial<Pick<RouterRequest, 'clientIp' | 'requestId' | 'body' | 'query' | 'params'>>;

interface ResponseObject {
  statusCode?: number;
  status?: number;
  [key: string]: any;
}

const isRouterRequest = (value: RequestEvent | LoggableRequest): value is LoggableRequest =>
  typeof (value as LoggableRequest).method === 'string' &&
  ('clientIp' in value || 'requestId' in value);

function requestFields(request: RequestEvent | LoggableRequest) {
  const userAgent = request.headers?.['user-agent'];
  if (isRouterRequest(request)) {
    return {
      requestId: request.requestId || 'unknown',
      method: request.method,
      path: request.path,
      sourceIp: request.clientIp || undefined,
      userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    };
  }
  const event = request as RequestEvent;
  return {
    requestId: event.requestContext?.requestId || 'unknown',
    method: event.httpMethod || event.requestContext?.http?.method,
    path: event.path || event.requestContext?.http?.path,
    // API Gateway sets both fields from the TCP connection; neither is read
    // from X-Forwarded-For, which the client controls.
    sourceIp: event.requestContext?.http?.sourceIp ?? event.requestContext?.identity?.sourceIp,
    userAgent,
  };
}

/**
 * Creates a request-scoped logger with HTTP context.
 *
 * @param request - A `RouterRequest` (preferred), or an API Gateway event
 * @returns Logger with request context
 */
export function createRequestLogger(
  request: RequestEvent | LoggableRequest
): RequestLoggerInterface {
  const requestContext = requestFields(request);

  return {
    info: (message: string, context: Record<string, any> = {}) => {
      logger.info(message, { ...requestContext, ...context });
    },
    error: (message: string, context: Record<string, any> = {}) => {
      logger.error(message, { ...requestContext, ...context });
    },
    warn: (message: string, context: Record<string, any> = {}) => {
      logger.warn(message, { ...requestContext, ...context });
    },
    debug: (message: string, context: Record<string, any> = {}) => {
      logger.debug(message, { ...requestContext, ...context });
    },
  };
}

/**
 * A raw event body is a string that is usually, but not always, JSON. It used
 * to go through a bare `JSON.parse`, so any non-JSON body made the logging
 * call itself throw and take the request down with it.
 */
function bodyForLog(body: unknown): unknown {
  if (typeof body !== 'string') return body ?? undefined;
  if (body === '') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Middleware to automatically log incoming requests
 *
 * @param {Object} event - AWS Lambda event
 * @returns {void}
 */
export function logRequest(request: RequestEvent | LoggableRequest): void {
  const requestLogger = createRequestLogger(request);
  const routerRequest = isRouterRequest(request) ? request : null;
  const event = request as RequestEvent;

  requestLogger.info('Incoming request', {
    body: bodyForLog(request.body),
    queryParams: routerRequest ? routerRequest.query : event.queryStringParameters,
    pathParams: routerRequest ? routerRequest.params : event.pathParameters,
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
export function logResponse(
  request: RequestEvent | LoggableRequest,
  response: ResponseObject,
  durationMs: number
): void {
  const requestLogger = createRequestLogger(request);
  // `statusCode` for an Event Function result, `status` for a RouterResponse
  // (which defaults to 200 when a route leaves it out).
  const statusCode = response.statusCode ?? response.status ?? 200;

  const level = statusCode >= 400 ? 'error' : 'info';

  requestLogger[level]('Request completed', {
    statusCode,
    durationMs,
    success: statusCode < 400,
  });
}
