export default class AppState {
    #private;
    private static instance?;
    /**
     * Private constructor for singleton pattern
     * @param {Object} config - Configuration object
     * @param {string} [config.env='development'] - Environment mode
     * @param {string} [config.rootPath='/'] - Root path of the application
     */
    private constructor();
    /**
     * Gets or creates the singleton instance of AppState
     * @param {Object} config - Configuration object
     * @param {string} [config.env='development'] - Environment mode
     * @param {string} [config.rootPath='/'] - Root path of the application
     * @returns {AppState} The singleton instance
     */
    static getInstance(config?: {
        env?: string;
        rootPath?: string;
    }): AppState;
    /**
     * Get the current environment
     * @returns {string} The environment mode (e.g., 'development', 'production')
     */
    get env(): string;
    /**
     * Get the root path
     * @returns {string} The application root path
     */
    get rootPath(): string;
    /**
     * Get a value from state
     * @param {string} key - The key to retrieve
     * @returns {*} The value associated with the key
     */
    get(key: string): any;
    /**
     * Set a value in state
     * @param {string} key - The key to set
     * @param {*} value - The value to store
     * @returns {AppState} Returns this for method chaining
     */
    set(key: string, value: any): AppState;
    /**
     * Check if a key exists in state
     * @param {string} key - The key to check
     * @returns {boolean} True if the key exists
     */
    has(key: string): boolean;
    /**
     * Remove a key from state
     * @param {string} key - The key to remove
     * @returns {AppState} Returns this for method chaining
     */
    remove(key: string): AppState;
    /**
     * Clear all dynamic state
     * Note: Does not clear env and rootPath which are private fields
     * @returns {AppState} Returns this for method chaining
     */
    clear(): AppState;
}
//# sourceMappingURL=AppState.d.ts.map