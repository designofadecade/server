import { IncomingMessage, ServerResponse } from 'http';
interface RequestEvent {
    path: string;
    method: string;
    body: any;
    cookies: Record<string, string>;
    params: Record<string, string>;
    query: Record<string, any>;
    headers: Record<string, any>;
    authorizer?: any;
    lambdaOptions?: any;
}
interface RouteResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
    isBase64Encoded?: boolean;
}
interface RouterOptions {
    context?: any;
    initRoutes?: (new (router: Router, context?: any) => any)[];
    bearerToken?: string | null;
    middleware?: Middleware[];
}
type Middleware = (event: RequestEvent) => Promise<RouteResponse | void>;
export default class Router {
    #private;
    static MethodsWithBody: string[];
    constructor({ context, initRoutes, bearerToken, middleware }?: RouterOptions);
    lambdaEvent(event: any): Promise<{
        statusCode: number;
        headers?: Record<string, string>;
        body: string;
        isBase64Encoded?: boolean;
    }>;
    nodeJSRequest(req: IncomingMessage, res: ServerResponse, { cors, lambdaOptions }?: {
        cors?: boolean;
        lambdaOptions?: any;
    }): Promise<void>;
}
export {};
//# sourceMappingURL=Router.d.ts.map