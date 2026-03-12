import type { RouterResponse } from './Router.js';
/**
 * Options for creating error responses from Error objects
 */
export interface FromErrorOptions {
    /** Default message to show when error is unsafe to expose */
    defaultMessage: string;
    /** HTTP status code (default: 500) */
    status?: number;
    /** Error type/category (default: derived from status) */
    error?: string;
    /** Additional error classes to treat as safe */
    safeErrorClasses?: string[];
    /** Additional context for logging */
    context?: Record<string, unknown>;
}
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
    static fromError(error: unknown, options: FromErrorOptions): RouterResponse;
    /**
     * Determines if an error is safe to expose to clients
     *
     * @param error - Error to check
     * @param safeClasses - List of error class names considered safe
     * @returns true if error is safe to expose
     */
    private static isSafeError;
    /**
     * Extracts error details from unknown error
     *
     * @param error - Error to extract details from
     * @returns Extracted error details
     */
    private static extractErrorDetails;
    /**
     * Gets default error type based on status code
     *
     * @param status - HTTP status code
     * @returns Default error type string
     */
    private static getDefaultErrorType;
}
//# sourceMappingURL=RouteError.d.ts.map