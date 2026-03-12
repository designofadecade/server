# Router

High-performance request router with URLPattern support, middleware, authentication, and both AWS Lambda and Node.js HTTP compatibility.

## Overview

The `Router` class provides enterprise-grade request routing with automatic body parsing, caching, middleware support, and seamless integration with both serverless (AWS Lambda) and traditional HTTP servers.

## Installation

```typescript
import Router from '@designofadecade/server/router';
import Routes from '@designofadecade/server/router/Routes';
```

## Quick Start

```typescript
import Router, { RouterRequest, RouterResponse } from '@designofadecade/server/router';
import Routes from '@designofadecade/server/router/Routes';

// Define your routes
class UserRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    
    // Add routes
    this.addRoute('/users', 'GET', this.listUsers);
    this.addRoute('/users/:id', 'GET', this.getUser);
    this.addRoute('/users', 'POST', this.createUser);
  }
  
  async listUsers(req: RouterRequest): Promise<RouterResponse> {
    return {
      status: 200,
      body: { users: [] }
    };
  }
  
  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const { id } = req.params;
    return {
      status: 200,
      body: { id, name: 'John Doe' }
    };
  }
  
  async createUser(req: RouterRequest): Promise<RouterResponse> {
    const userData = req.body;
    return {
      status: 201,
      body: { id: '123', ...userData }
    };
  }
}

// Initialize router
const router = new Router({
  initRoutes: [UserRoutes]
});
```

## API Reference

### Router Class

#### Constructor

```typescript
new Router(options?: RouterOptions)
```

**Options:**
- `context` (Context, optional) - Application context passed to routes
- `initRoutes` (Array, optional) - Array of Routes classes to register
- `bearerToken` (string, optional) - Token for bearer authentication
- `middleware` (Array, optional) - Global middleware functions

**Example:**
```typescript
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes],
  bearerToken: 'secret-token',
  middleware: [loggingMiddleware, authMiddleware]
});
```

### Methods

#### nodeJSRequest()

Handle Node.js HTTP requests.

```typescript
nodeJSRequest(
  req: IncomingMessage, 
  res: ServerResponse
): Promise<void>
```

**Example:**
```typescript
import Server from '@designofadecade/server';

const server = new Server(
  { port: 3000 },
  router.nodeJSRequest.bind(router)
);
```

#### lambdaEvent()

Handle AWS Lambda events (API Gateway HTTP format).

```typescript
lambdaEvent(event: LambdaHttpEvent): Promise<LambdaResponse>
```

**Example:**
```typescript
// AWS Lambda handler
export const handler = async (event) => {
  return await router.lambdaEvent(event);
};
```

#### decodeJwt()

Decode JWT token from Authorization header.

```typescript
decodeJwt(token: string): Record<string, unknown> | null
```

**Example:**
```typescript
const decoded = router.decodeJwt(request.headers.authorization);
if (decoded) {
  console.log('User ID:', decoded.sub);
}
```

## Routes Class

Base class for defining route groups.

### Static Properties

#### basePath

```typescript
static basePath: string = ''
```

Prefix for all routes in the class.

**Example:**
```typescript
class ApiRoutes extends Routes {
  static basePath = '/api';
  
  constructor(router: Router) {
    super(router);
    // /api/users
    this.addRoute('/users', 'GET', this.getUsers);
  }
}
```

#### register

```typescript
static register: Array<typeof Routes> = []
```

Nested route classes to automatically register.

**Example:**
```typescript
class ApiRoutes extends Routes {
  static basePath = '/api';
  static register = [UserRoutes, PostRoutes];
}
```

### Methods

#### addRoute()

```typescript
addRoute(
  path: string,
  methods: string | string[],
  handler: (request: RouterRequest) => Promise<RouterResponse>,
  middleware?: RouterMiddleware[]
): void
```

**Parameters:**
- `path` - Route path (supports URLPattern syntax)
- `methods` - HTTP method(s): GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- `handler` - Async function to handle the request
- `middleware` (optional) - Route-specific middleware

**Example:**
```typescript
// Single method
this.addRoute('/users', 'GET', this.getUsers);

// Multiple methods
this.addRoute('/users/:id', ['GET', 'PUT'], this.handleUser);

// With middleware
this.addRoute('/admin', 'GET', this.admin, [authMiddleware]);
```

## Request Object

```typescript
interface RouterRequest {
  path: string;              // Request path
  method: string;            // HTTP method
  body: unknown;             // Parsed request body
  cookies: Record<string, string>;
  params: Record<string, string>;  // URL parameters
  query: Record<string, string>;   // Query parameters
  headers: Record<string, string | string[] | undefined>;
  authorizer?: unknown;      // JWT decoded payload
  lambdaOptions?: unknown;   // Lambda-specific options
}
```

## Response Object

```typescript
interface RouterResponse {
  status?: number;           // HTTP status code (default: 200)
  headers?: Record<string, string>;
  body?: unknown;            // Response body (auto-serialized)
  isBase64Encoded?: boolean; // For binary responses
}
```

## URL Pattern Support

The router uses URLPattern for powerful route matching:

```typescript
// Path parameters
this.addRoute('/users/:id', 'GET', handler);
// Matches: /users/123
// req.params.id = '123'

// Wildcards
this.addRoute('/files/*', 'GET', handler);
// Matches: /files/any/path/here

// Optional segments
this.addRoute('/posts/:id?', 'GET', handler);
// Matches: /posts and /posts/123

// Regular expressions
this.addRoute('/products/:id(\\d+)', 'GET', handler);
// Matches: /products/123 (numbers only)
```

## Middleware

Middleware functions can modify requests or return early responses.

### Global Middleware

```typescript
const loggingMiddleware = async (req: RouterRequest) => {
  console.log(`${req.method} ${req.path}`);
  // Return nothing to continue
};

const authMiddleware = async (req: RouterRequest) => {
  if (!req.headers.authorization) {
    // Return response to short-circuit
    return {
      status: 401,
      body: { error: 'Unauthorized' }
    };
  }
};

const router = new Router({
  middleware: [loggingMiddleware, authMiddleware]
});
```

### Route-Specific Middleware

```typescript
const adminOnly = async (req: RouterRequest) => {
  if (!req.authorizer?.isAdmin) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
};

this.addRoute('/admin/users', 'GET', this.getUsers, [adminOnly]);
```

## Authentication

### Bearer Token

```typescript
const router = new Router({
  bearerToken: process.env.API_TOKEN
});
```

Requests must include: `Authorization: Bearer <token>`

### JWT Support

```typescript
class ProtectedRoutes extends Routes {
  async handler(req: RouterRequest): Promise<RouterResponse> {
    // JWT is automatically decoded and available as authorizer
    const userId = req.authorizer?.sub;
    const userEmail = req.authorizer?.email;
    
    return {
      status: 200,
      body: { userId, userEmail }
    };
  }
}
```

## Context Integration

Pass shared resources to routes using Context:

```typescript
import Context from '@designofadecade/server/context';

class AppContext extends Context {
  constructor(
    public database: Database,
    public cache: Redis
  ) {
    super();
  }
}

const context = new AppContext(db, redis);

const router = new Router({
  context,
  initRoutes: [UserRoutes]
});

class UserRoutes extends Routes {
  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const db = (this.context as AppContext).database;
    const user = await db.getUser(req.params.id);
    return { status: 200, body: user };
  }
}
```

## Error Handling

### Built-in Error Handling

The router automatically catches and handles errors:

```typescript
class UserRoutes extends Routes {
  async getUser(req: RouterRequest): Promise<RouterResponse> {
    // If this throws, router returns 500 with error details
    const user = await database.getUser(req.params.id);
    return { status: 200, body: user };
  }
}
```

### Error Handling with RouteError

```typescript
import RouteError from '@designofadecade/server/router/RouteError';

async getUser(req: RouterRequest): Promise<RouterResponse> {
  try {
    const user = await database.getUser(req.params.id);
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return { status: 200, body: user };
  } catch (error) {
    // Recommended: Use fromError() for automatic security and logging
    return RouteError.fromError(error, {
      defaultMessage: 'Error retrieving user',
      status: 404,
      context: { userId: req.params.id }
    });
  }
}
```

**Key Features of `fromError()`:**
- ✅ Automatically distinguishes safe vs unsafe errors
- ✅ Prevents leaking credentials, paths, and sensitive data
- ✅ Logs full error details internally
- ✅ Returns user-friendly messages when appropriate

See [RouteError documentation](./route-error.md) for comprehensive security features and usage examples.

### Error Codes

All router errors include codes for monitoring:
- `ROUTER_ERROR` - General routing errors
- `ROUTER_JWT_DECODE_ERROR` - JWT decoding failures
- `ROUTER_HANDLER_ERROR` - Handler execution errors

## Performance

### Route Caching

The router implements intelligent caching:
- Static routes cached indefinitely
- Dynamic routes cached up to 1000 entries (LRU)
- Cache automatically pruned when full

### Body Size Limits

- Maximum body size: 1MB
- Configurable via `Router.#MAX_BODY_SIZE`

## Best Practices

1. **Route Organization:** Group related routes in separate classes
   ```typescript
   class UserRoutes extends Routes {}
   class PostRoutes extends Routes {}
   class AdminRoutes extends Routes {
     static basePath = '/admin';
   }
   ```

2. **Middleware Order:** Place authentication before business logic
   ```typescript
   middleware: [loggingMiddleware, authMiddleware, rateLimitMiddleware]
   ```

3. **Error Handling:** Use RouteError.fromError() for secure error handling
   ```typescript
   try {
     const resource = await getResource(id);
     return { status: 200, body: resource };
   } catch (error) {
     return RouteError.fromError(error, {
       defaultMessage: 'Error retrieving resource',
       context: { resourceId: id }
     });
   }
   ```

4. **Context Usage:** Keep context immutable and lightweight
   ```typescript
   class AppContext extends Context {
     constructor(
       public readonly db: Database,
       public readonly config: Config
     ) {
       super();
     }
   }
   ```

5. **Response Bodies:** Return serializable objects
   ```typescript
   // Good
   return { status: 200, body: { data: users } };
   
   // Bad - functions not serializable
   return { status: 200, body: { process: () => {} } };
   ```

## Examples

### REST API

```typescript
class ProductRoutes extends Routes {
  static basePath = '/api/products';
  
  constructor(router: Router) {
    super(router);
    
    this.addRoute('', 'GET', this.list);
    this.addRoute('/:id', 'GET', this.get);
    this.addRoute('', 'POST', this.create);
    this.addRoute('/:id', 'PUT', this.update);
    this.addRoute('/:id', 'DELETE', this.delete);
  }
  
  async list(req: RouterRequest): Promise<RouterResponse> {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    
    const products = await this.getProducts(page, limit);
    
    return {
      status: 200,
      body: { products, page, limit }
    };
  }
  
  async create(req: RouterRequest): Promise<RouterResponse> {
    const product = await this.createProduct(req.body);
    
    return {
      status: 201,
      headers: { 'Location': `/api/products/${product.id}` },
      body: product
    };
  }
}
```

## Related Documentation

- [Server](./server.md) - HTTP server
- [Context](./context.md) - Application context
- [Logger](./logger.md) - Structured logging
- [RouteError](./route-error.md) - Custom errors
