/**
 * API Client for making HTTP requests
 * @class ApiClient
 * @example
 * const client = new ApiClient('https://api.example.com');
 * client.setAuthToken('your-token');
 * const result = await client.get('/users', { page: 1, limit: 10 });
 */
interface ApiClientOptions {
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
}
interface RequestOptions {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
interface ApiResponse {
    ok: boolean;
    status: number | null;
    statusText: string;
    data: any;
    error: string | null;
    headers: Record<string, string>;
}
type RequestInterceptor = (config: RequestInit & {
    signal: AbortSignal;
}) => Promise<RequestInit & {
    signal: AbortSignal;
}> | RequestInit & {
    signal: AbortSignal;
};
type ResponseInterceptor = (response: ApiResponse) => Promise<ApiResponse> | ApiResponse;
export default class ApiClient {
    #private;
    /**
     * Create an API Client
     * @param {string} baseUrl - Base URL for all requests
     * @param {Object} options - Configuration options
     * @param {number} options.timeout - Request timeout in milliseconds (default: 30000)
     * @param {number} options.retryAttempts - Number of retry attempts for failed requests (default: 0)
     * @param {number} options.retryDelay - Delay between retries in milliseconds (default: 1000)
     */
    constructor(baseUrl: string, options?: ApiClientOptions);
    /**
     * Set authentication token
     * @param {string} token - Authentication token
     * @param {string} type - Token type (default: 'Bearer')
     */
    setAuthToken(token: string, type?: string): void;
    /**
     * Clear authentication token
     */
    clearAuthToken(): void;
    /**
     * Set default headers for all requests
     * @param {Object} headers - Headers object
     */
    setDefaultHeaders(headers: Record<string, string>): void;
    /**
     * Add a request interceptor
     * @param {Function} interceptor - Function that receives and modifies request config
     */
    addRequestInterceptor(interceptor: RequestInterceptor): void;
    /**
     * Add a response interceptor
     * @param {Function} interceptor - Function that receives and modifies response
     */
    addResponseInterceptor(interceptor: ResponseInterceptor): void;
    /**
     * Make GET request
     * @param {string} url - Request URL
     * @param {Object} params - Query parameters (optional)
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    get(url: string, params?: Record<string, any> | null, options?: RequestOptions): Promise<ApiResponse>;
    /**
     * Make POST request
     * @param {string} url - Request URL
     * @param {Object|FormData} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    post(url: string, data: any, options?: RequestOptions): Promise<ApiResponse>;
    /**
     * Make PUT request
     * @param {string} url - Request URL
     * @param {Object|FormData} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    put(url: string, data: any, options?: RequestOptions): Promise<ApiResponse>;
    /**
     * Make DELETE request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    delete(url: string, options?: RequestOptions): Promise<ApiResponse>;
    /**
     * Make PATCH request
     * @param {string} url - Request URL
     * @param {Object} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    patch(url: string, data: any, options?: RequestOptions): Promise<ApiResponse>;
}
export {};
//# sourceMappingURL=ApiClient.d.ts.map