import type Router from './Router.js';

interface RouteRegistration {
    path: string;
    methods: string[];
    pattern: URLPattern;
    handler: (event: any) => Promise<any>;
}

export default class Routes {

    /**
     * Base path prefix for all routes in this class
     * @type {string}
     */
    static basePath = '';

    /**
     * Array of nested route classes to register
     * @type {Array}
     */
    static register: (new (router: Router, context?: any) => Routes)[] = [];

    #routerRoutes: RouteRegistration[] = [];
    protected router: Router;
    protected context: any;

    constructor(router: Router, context?: any) {

        this.router = router;
        this.context = context;

        (this.constructor as typeof Routes).register.forEach((RouteClass: new (router: Router, context?: any) => Routes) => {
            const route = new RouteClass(router, context);
            this.#routerRoutes.push(...route.routerRoutes);
        });

    }

    get routerRoutes(): RouteRegistration[] {
        return this.#routerRoutes;
    }

    addRoute(path: string, methods: string | string[], handler: (event: any) => Promise<any>): void {

        // Validate inputs
        if (typeof path !== 'string') {
            throw new Error('Path must be a string');
        }

        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }

        const normalizedPath = `${(this.constructor as typeof Routes).basePath}${path}`.replace(/\/+/g, '/');

        // Normalize methods to array
        const methodsArray = Array.isArray(methods) ? methods : [methods];

        // Validate HTTP methods
        const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
        const invalidMethods = methodsArray.filter(m => !validMethods.includes(m));
        if (invalidMethods.length > 0) {
            throw new Error(`Invalid HTTP methods: ${invalidMethods.join(', ')}`);
        }

        this.#routerRoutes.push({
            path: normalizedPath,
            methods: methodsArray,
            pattern: new URLPattern({ pathname: normalizedPath }),
            handler
        });
    }

}
