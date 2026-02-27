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

type RequestInterceptor = (config: RequestInit & { signal: AbortSignal }) => Promise<RequestInit & { signal: AbortSignal }> | RequestInit & { signal: AbortSignal };
type ResponseInterceptor = (response: ApiResponse) => Promise<ApiResponse> | ApiResponse;

export default class ApiClient {

    #baseUrl: string = '';
    #authToken: string | null = null;
    #authType: string = 'Bearer';
    #defaultHeaders: Record<string, string> = {};
    #timeout: number = 30000; // 30 seconds default
    #requestInterceptors: RequestInterceptor[] = [];
    #responseInterceptors: ResponseInterceptor[] = [];
    #retryAttempts: number = 0;
    #retryDelay: number = 1000;

    /**
     * Create an API Client
     * @param {string} baseUrl - Base URL for all requests
     * @param {Object} options - Configuration options
     * @param {number} options.timeout - Request timeout in milliseconds (default: 30000)
     * @param {number} options.retryAttempts - Number of retry attempts for failed requests (default: 0)
     * @param {number} options.retryDelay - Delay between retries in milliseconds (default: 1000)
     */
    constructor(baseUrl: string, options: ApiClientOptions = {}) {
        this.#baseUrl = baseUrl;
        this.#timeout = options.timeout || 30000;
        this.#retryAttempts = options.retryAttempts || 0;
        this.#retryDelay = options.retryDelay || 1000;
    }

    /**
     * Set authentication token
     * @param {string} token - Authentication token
     * @param {string} type - Token type (default: 'Bearer')
     */
    setAuthToken(token: string, type: string = 'Bearer'): void {
        this.#authToken = token;
        this.#authType = type;
    }

    /**
     * Clear authentication token
     */
    clearAuthToken(): void {
        this.#authToken = null;
    }

    /**
     * Set default headers for all requests
     * @param {Object} headers - Headers object
     */
    setDefaultHeaders(headers: Record<string, string>): void {
        this.#defaultHeaders = { ...headers };
    }

    /**
     * Add a request interceptor
     * @param {Function} interceptor - Function that receives and modifies request config
     */
    addRequestInterceptor(interceptor: RequestInterceptor): void {
        this.#requestInterceptors.push(interceptor);
    }

    /**
     * Add a response interceptor
     * @param {Function} interceptor - Function that receives and modifies response
     */
    addResponseInterceptor(interceptor: ResponseInterceptor): void {
        this.#responseInterceptors.push(interceptor);
    }

    /**
     * Build query string from params object
     * @param {Object} params - Query parameters
     * @returns {string} Query string
     */
    #buildQueryString(params: Record<string, any>): string {
        if (!params || Object.keys(params).length === 0) return '';
        const queryString = new URLSearchParams(params).toString();
        return `?${queryString}`;
    }

    /**
     * Get headers for request
     * @param {Object} customHeaders - Custom headers for this request
     * @returns {Object} Combined headers
     */
    #getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...this.#defaultHeaders,
            ...customHeaders
        };

        if (this.#authToken) {
            headers['Authorization'] = `${this.#authType} ${this.#authToken}`;
        }

        return headers;
    }

    /**
     * Execute request with timeout and retry logic
     * @param {Function} fetchFn - Function that performs the fetch
     * @param {AbortController} controller - Abort controller for timeout
     * @param {number} attempt - Current attempt number
     * @returns {Promise<Response>}
     */
    async #executeWithRetry(fetchFn: () => Promise<Response>, controller: AbortController, attempt: number = 0): Promise<Response> {
        let timeoutId: NodeJS.Timeout | undefined;

        try {
            timeoutId = setTimeout(() => controller.abort(), this.#timeout);
            const response = await fetchFn();
            return response;
        } catch (error: any) {
            if (attempt < this.#retryAttempts && error.name !== 'AbortError') {
                await new Promise(resolve => setTimeout(resolve, this.#retryDelay));
                return this.#executeWithRetry(fetchFn, controller, attempt + 1);
            }
            throw error;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    /**
     * Process response through interceptors
     * @param {Object} response - Response object
     * @returns {Promise<Object>} Processed response
     */
    async #processResponse(response: ApiResponse): Promise<ApiResponse> {
        let processedResponse = response;
        for (const interceptor of this.#responseInterceptors) {
            processedResponse = await interceptor(processedResponse);
        }
        return processedResponse;
    }

    /**
     * Make HTTP request
     * @param {string} url - Request URL
     * @param {Object} config - Request configuration
     * @returns {Promise<Object>} Response object
     */
    async #request(url: string, config: RequestInit): Promise<ApiResponse> {
        const controller = new AbortController();

        try {
            // Apply request interceptors
            let requestConfig: RequestInit & { signal: AbortSignal } = { ...config, signal: controller.signal };
            for (const interceptor of this.#requestInterceptors) {
                requestConfig = await interceptor(requestConfig);
            }

            const fetchFn = () => fetch(`${this.#baseUrl}${url}`, requestConfig);
            const response = await this.#executeWithRetry(fetchFn, controller);

            let responseData: any = null;
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('application/json')) {
                try {
                    responseData = await response.json();
                } catch (e) {
                    // Failed to parse JSON
                }
            } else if (contentType && contentType.includes('text/')) {
                try {
                    responseData = await response.text();
                } catch (e) {
                    // Failed to parse text
                }
            }

            const result: ApiResponse = {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                error: !response.ok ? response.statusText : null,
                headers: Object.fromEntries(response.headers.entries())
            };

            return await this.#processResponse(result);

        } catch (error: any) {
            const errorResponse: ApiResponse = {
                ok: false,
                status: null,
                statusText: error.name === 'AbortError' ? 'Request Timeout' : 'Network Error',
                data: null,
                error: error.name === 'AbortError' ? 'Request timed out' : error.message,
                headers: {}
            };

            return await this.#processResponse(errorResponse);
        }
    }

    /**
     * Make GET request
     * @param {string} url - Request URL
     * @param {Object} params - Query parameters (optional)
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    async get(url: string, params: Record<string, any> | null = null, options: RequestOptions = {}): Promise<ApiResponse> {
        const queryString = params ? this.#buildQueryString(params) : '';
        return this.#request(`${url}${queryString}`, {
            method: 'GET',
            headers: this.#getHeaders(options.headers),
            signal: options.signal
        });
    }

    /**
     * Make POST request
     * @param {string} url - Request URL
     * @param {Object|FormData} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    async post(url: string, data: any, options: RequestOptions = {}): Promise<ApiResponse> {
        const isFormData = data instanceof FormData;
        const headers = this.#getHeaders(options.headers);

        // Remove Content-Type for FormData (browser sets it with boundary)
        if (isFormData) {
            delete headers['Content-Type'];
        }

        return this.#request(url, {
            method: 'POST',
            headers: headers,
            body: isFormData ? data : JSON.stringify(data),
            signal: options.signal
        });
    }

    /**
     * Make PUT request
     * @param {string} url - Request URL
     * @param {Object|FormData} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    async put(url: string, data: any, options: RequestOptions = {}): Promise<ApiResponse> {
        const isFormData = data instanceof FormData;
        const headers = this.#getHeaders(options.headers);

        // Remove Content-Type for FormData (browser sets it with boundary)
        if (isFormData) {
            delete headers['Content-Type'];
        }

        return this.#request(url, {
            method: 'PUT',
            headers: headers,
            body: isFormData ? data : JSON.stringify(data),
            signal: options.signal
        });
    }

    /**
     * Make DELETE request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    async delete(url: string, options: RequestOptions = {}): Promise<ApiResponse> {
        const config: RequestInit = {
            method: 'DELETE',
            headers: this.#getHeaders(options.headers),
            signal: options.signal
        };

        return this.#request(url, config);
    }

    /**
     * Make PATCH request
     * @param {string} url - Request URL
     * @param {Object} data - Request body
     * @param {Object} options - Request options
     * @param {Object} options.headers - Custom headers for this request
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<Object>} Response object
     */
    async patch(url: string, data: any, options: RequestOptions = {}): Promise<ApiResponse> {
        return this.#request(url, {
            method: 'PATCH',
            headers: this.#getHeaders(options.headers),
            body: JSON.stringify(data),
            signal: options.signal
        });
    }

}
