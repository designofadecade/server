import Router from "../router/Router.js";
import Routes from "../router/Routes.js";
export default class Local {
    static LambdaProxyRouter(LambdaHandler, options = {}) {
        const router = new Router({
            initRoutes: [
                class LocalRoutes extends Routes {
                    constructor(router) {
                        super(router);
                        this.addRoute('*', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], async (event) => {
                            const lambdaOptions = event.lambdaOptions || {};
                            const LambdaResponse = await LambdaHandler({
                                "rawPath": event.path,
                                "headers": event.headers,
                                "queryStringParameters": event.query,
                                "cookies": event.cookies,
                                "requestContext": {
                                    "http": {
                                        "method": event.method,
                                        "path": event.path
                                    },
                                    "authorizer": event.authorizer || null,
                                    ...(lambdaOptions.requestContext || {})
                                },
                                "body": event.body ? JSON.stringify(event.body) : null,
                                ...(lambdaOptions.event || {})
                            });
                            let body = LambdaResponse.body || null;
                            if (LambdaResponse.headers?.['content-type']?.includes('application/json') && body) {
                                try {
                                    body = JSON.parse(body);
                                }
                                catch {
                                }
                            }
                            return {
                                status: LambdaResponse.statusCode,
                                headers: LambdaResponse.headers,
                                cookies: LambdaResponse.cookies,
                                body: body,
                                isBase64Encoded: LambdaResponse.isBase64Encoded || false
                            };
                        });
                    }
                }
            ]
        });
        return {
            request: (req, res, requestOptions = {}) => {
                return router.nodeJSRequest(req, res, {
                    cors: true,
                    lambdaOptions: {
                        requestContext: {
                            ...options.requestContext,
                            ...requestOptions.requestContext
                        },
                        event: {
                            ...options.event,
                            ...requestOptions.event
                        }
                    }
                });
            }
        };
    }
}
//# sourceMappingURL=Local.js.map