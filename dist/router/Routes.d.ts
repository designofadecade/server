import type Router from './Router.js';
interface RouteRegistration {
    path: string;
    methods: string[];
    pattern: URLPattern;
    handler: (event: any) => Promise<any>;
}
export default class Routes {
    #private;
    /**
     * Base path prefix for all routes in this class
     * @type {string}
     */
    static basePath: string;
    /**
     * Array of nested route classes to register
     * @type {Array}
     */
    static register: (new (router: Router, context?: any) => Routes)[];
    protected router: Router;
    protected context: any;
    constructor(router: Router, context?: any);
    get routerRoutes(): RouteRegistration[];
    addRoute(path: string, methods: string | string[], handler: (event: any) => Promise<any>): void;
}
export {};
//# sourceMappingURL=Routes.d.ts.map