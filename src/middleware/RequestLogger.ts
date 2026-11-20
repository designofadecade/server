/**
 * Request logging middleware for API routes
 * Extends the base Logger with HTTP-specific context
 *
 * @module RequestLogger
 */

import { logger } from '../logger/Logger.js';
import { isSensitiveKey } from '../logger/sensitiveKeys.js';
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

// A raw API Gateway event never has a top-level `method` (format 2.0 nests it
// under requestContext.http, format 1.0 calls it httpMethod).
const isRouterRequest = (value: RequestEvent | LoggableRequest): value is LoggableRequest =>
  typeof (value as LoggableRequest).method === 'string';

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

/** Options for {@link logRequest}. */
export interface LogRequestOptions {
  /**
   * Log the body's content. Off by default: only a summary is logged
   * (`{ contentType, bytes }` for a raw body, `{ contentType, fields }` for a
   * parsed object, `{ contentType, items }` for an array), because a request
   * body can hold personal data under any field name, and a list of names to
   * redact can never be complete.
   *
   * When on, object and array bodies are logged with every sensitive key
   * (passwords, tokens, card numbers, ...) redacted and long strings
   * truncated. Text bodies (form posts, multipart, plain text, base64) are
   * never logged, since key-based redaction cannot see inside a string.
   */
  logBody?: boolean;
  /**
   * With `logBody`, the field names to log verbatim (exact, case-sensitive).
   * Every other field, at any depth, is logged as `'[REDACTED]'`; a nested
   * object or array is walked only when its own key is listed. Sensitive keys
   * stay redacted even when listed. Recommended whenever `logBody` is on.
   */
  bodyFields?: readonly string[];
}

const REDACTED = '[REDACTED]';
/** Longest string value written for a logged body field. */
const MAX_LOGGED_STRING = 256;
const MAX_BODY_DEPTH = 10;
const MAX_CONTENT_TYPE = 100;

const capString = (value: string): string =>
  value.length > MAX_LOGGED_STRING
    ? `${value.slice(0, MAX_LOGGED_STRING)}…[truncated, ${value.length} chars]`
    : value;

/**
 * Walks a parsed body, redacting sensitive keys always and, with an
 * allowlist, every key not on it. `allowed` says whether the nearest
 * enclosing key permits a primitive to be logged.
 */
function redactBody(
  value: unknown,
  fields: ReadonlySet<string> | null,
  allowed: boolean,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') {
    if (!allowed) return REDACTED;
    if (typeof value === 'string') return capString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return REDACTED; // bigint, symbol, function: not JSON data
  }
  if (depth >= MAX_BODY_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactBody(item, fields, allowed, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) || (fields !== null && !fields.has(key))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactBody(child, fields, true, depth + 1, seen);
    }
  }
  return out;
}

function contentTypeOf(request: RequestEvent | LoggableRequest): string | undefined {
  const header = request.headers?.['content-type'];
  const value = Array.isArray(header) ? header.join(', ') : header;
  return typeof value === 'string' ? value.slice(0, MAX_CONTENT_TYPE) : undefined;
}

/**
 * The default: describe the body without any of its content.
 */
function bodySummary(body: unknown, contentType: string | undefined): unknown {
  if (body === null || body === undefined || body === '') return undefined;
  if (typeof body === 'string') return { contentType, bytes: Buffer.byteLength(body) };
  if (Buffer.isBuffer(body)) return { contentType, bytes: body.length };
  if (Array.isArray(body)) return { contentType, items: body.length };
  if (typeof body === 'object') return { contentType, fields: Object.keys(body).length };
  return { contentType };
}

/**
 * Opted in with `logBody`. A raw event body is a string that is usually, but
 * not always, JSON; it is parsed defensively so a non-JSON body never makes
 * the logging call throw.
 *
 * A body that is still text after that — a form post
 * (`email=…&password=…`), multipart, plain text, base64 — is not logged:
 * redaction works by object key, and a string has none, so credentials in it
 * would reach the log verbatim. Only its length is kept.
 */
function bodyContent(body: unknown, bodyFields: readonly string[] | undefined): unknown {
  if (body === null || body === undefined || body === '') return undefined;
  if (Buffer.isBuffer(body)) return `[binary body omitted, ${body.length} bytes]`;
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || typeof parsed === 'string') {
      return `[text body omitted, ${body.length} chars]`;
    }
  }
  const fields = bodyFields ? new Set(bodyFields) : null;
  return redactBody(parsed, fields, fields === null, 0, new WeakSet());
}

/**
 * Logs an incoming request: method, path, client IP, user agent, query and
 * path parameters, and a summary of the body. Body content is logged only
 * with `options.logBody`.
 *
 * @param request - A `RouterRequest` (preferred), or an API Gateway event
 * @param options - See {@link LogRequestOptions}
 */
export function logRequest(
  request: RequestEvent | LoggableRequest,
  options: LogRequestOptions = {}
): void {
  const requestLogger = createRequestLogger(request);
  const routerRequest = isRouterRequest(request) ? request : null;
  const event = request as RequestEvent;

  requestLogger.info('Incoming request', {
    body: options.logBody
      ? bodyContent(request.body, options.bodyFields)
      : bodySummary(request.body, contentTypeOf(request)),
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
