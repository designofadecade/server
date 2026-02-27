import { IncomingMessage, ServerResponse } from 'http';
interface LambdaHttpEvent {
  requestContext: {
    http: {
      method: string;
      path: string;
    };
    authorizer?: unknown;
  };
  headers: Record<string, string | string[] | undefined>;
  body?: string | null;
  cookies?: string[];
  queryStringParameters?: Record<string, string>;
  [key: string]: unknown;
}
interface RouteRegistration {
  path: string;
  methods: string[];
  pattern: URLPattern;
  handler: (request: RouterRequest) => Promise<RouterResponse>;
  middleware?: RouterMiddleware[];
}
export interface RouterRequest {
  path: string;
  method: string;
  body: unknown;
  cookies: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  authorizer?: unknown;
  lambdaOptions?: unknown;
}
export interface RouterResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  isBase64Encoded?: boolean;
}
export interface RouterOptions {
  context?: unknown;
  initRoutes?: (new (
    router: Router,
    context?: unknown
  ) => {
    routerRoutes: RouteRegistration[];
  })[];
  bearerToken?: string | null;
  middleware?: RouterMiddleware[];
}
export type RouterMiddleware = (request: RouterRequest) => Promise<RouterResponse | void>;
export default class Router {
  #private;
  static MethodsWithBody: string[];
  constructor({ context, initRoutes, bearerToken, middleware }?: RouterOptions);
  lambdaEvent(event: LambdaHttpEvent): Promise<{
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
  }>;
  nodeJSRequest(
    req: IncomingMessage,
    res: ServerResponse,
    {
      cors,
      lambdaOptions,
    }?: {
      cors?: boolean;
      lambdaOptions?: Record<string, unknown>;
    }
  ): Promise<void>;
}
export {};
//# sourceMappingURL=Router.d.ts.map
