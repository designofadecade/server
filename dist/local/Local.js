/**
 * Local development utilities for Lambda handlers
 *
 * Provides utilities to run AWS Lambda handlers locally using a Node.js server.
 * Converts HTTP requests to Lambda event format and responses back to HTTP.
 *
 * @class Local
 * @example
 * // Wrap your Lambda handler for local development
 * import { handler } from './lambda/handler.js';
 * import Local from '@designofadecade/local';
 *
 * const localHandler = Local.LambdaProxyRouter(handler, {
 *     requestContext: { stage: 'dev' }
 * });
 *
 * // Use with Node.js http server
 * http.createServer((req, res) => {
 *     localHandler.request(req, res);
 * }).listen(3000);
 */
import Router from '../router/Router.js';
import Routes from '../router/Routes.js';
export default class Local {
    /**
     * Lambda proxy router for local development
     *
     * Creates a router that wraps AWS Lambda handlers and allows them to be
     * run locally with a Node.js HTTP server. Automatically converts between
     * HTTP requests and Lambda event format.
     *
     * @param {Function} LambdaHandler - AWS Lambda handler function
     * @param {Object} options - Configuration options
     * @param {Object} options.requestContext - Additional requestContext fields for Lambda event
     * @param {Object} options.event - Additional event fields for Lambda event
     * @returns {Object} Object with request method for handling HTTP requests
     *
     * @example
     * const handler = Local.LambdaProxyRouter(
     *     async (event) => {
     *         return {
     *             statusCode: 200,
     *             body: JSON.stringify({ message: 'Hello!' })
     *         };
     *     },
     *     { requestContext: { stage: 'local' } }
     * );
     */
    static LambdaProxyRouter(LambdaHandler, options = {}) {
        const router = new Router({
            initRoutes: [
                class LocalRoutes extends Routes {
                    constructor(router) {
                        super(router);
                        this.addRoute('*', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], async (request) => {
                            const lambdaOptions = request.lambdaOptions || {};
                            const LambdaResponse = await LambdaHandler({
                                rawPath: request.path,
                                headers: request.headers,
                                queryStringParameters: request.query,
                                cookies: request.cookies,
                                requestContext: {
                                    http: {
                                        method: request.method,
                                        path: request.path,
                                    },
                                    authorizer: request.authorizer || null,
                                    ...(lambdaOptions.requestContext || {}),
                                },
                                body: request.body ? JSON.stringify(request.body) : null,
                                ...(lambdaOptions.event || {}),
                            });
                            let body = LambdaResponse.body || null;
                            if (LambdaResponse.headers?.['content-type']?.includes('application/json') &&
                                body) {
                                try {
                                    body = JSON.parse(body);
                                }
                                catch {
                                    // Silently fail if body is not valid JSON
                                }
                            }
                            // Note: Lambda cookies are handled via Set-Cookie headers, not separate cookies property
                            return {
                                status: LambdaResponse.statusCode,
                                headers: LambdaResponse.headers,
                                body: body,
                                isBase64Encoded: LambdaResponse.isBase64Encoded || false,
                            };
                        });
                    }
                },
            ],
        });
        return {
            request: (req, res, requestOptions = {}) => {
                return router.nodeJSRequest(req, res, {
                    cors: true,
                    lambdaOptions: {
                        requestContext: {
                            ...options.requestContext,
                            ...requestOptions.requestContext,
                        },
                        event: {
                            ...options.event,
                            ...requestOptions.event,
                        },
                    },
                });
            },
        };
    }
}
//# sourceMappingURL=Local.js.map