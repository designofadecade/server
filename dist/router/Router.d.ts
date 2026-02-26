import { IncomingMessage, ServerResponse } from 'http';
export interface RouterRequest {
    path: string;
    method: string;
    body: any;
    cookies: Record<string, string>;
    params: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    authorizer?: any;
    lambdaOptions?: any;
}
export interface RouterResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
    isBase64Encoded?: boolean;
}
export interface RouterOptions {
    context?: any;
    initRoutes?: (new (router: Router, context?: any) => any)[];
    bearerToken?: string | null;
    middleware?: RouterMiddleware[];
}
export type RouterMiddleware = (event: RouterRequest) => Promise<RouterResponse | void>;
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
//# sourceMappingURL=Router.d.ts.map