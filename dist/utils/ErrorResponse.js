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
export function createErrorResponse(status, error, message) {
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
//# sourceMappingURL=ErrorResponse.js.map