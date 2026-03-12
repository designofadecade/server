import { logger } from '../logger/Logger.js';
/**
 * Default error classes that are considered safe to expose to clients
 * These typically represent application-level errors with user-friendly messages
 */
const DEFAULT_SAFE_ERROR_CLASSES = [
    'ValidationError',
    'ConflictError',
    'NotFoundError',
    'AuthenticationError',
    'AuthorizationError',
    'UserError',
    'BadRequestError',
    'ForbiddenError',
];
/**
 * Route error response utility for creating standardized error responses
 *
 * @class RouteError
 */
export default class RouteError {
    /**
     * Creates a safe error response from an Error object
     * Automatically determines if error message is safe to expose based on error class
     * Logs full error details internally for debugging
     *
     * Safe errors (ValidationError, etc.) always show their messages
     * Unsafe errors (system/library errors) are hidden behind defaultMessage
     *
     * @param error - Error object or unknown error
     * @param options - Configuration options
     * @returns RouterResponse object
     *
     * @example
     * try {
     *   await usersService.create(data);
     * } catch (error) {
     *   return RouteError.fromError(error, {
     *     defaultMessage: 'Error creating user',
     *     status: 400,
     *     context: { userId: request.user?.id }
     *   });
     * }
     */
    static fromError(error, options) {
        const { defaultMessage, status = 500, error: errorType, safeErrorClasses = [], context = {}, } = options;
        // Combine default safe classes with custom ones
        const allSafeClasses = [...DEFAULT_SAFE_ERROR_CLASSES, ...safeErrorClasses];
        // Determine if error is safe to expose
        const isSafe = this.isSafeError(error, allSafeClasses);
        // Extract error details for logging
        const errorDetails = this.extractErrorDetails(error);
        // Log full error details internally
        logger.error('Route error occurred', {
            source: 'RouteError.fromError',
            code: 'ROUTE_ERROR',
            isSafeError: isSafe,
            errorName: errorDetails.name,
            errorMessage: errorDetails.message,
            stack: errorDetails.stack,
            status,
            defaultMessage,
            ...context,
        });
        // Determine what to show to client
        const clientMessage = isSafe ? errorDetails.message : defaultMessage;
        const clientError = errorType || this.getDefaultErrorType(status);
        // Build response body
        const responseBody = {
            error: clientError,
            message: clientMessage,
            statusCode: status,
        };
        // Include error code if available and safe
        if (isSafe && errorDetails.code) {
            responseBody.code = errorDetails.code;
        }
        return {
            status,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseBody),
        };
    }
    /**
     * Determines if an error is safe to expose to clients
     *
     * @param error - Error to check
     * @param safeClasses - List of error class names considered safe
     * @returns true if error is safe to expose
     */
    static isSafeError(error, safeClasses) {
        if (!(error instanceof Error)) {
            return false;
        }
        // Check if error class name is in safe list
        return safeClasses.includes(error.name);
    }
    /**
     * Extracts error details from unknown error
     *
     * @param error - Error to extract details from
     * @returns Extracted error details
     */
    static extractErrorDetails(error) {
        if (error instanceof Error) {
            // Extract code if present (common in custom error classes)
            const errorWithCode = error;
            return {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: errorWithCode.code,
            };
        }
        // Handle non-Error objects
        if (typeof error === 'string') {
            return {
                name: 'Error',
                message: error,
            };
        }
        if (typeof error === 'object' && error !== null) {
            const errorObj = error;
            return {
                name: 'Error',
                message: String(errorObj.message || 'Unknown error'),
            };
        }
        return {
            name: 'Error',
            message: 'Unknown error occurred',
        };
    }
    /**
     * Gets default error type based on status code
     *
     * @param status - HTTP status code
     * @returns Default error type string
     */
    static getDefaultErrorType(status) {
        const errorTypes = {
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            409: 'Conflict',
            422: 'Unprocessable Entity',
            500: 'Internal Server Error',
            502: 'Bad Gateway',
            503: 'Service Unavailable',
        };
        return errorTypes[status] || 'Server Error';
    }
}
//# sourceMappingURL=RouteError.js.map