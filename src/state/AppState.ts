export default class AppState {

    #env!: string;
    #rootPath!: string;
    #state!: Map<string, any>;

    static instance: AppState | undefined;

    /**
     * Creates or returns the singleton instance of AppState
     * @param {Object} config - Configuration object
     * @param {string} [config.env='development'] - Environment mode
     * @param {string} [config.rootPath='/'] - Root path of the application
     */
    constructor({ env = 'development', rootPath = '/' }: { env?: string; rootPath?: string } = {}) {

        if (AppState.instance)
            return AppState.instance;

        this.#env = env;
        this.#rootPath = rootPath;
        this.#state = new Map();

        AppState.instance = this;
    }

    /**
     * Get the current environment
     * @returns {string} The environment mode (e.g., 'development', 'production')
     */
    get env(): string {
        return this.#env;
    }

    /**
     * Get the root path
     * @returns {string} The application root path
     */
    get rootPath(): string {
        return this.#rootPath;
    }

    /**
     * Get a value from state
     * @param {string} key - The key to retrieve
     * @returns {*} The value associated with the key
     */
    get(key: string): any {
        return this.#state.get(key);
    }

    /**
     * Set a value in state
     * @param {string} key - The key to set
     * @param {*} value - The value to store
     * @returns {AppState} Returns this for method chaining
     */
    set(key: string, value: any): AppState {
        this.#state.set(key, value);
        return this;
    }

    /**
     * Check if a key exists in state
     * @param {string} key - The key to check
     * @returns {boolean} True if the key exists
     */
    has(key: string): boolean {
        return this.#state.has(key);
    }

    /**
     * Remove a key from state
     * @param {string} key - The key to remove
     * @returns {AppState} Returns this for method chaining
     */
    remove(key: string): AppState {
        this.#state.delete(key);
        return this;
    }

    /**
     * Clear all dynamic state
     * Note: Does not clear env and rootPath which are private fields
     * @returns {AppState} Returns this for method chaining
     */
    clear(): AppState {
        this.#state.clear();
        return this;
    }

}
