import type Router from './Router.js';
import type { RouterRequest, RouterResponse, RouterMiddleware } from './Router.js';
import type Context from '../context/Context.js';
interface RouteRegistration {
  path: string;
  methods: string[];
  pattern: URLPattern;
  handler: (request: RouterRequest) => Promise<RouterResponse>;
  middleware?: RouterMiddleware[];
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
  static register: (new (router: Router, context?: Context) => Routes)[];
  protected router: Router;
  protected context?: Context;
  constructor(router: Router, context?: Context);
  get routerRoutes(): RouteRegistration[];
  addRoute(
    path: string,
    methods: string | string[],
    handler: (request: RouterRequest) => Promise<RouterResponse>,
    middleware?: RouterMiddleware[]
  ): void;
}
export {};
//# sourceMappingURL=Routes.d.ts.map
