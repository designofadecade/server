/**
 * Abstract Context class for application context management
 *
 * This abstract class must be extended to provide type-safe context
 * throughout the application. It enforces a pattern where context
 * structure is explicitly defined through extension.
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
 * // Access context in route handlers
 * class UserRoutes extends Routes {
 *     constructor(router: Router, context?: AppContext) {
 *         super(router, context);
 *
 *         this.addRoute('/users', 'GET', async () => {
 *             const users = await (this.context as AppContext).database.getUsers();
 *             return { status: 200, body: users };
 *         });
 *     }
 * }
 */
export default class Context {
    /**
     * Protected constructor ensures this class cannot be instantiated directly
     * and must be extended by a concrete implementation
     */
    constructor() {
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
    validate() {
        return true;
    }
    /**
     * Optional method to initialize context
     * Override in derived classes to implement custom initialization logic
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        // Override in derived classes
    }
    /**
     * Optional method to cleanup context resources
     * Override in derived classes to implement custom cleanup logic
     *
     * @returns {Promise<void>}
     */
    async dispose() {
        // Override in derived classes
    }
}
//# sourceMappingURL=Context.js.map