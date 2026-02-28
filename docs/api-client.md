# ApiClient

Feature-rich HTTP client with retry logic, interceptors, authentication, and request/response transformation.

## Overview

`ApiClient` provides a powerful HTTP client built on the Fetch API with advanced features like automatic retry, request/response interception, authentication management, and comprehensive error handling.

## Installation

```typescript
import ApiClient from '@designofadecade/server/client';
```

## Quick Start

```typescript
import ApiClient from '@designofadecade/server/client';

// Create client
const client = new ApiClient('https://api.example.com');

// Set authentication
client.setAuthToken('your-token');

// Make requests
const users = await client.get('/users');
const user = await client.get('/users/123');

const newUser = await client.post('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

const updated = await client.put('/users/123', {
  name: 'Jane Doe'
});

await client.delete('/users/123');
```

## API Reference

### Constructor

```typescript
new ApiClient(baseUrl: string, options?: ApiClientOptions)
```

**Parameters:**
- `baseUrl` (string) - Base URL for all requests
- `options` (object, optional)
  - `timeout` (number) - Request timeout in milliseconds. Default: `30000`
  - `retryAttempts` (number) - Number of retry attempts. Default: `0`
  - `retryDelay` (number) - Delay between retries in milliseconds. Default: `1000`

**Example:**
```typescript
const client = new ApiClient('https://api.example.com', {
  timeout: 10000,      // 10 seconds
  retryAttempts: 3,    // Retry failed requests 3 times
  retryDelay: 2000     // Wait 2 seconds between retries
});
```

### HTTP Methods

#### get()

```typescript
get(path: string, params?: Record<string, any>, options?: RequestOptions): Promise<ApiResponse>
```

**Parameters:**
- `path` (string) - Request path (relative to base URL)
- `params` (object, optional) - Query parameters
- `options` (object, optional) - Request options

**Example:**
```typescript
// Simple GET
const users = await client.get('/users');

// With query parameters
const results = await client.get('/search', {
  q: 'javascript',
  page: 1,
  limit: 10
});
// Requests: /search?q=javascript&page=1&limit=10

// With custom headers
const data = await client.get('/data', {}, {
  headers: { 'Accept-Language': 'en-US' }
});
```

#### post()

```typescript
post(path: string, data?: any, options?: RequestOptions): Promise<ApiResponse>
```

**Parameters:**
- `path` (string) - Request path
- `data` (any, optional) - Request body (auto-serialized to JSON)
- `options` (object, optional) - Request options

**Example:**
```typescript
// Create resource
const newUser = await client.post('/users', {
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Empty body
const result = await client.post('/trigger');

// Custom content type
const response = await client.post('/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
```

#### put()

```typescript
put(path: string, data?: any, options?: RequestOptions): Promise<ApiResponse>
```

**Parameters:**
- `path` (string) - Request path
- `data` (any, optional) - Request body
- `options` (object, optional) - Request options

**Example:**
```typescript
// Update resource
const updated = await client.put('/users/123', {
  name: 'Jane Doe',
  email: 'jane@example.com'
});
```

#### patch()

```typescript
patch(path: string, data?: any, options?: RequestOptions): Promise<ApiResponse>
```

**Parameters:**
- `path` (string) - Request path
- `data` (any, optional) - Request body (partial update)
- `options` (object, optional) - Request options

**Example:**
```typescript
// Partial update
const updated = await client.patch('/users/123', {
  email: 'newemail@example.com'
});
```

#### delete()

```typescript
delete(path: string, options?: RequestOptions): Promise<ApiResponse>
```

**Parameters:**
- `path` (string) - Request path
- `options` (object, optional) - Request options

**Example:**
```typescript
// Delete resource
await client.delete('/users/123');

// Delete with query params
await client.delete('/users/123', {
  headers: { 'X-Reason': 'User requested deletion' }
});
```

### Authentication

#### setAuthToken()

```typescript
setAuthToken(token: string, type?: string): void
```

Set authentication token for all requests.

**Parameters:**
- `token` (string) - Authentication token
- `type` (string, optional) - Token type. Default: `'Bearer'`

**Example:**
```typescript
// Bearer token (default)
client.setAuthToken('your-jwt-token');
// Adds header: Authorization: Bearer your-jwt-token

// Custom token type
client.setAuthToken('api-key-123', 'ApiKey');
// Adds header: Authorization: ApiKey api-key-123

// Basic auth (encode first)
const encoded = btoa('username:password');
client.setAuthToken(encoded, 'Basic');
```

#### clearAuthToken()

```typescript
clearAuthToken(): void
```

Remove authentication token.

**Example:**
```typescript
// User logout
client.clearAuthToken();
```

### Headers

#### setDefaultHeaders()

```typescript
setDefaultHeaders(headers: Record<string, string>): void
```

Set default headers for all requests.

**Example:**
```typescript
client.setDefaultHeaders({
  'Accept-Language': 'en-US',
  'X-App-Version': '1.0.0',
  'X-Device-ID': deviceId
});
```

### Interceptors

#### addRequestInterceptor()

```typescript
addRequestInterceptor(interceptor: RequestInterceptor): void
```

Add a function to modify requests before they're sent.

**Example:**
```typescript
// Add timestamp to all requests
client.addRequestInterceptor((config) => {
  return {
    ...config,
    headers: {
      ...config.headers,
      'X-Request-Time': Date.now().toString()
    }
  };
});

// Add request ID
client.addRequestInterceptor(async (config) => {
  const requestId = await generateRequestId();
  return {
    ...config,
    headers: {
      ...config.headers,
      'X-Request-ID': requestId
    }
  };
});
```

#### addResponseInterceptor()

```typescript
addResponseInterceptor(interceptor: ResponseInterceptor): void
```

Add a function to transform responses.

**Example:**
```typescript
// Transform data format
client.addResponseInterceptor((response) => {
  if (response.ok && response.data) {
    return {
      ...response,
      data: transformData(response.data)
    };
  }
  return response;
});

// Log slow requests
client.addResponseInterceptor((response) => {
  const duration = Date.now() - response.requestStartTime;
  if (duration > 1000) {
    console.warn(`Slow request: ${duration}ms`);
  }
  return response;
});
```

## Response Format

```typescript
interface ApiResponse {
  ok: boolean;                    // true if status 200-299
  status: number | null;          // HTTP status code
  statusText: string;             // HTTP status text
  data: any;                      // Response body (parsed JSON)
  error: string | null;           // Error message if failed
  headers: Record<string, string>; // Response headers
}
```

**Example Response:**
```typescript
// Successful response
{
  ok: true,
  status: 200,
  statusText: 'OK',
  data: { id: 123, name: 'John' },
  error: null,
  headers: { 'content-type': 'application/json' }
}

// Error response
{
  ok: false,
  status: 404,
  statusText: 'Not Found',
  data: { message: 'User not found' },
  error: 'Not Found',
  headers: { 'content-type': 'application/json' }
}
```

## Error Handling

```typescript
const response = await client.get('/users/123');

if (response.ok) {
  // Success
  console.log('User:', response.data);
} else {
  // Error
  console.error(`Error ${response.status}: ${response.error}`);
}
```

### Specific Status Codes

```typescript
const response = await client.get('/resource');

switch (response.status) {
  case 200:
    // Success
    break;
  case 401:
    // Unauthorized - redirect to login
    break;
  case 404:
    // Not found
    break;
  case 500:
    // Server error - show error message
    break;
}
```

### Try-Catch Pattern

```typescript
try {
  const response = await client.post('/users', userData);
  
  if (!response.ok) {
    throw new Error(`API error: ${response.error}`);
  }
  
  return response.data;
} catch (error) {
  console.error('Request failed:', error);
  throw error;
}
```

## Retry Logic

Automatic retry for failed requests:

```typescript
const client = new ApiClient('https://api.example.com', {
  retryAttempts: 3,
  retryDelay: 1000
});

// Will retry up to 3 times on failure
const data = await client.get('/unreliable-endpoint');
```

**Retry Strategy:**
- Retries on network errors
- Retries on 5xx server errors
- Does not retry on 4xx client errors
- Uses exponential backoff

## Timeout Handling

```typescript
const client = new ApiClient('https://api.example.com', {
  timeout: 5000 // 5 seconds
});

const response = await client.get('/slow-endpoint');

if (response.error === 'Request timeout') {
  console.log('Request took too long');
}
```

## Best Practices

1. **Reuse Client Instances:** Create once, reuse across app
   ```typescript
   // Good - single instance
   export const apiClient = new ApiClient('https://api.example.com');
   
   // Bad - new instance per request
   const client = new ApiClient('https://api.example.com');
   ```

2. **Error Handling:** Always check response.ok
   ```typescript
   const response = await client.get('/data');
   if (!response.ok) {
     // Handle error
     return;
   }
   // Use response.data
   ```

3. **Authentication:** Set token once after login
   ```typescript
   async function login(credentials) {
     const response = await client.post('/auth/login', credentials);
     if (response.ok) {
       client.setAuthToken(response.data.token);
     }
   }
   ```

4. **Request Interceptors:** Use for cross-cutting concerns
   ```typescript
   // Add to all requests
   client.addRequestInterceptor((config) => ({
     ...config,
     headers: {
       ...config.headers,
       'X-Client-Version': APP_VERSION
     }
   }));
   ```

5. **Response Transformation:** Centralize data transformation
   ```typescript
   client.addResponseInterceptor((response) => {
     if (response.ok && response.data) {
       // Transform snake_case to camelCase
       return {
         ...response,
         data: transformKeys(response.data)
       };
     }
     return response;
   });
   ```

## Examples

### REST API Client

```typescript
import ApiClient from '@designofadecade/server/client';

class UserApiClient {
  private client: ApiClient;
  
  constructor(baseUrl: string, apiKey: string) {
    this.client = new ApiClient(baseUrl, {
      timeout: 10000,
      retryAttempts: 2
    });
    
    this.client.setAuthToken(apiKey, 'Bearer');
  }
  
  async getUsers(page: number = 1, limit: number = 10) {
    const response = await this.client.get('/users', { page, limit });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.error}`);
    }
    
    return response.data;
  }
  
  async getUser(id: string) {
    const response = await this.client.get(`/users/${id}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch user: ${response.error}`);
    }
    
    return response.data;
  }
  
  async createUser(userData: any) {
    const response = await this.client.post('/users', userData);
    
    if (!response.ok) {
      throw new Error(`Failed to create user: ${response.error}`);
    }
    
    return response.data;
  }
  
  async updateUser(id: string, updates: any) {
    const response = await this.client.patch(`/users/${id}`, updates);
    
    if (!response.ok) {
      throw new Error(`Failed to update user: ${response.error}`);
    }
    
    return response.data;
  }
  
  async deleteUser(id: string) {
    const response = await this.client.delete(`/users/${id}`);
    
    if (!response.ok) {
      throw new Error(`Failed to delete user: ${response.error}`);
    }
    
    return true;
  }
}

// Usage
const userApi = new UserApiClient('https://api.example.com', 'api-key');

const users = await userApi.getUsers(1, 20);
const user = await userApi.getUser('123');
await userApi.updateUser('123', { name: 'New Name' });
```

### With Request Logging

```typescript
const client = new ApiClient('https://api.example.com');

// Log all requests
client.addRequestInterceptor((config) => {
  console.log(`→ ${config.method} ${config.url}`);
  return config;
});

// Log all responses
client.addResponseInterceptor((response) => {
  console.log(`← ${response.status} ${response.statusText}`);
  return response;
});
```

### With Token Refresh

```typescript
let accessToken = 'initial-token';
let refreshToken = 'refresh-token';

const client = new ApiClient('https://api.example.com');
client.setAuthToken(accessToken);

// Auto-refresh on 401
client.addResponseInterceptor(async (response) => {
  if (response.status === 401) {
    // Token expired, refresh it
    const refreshResponse = await fetch('https://api.example.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    
    if (refreshResponse.ok) {
      const { accessToken: newToken } = await refreshResponse.json();
      client.setAuthToken(newToken);
      accessToken = newToken;
      
      // Retry original request
      // (Implementation depends on storing original request details)
    }
  }
  
  return response;
});
```

## Type Definitions

```typescript
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

type RequestInterceptor = (
  config: RequestInit & { signal: AbortSignal }
) => Promise<RequestInit & { signal: AbortSignal }> | RequestInit & { signal: AbortSignal>;

type ResponseInterceptor = (
  response: ApiResponse
) => Promise<ApiResponse> | ApiResponse;
```

## Related Documentation

- [Router](./router.md) - Server-side routing
- [Logger](./logger.md) - Request logging
- [Context](./context.md) - Application context
