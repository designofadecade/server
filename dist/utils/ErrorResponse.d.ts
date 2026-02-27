import type { RouterResponse } from '../router/Router.js';
/**
 * Creates a standardized error response for the router
 *
 * @param status - HTTP status code
 * @param error - Error type/category
 * @param message - Optional detailed error message (omitted in production for security)
 * @returns RouterResponse object
 *
 * @example
 * return createErrorResponse(404, 'Not Found', 'Route does not exist');
 */
export declare function createErrorResponse(status: number, error: string, message?: string): RouterResponse;
//# sourceMappingURL=ErrorResponse.d.ts.map