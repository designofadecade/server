interface LambdaProxyRouterOptions {
    requestContext?: Record<string, any>;
    event?: Record<string, any>;
}
export default class Local {
    static LambdaProxyRouter(LambdaHandler: (event: any) => Promise<any>, options?: LambdaProxyRouterOptions): {
        request: (req: any, res: any, requestOptions?: {
            requestContext?: Record<string, any>;
            event?: Record<string, any>;
        }) => Promise<void>;
    };
}
export {};
//# sourceMappingURL=Local.d.ts.map