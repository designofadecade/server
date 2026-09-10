/**
 * Structural stand-in for an application context.
 *
 * The framework never calls `validate`, `initialize` or `dispose` — it only
 * stores a context and hands it to route classes — so it has no reason to
 * demand the `Context` *class*. It did anyway, and because those members are
 * `protected` they can only be satisfied by real inheritance: any consumer test
 * that stubbed a context with a plain object hit TS2739 and had to cast the
 * problem away in exactly the place type safety is most useful.
 *
 * `ContextLike` is therefore what the router accepts. Extend it to describe
 * your own context (`interface AppContext extends ContextLike { db: Db }`) and
 * plain objects satisfy it; the abstract `Context` class remains available as a
 * convenience base and satisfies `ContextLike` too.
 */
export type ContextLike = object;

/**
 * Abstract Context class for application context management
 *
 * Extend this when you want the lifecycle hooks below as extension points for
 * your own code. The router does not require it — it accepts any `ContextLike`
 * — and because `validate`, `initialize` and `dispose` are `protected`, a
 * context typed as this class can only be satisfied by real inheritance. If you
 * want to stub a context with a plain object in tests, describe it with
 * `ContextLike` instead.
 *
 * @abstract
 * @class Context
 *
 * @example
 * // Define your application context
 * class AppContext extends Context {
 *     constructor(
 *         public database: DatabaseConnection,
 *         public config: AppConfig,
 *         public services: Services
 *     ) {
 *         super();
 *     }
 * }
 *
 * // Use in router initialization
 * const context = new AppContext(db, config, services);
 * const router = new Router({
 *     context,
 *     initRoutes: [UserRoutes, PostRoutes]
 * });
 *
 * @example
 * // Narrow the context in the route class constructor, so handlers read it
 * // without a cast.
 * class UserRoutes extends Routes {
 *     constructor(router: Router, private ctx?: AppContext) {
 *         super(router, ctx);
 *
 *         this.addRoute('/users', 'GET', async () => {
 *             const users = await this.ctx!.database.getUsers();
 *             return { status: 200, body: users };
 *         });
 *     }
 * }
 */
export default abstract class Context {
  /**
   * Protected constructor ensures this class cannot be instantiated directly
   * and must be extended by a concrete implementation
   */
  protected constructor() {
    if (new.target === Context) {
      throw new TypeError('Cannot construct Context instances directly. Context must be extended.');
    }
  }

  /**
   * Optional method to validate context state
   * Override in derived classes to implement custom validation
   *
   * @returns {boolean} True if context is valid
   */
  protected validate(): boolean {
    return true;
  }

  /**
   * Optional method to initialize context
   * Override in derived classes to implement custom initialization logic
   *
   * @returns {Promise<void>}
   */
  protected async initialize(): Promise<void> {
    // Override in derived classes
  }

  /**
   * Optional method to cleanup context resources
   * Override in derived classes to implement custom cleanup logic
   *
   * @returns {Promise<void>}
   */
  protected async dispose(): Promise<void> {
    // Override in derived classes
  }
}
