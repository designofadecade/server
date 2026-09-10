import type Router from './Router.js';
import type {
  RouterRequest,
  RouterResponse,
  RouterMiddleware,
  RouteRegistration,
  RoutesConstructor,
} from './Router.js';
import type { ContextLike } from '../context/Context.js';

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
  static register: RoutesConstructor<Routes>[] = [];

  #routerRoutes: RouteRegistration[] = [];
  protected router: Router;
  protected context?: ContextLike;

  constructor(router: Router, context?: ContextLike) {
    this.router = router;
    this.context = context;

    (this.constructor as typeof Routes).register.forEach((RouteClass) => {
      // `context` is `ContextLike`; the constructor parameter is `never` so
      // that subclasses may narrow it. See `RoutesConstructor`.
      const route = new RouteClass(router, context as never);
      this.#routerRoutes.push(...route.routerRoutes);
    });
  }

  get routerRoutes(): RouteRegistration[] {
    return this.#routerRoutes;
  }

  addRoute(
    path: string,
    methods: string | string[],
    handler: (request: RouterRequest) => Promise<RouterResponse>,
    middleware?: RouterMiddleware[]
  ): void {
    // Validate inputs
    if (typeof path !== 'string') {
      throw new Error('Path must be a string');
    }

    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    const normalizedPath = `${(this.constructor as typeof Routes).basePath}${path}`.replace(
      /\/+/g,
      '/'
    );

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
