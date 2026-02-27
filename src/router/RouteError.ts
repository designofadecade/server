import type { RouterResponse } from './Router.js';

/**
 * Route error response utility for creating standardized error responses
 * 
 * @class RouteError
 */
export default class RouteError {

    /**
     * Creates a standardized error response for router handlers
     * 
     * @param status - HTTP status code
     * @param error - Error type/category
     * @param message - Optional detailed error message (omitted in production for security)
     * @returns RouterResponse object
     * 
     * @example
     * return RouteError.create(404, 'Not Found', 'Route does not exist');
     */
    static create(
        status: number,
        error: string,
        message?: string
    ): RouterResponse {
        const isDevelopment = process.env.NODE_ENV === 'development';

        return {
            status,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error,
                ...(isDevelopment && message && { message }),
                statusCode: status
            })
        };
    }
}
