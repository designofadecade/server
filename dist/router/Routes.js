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
    static register = [];
    #routerRoutes = [];
    router;
    context;
    constructor(router, context) {
        this.router = router;
        this.context = context;
        this.constructor.register.forEach((RouteClass) => {
            const route = new RouteClass(router, context);
            this.#routerRoutes.push(...route.routerRoutes);
        });
    }
    get routerRoutes() {
        return this.#routerRoutes;
    }
    addRoute(path, methods, handler, middleware) {
        // Validate inputs
        if (typeof path !== 'string') {
            throw new Error('Path must be a string');
        }
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }
        const normalizedPath = `${this.constructor.basePath}${path}`.replace(/\/+/g, '/');
        // Normalize methods to array
        const methodsArray = Array.isArray(methods) ? methods : [methods];
        // Validate HTTP methods
        const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
        const invalidMethods = methodsArray.filter((m) => !validMethods.includes(m));
        if (invalidMethods.length > 0) {
            throw new Error(`Invalid HTTP methods: ${invalidMethods.join(', ')}`);
        }
        this.#routerRoutes.push({
            path: normalizedPath,
            methods: methodsArray,
            pattern: new URLPattern({ pathname: normalizedPath }),
            handler,
            ...(middleware && { middleware }),
        });
    }
}
//# sourceMappingURL=Routes.js.map