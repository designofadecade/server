# Router

High-performance request router with URLPattern support, middleware, authentication, and one set of routes for every deployment mode: AWS Lambda Web Functions, Lambda Event Functions (API Gateway HTTP API v2) and plain Node.js HTTP servers.

## Overview

The `Router` class provides request routing with automatic body parsing, caching, middleware support, and the same handlers in all three [deployment modes](./deployment-modes.md). `nodeJSRequest` serves a Web Function or a plain server; `eventFunction` serves an API Gateway event.

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
      body: { users: [] },
    };
  }

  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const { id } = req.params;
    return {
      status: 200,
      body: { id, name: 'John Doe' },
    };
  }

  async createUser(req: RouterRequest): Promise<RouterResponse> {
    const userData = req.body;
    return {
      status: 201,
      body: { id: '123', ...userData },
    };
  }
}

// Initialize router
const router = new Router({
  initRoutes: [UserRoutes],
});
```

## API Reference

### Router Class

#### Constructor

```typescript
new Router(options?: RouterOptions)
```

**Options:**

- `context` (ContextLike, optional) - Application context passed to routes
- `initRoutes` (Array, optional) - Array of Routes classes to register
- `bearerToken` (string, optional) - Token for bearer authentication
- `middleware` (Array, optional) - Global middleware functions
- `jwt` (JwtOptions, optional) - JWT verification for the Node.js path; see [JWT Support](#jwt-support)
- `webFunction` (boolean, optional) - Treat Node requests as arriving through a
  Lambda Web Function endpoint: read `clientIp` from `X-Forwarded-For` and
  `requestId` from `lambda-web-request-id`. Default: `true` when
  `AWS_LAMBDA_HTTP_ENDPOINT` is set, `false` otherwise. Never force it on for a
  server clients reach directly; those headers are only trustworthy because
  Lambda strips and rewrites them.
- `trustedProxies` (integer, optional) - Web Function only. The number of
  proxies you control between the client and the Lambda endpoint (CloudFront in
  front of the endpoint = `1`). Each appends its own entry to `X-Forwarded-For`,
  so the client is that many entries before the last. Default: `0`. No effect on
  a plain server or an Event Function. Throws if negative or not an integer.
  **Only safe when the endpoint cannot be reached except through those
  proxies** (CloudFront: `IamAuth` on the endpoint, invoke permission granted
  only to your distribution). If clients can call the endpoint directly, they
  choose the entry this reads.

**Example:**

```typescript
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes],
  bearerToken: 'secret-token',
  middleware: [loggingMiddleware, authMiddleware],
  trustedProxies: 1, // CloudFront fronts the Web Function endpoint
});
```

### Methods

#### nodeJSRequest()

Handle Node.js HTTP requests: a plain server, or a Lambda Web Function (which
is a plain HTTP/1.1 server Lambda starts for you).

```typescript
nodeJSRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options?: {
    cors?: boolean | string[];
    proxyOptions?: Record<string, unknown>;
  }
): Promise<void>
```

`proxyOptions` is passed through untouched as `request.proxyOptions`; it exists
for transport shims such as `Local.EventFunctionProxy` and is not needed by
ordinary applications.

Request bodies are capped at 1 MB; larger bodies are rejected before a route
runs.

**Example:**

```typescript
import { Router, Server, WebFunction } from '@designofadecade/server';

// Explicit
const server = new Server({ port: 3000 }, (req, res) => router.nodeJSRequest(req, res));

// Or the one-liner that also runs as a Lambda Web Function
const server = WebFunction.serve(router, { port: 3000 });
```

##### CORS

`cors` accepts either a boolean or an array of allowed origins:

```typescript
// Anonymous access from anywhere. Sends `Access-Control-Allow-Origin: *`
// and does NOT send credentials, so cookies are not exchanged.
router.nodeJSRequest(req, res, { cors: true });

// Credentialed access from specific origins. The Origin header is reflected
// only when it appears in the list, and `Vary: Origin` is set.
router.nodeJSRequest(req, res, {
  cors: ['https://app.example.com', 'https://admin.example.com'],
});
```

Pass an allowlist whenever requests carry cookies or an `Authorization` header.
Never reflect an arbitrary `Origin` alongside
`Access-Control-Allow-Credentials: true` — that combination lets any website
make authenticated cross-origin calls as the signed-in user and read the
response.

With an allowlist, a request whose `Origin` is not on it and is not
same-origin is handled as follows:

| Method                                                   | Result                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPTIONS` (preflight)                                    | `403`, no CORS headers, so the browser never sends the real request                                                                                 |
| `POST`, `PUT`, `PATCH`, `DELETE`, anything else not safe | `403` with `{ success: false, error: { code: 'CORS_ORIGIN_FORBIDDEN', message } }`, refused before the body is read or any middleware or route runs |
| `GET`, `HEAD`                                            | The route runs; CORS headers are withheld, so the other site cannot read the response                                                               |

Every response to an allowlist request carries `Vary: Origin`, the 403s
included. Each refusal logs `ROUTER_CORS_ORIGIN_BLOCKED` at `warn` (the
origin truncated to 200 characters; it is never echoed in the response).
Requests with no `Origin` header (curl, server-to-server calls) are not
checked.

Browsers send `Origin` on same-origin `POST`s as well, so the site's own pages
are never refused even when their origin is not on the list. A request counts
as same-origin when:

- the browser sent `Sec-Fetch-Site: same-origin` (if it sent any other
  `Sec-Fetch-Site` value, such as `same-site` or `cross-site`, that verdict
  stands even if the Host matches); or
- with no `Sec-Fetch-Site`, the `Origin`'s `host:port` equals the request's
  `Host` header (case-insensitive).

An `Origin` that does not parse, including `null` (sandboxed frames, `file://`),
never counts as same-origin. Behind a proxy that rewrites `Host`, older
browsers that send no `Sec-Fetch-Site` fall back to the Host comparison and are
refused; add the site's public origin to the allowlist to cover them.

`cors: true` and no `cors` at all apply no origin check: every method runs from
every origin, as before.

CORS is a read-protection mechanism, not a complete CSRF defence. The allowlist
check above stops forged writes from browsers, but a cookie-authenticated app
should still use `SameSite=Lax` or `Strict` cookies and, for anything
sensitive, a CSRF token. The Event Function path (`eventFunction`) does no CORS
or origin handling at all: configure CORS on API Gateway and check `Origin` /
`Sec-Fetch-Site` in route middleware if the API uses cookies.

#### eventFunction()

Handle an API Gateway HTTP API (payload format 2.0) event: the Lambda **Event
Function** model. Called `lambdaEvent()` before 11.0.

```typescript
eventFunction(event: EventFunctionEvent): Promise<EventFunctionResult>
```

`EventFunctionEvent` is structural and accepts `APIGatewayProxyEventV2` from
`@types/aws-lambda` directly, so a conventionally typed handler needs no cast:

**Example:**

```typescript
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// AWS Lambda handler
export const handler = async (event: APIGatewayProxyEventV2) => {
  return await router.eventFunction(event);
};
```

`queryStringParameters` is typed `Record<string, string | undefined>` to match
what API Gateway actually sends. Parameters with no value are dropped before
handlers see them, so `request.query` remains `Record<string, string>`.

`request.clientIp` is `requestContext.http.sourceIp` and `request.requestId`
is `requestContext.requestId`, both set by API Gateway. Response cookies set
through an array-valued `set-cookie` header are lifted into the format 2.0
`cookies` field.

Both `EventFunctionEvent` and `EventFunctionResult` are exported from the
package root if you need to name them.

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
  path: string; // Request path
  method: string; // HTTP method
  body: unknown; // Parsed request body
  cookies: Record<string, string>;
  params: Record<string, string>; // URL parameters
  query: Record<string, string>; // Query parameters
  headers: Record<string, string | string[] | undefined>;
  clientIp: string; // Caller's address; '' when unknown
  requestId: string; // Correlation id for logs
  authorizer?: unknown; // Verified JWT claims / API Gateway authorizer
  proxyOptions?: unknown; // Transport options from a proxy such as Local.EventFunctionProxy
  route?: string; // Matched route pattern ('/users/:id'); unset when nothing matched
}
```

`route` is set by the router, in every deployment mode, before global
middleware runs: it is the registered path of the matched route, with repeated
slashes collapsed. It does not come from the event's `routeKey` (which is
`$default` or a proxy route behind a catch-all integration). It holds no
request values, so it is what `logRequest` logs instead of the raw path. It is
optional so request objects built by hand (in tests) need not set it.

### `clientIp`

Populated from a source the caller cannot forge in the current mode:

| Mode              | Source                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Event Function    | `requestContext.http.sourceIp`, set by API Gateway                                      |
| Web Function      | The **last** `X-Forwarded-For` entry (Lambda appends it), minus `trustedProxies` hops   |
| Plain Node server | `socket.remoteAddress`; `X-Forwarded-For` is never read, because nothing vouches for it |

Reading the first `X-Forwarded-For` value, the common idiom, hands the client
the choice of its own IP. The router never does that. If a reverse proxy you
control sits in front of a plain server, terminate it at the proxy and pass the
address in a header you validate yourself.

In Web Function mode the selected entry is accepted only if it is a literal
IPv4 or IPv6 address (`net.isIP`); otherwise `clientIp` is `''`. This matters
with `trustedProxies > 0`: that setting is **only safe when nothing can reach
the endpoint except your proxies** (for CloudFront, `IamAuth` on the endpoint
with invoke permission granted only to the distribution). On a directly
reachable endpoint the entry one hop back is client text, and the IP check is
the last line of defence against it carrying something other than an address.

An empty `AWS_LAMBDA_HTTP_ENDPOINT` counts as unset: `webFunction` defaults to
`false` and the socket address is used.

### `requestId`

API Gateway's `requestId` in Event Function mode; Lambda's
`lambda-web-request-id` in Web Function mode (Lambda strips any client-sent
`lambda-web-*` header before adding its own, so it cannot be forged); a fresh
UUID on a plain server. Hand the `RouterRequest` to `createRequestLogger` and it
is attached to every log line.

Code that builds `RouterRequest` objects by hand (unit tests, custom
transports) must supply both fields; they are required.

## Response Object

```typescript
interface RouterResponse {
  status?: number; // HTTP status code (default: 200)
  headers?: Record<string, string | string[]>; // An array repeats the header (set-cookie)
  body?: unknown; // Response body (auto-serialized)
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
      body: { error: 'Unauthorized' },
    };
  }
};

const router = new Router({
  middleware: [loggingMiddleware, authMiddleware],
});
```

### Route-Specific Middleware

```typescript
// req.authorizer is populated only from a verified token (see JWT Support).
// It is null when no `jwt` option is configured or verification failed.
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
  bearerToken: process.env.API_TOKEN,
});
```

Requests must include: `Authorization: Bearer <token>`

### JWT Support

JWTs are verified before their claims are exposed. Configure verification with
the `jwt` option; without it, `request.authorizer` is always `null`.

```typescript
// HMAC (HS256 by default) using a shared secret
const router = new Router({
  initRoutes: [ProtectedRoutes],
  jwt: { secret: process.env.JWT_SECRET },
});

// Restrict the accepted algorithms, and allow 30s of clock skew
const router = new Router({
  jwt: {
    secret: process.env.JWT_SECRET,
    algorithms: ['HS512'],
    clockToleranceSec: 30,
  },
});

// RS256 / ES256 / JWKS — plug in any verifier you already use
const router = new Router({
  jwt: {
    verify: async (token) => {
      // return the claims for a valid token, or null to reject it
      return await myJwtLibrary.verify(token, publicKey);
    },
  },
});
```

The built-in verifier checks the HMAC signature in constant time, refuses any
algorithm not on the allowlist (so `alg: none` and algorithm-confusion
forgeries are rejected), and honours `exp` and `nbf`. A token that fails any of
these checks leaves `request.authorizer` as `null` rather than raising — guard
your routes on its presence.

> **Upgrading from 6.x:** earlier versions base64-decoded the token payload and
> exposed it as `request.authorizer` **without checking the signature**, so any
> caller could choose their own claims. If you gate routes on `req.authorizer`,
> you must now pass a `jwt` option or those checks will see `null` and deny
> every request.

```typescript
class ProtectedRoutes extends Routes {
  async handler(req: RouterRequest): Promise<RouterResponse> {
    // JWT is automatically decoded and available as authorizer
    const userId = req.authorizer?.sub;
    const userEmail = req.authorizer?.email;

    return {
      status: 200,
      body: { userId, userEmail },
    };
  }
}
```

## Context Integration

Pass shared resources to routes using Context:

```typescript
import type { ContextLike } from '@designofadecade/server';

interface AppContext extends ContextLike {
  database: Database;
  cache: Redis;
}

const context: AppContext = { database: db, cache: redis };

const router = new Router({
  context,
  initRoutes: [UserRoutes],
});

// Narrow the context in the constructor and handlers read it without a cast.
class UserRoutes extends Routes {
  constructor(
    router: Router,
    private ctx?: AppContext
  ) {
    super(router, ctx);
  }

  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const user = await this.ctx!.database.getUser(req.params.id);
    return { status: 200, body: user };
  }
}
```

`RouterOptions.context` accepts any object shape (`ContextLike`). The abstract
`Context` class still works if you want its lifecycle hooks — see
[Context & State](./context-state.md).

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

- Maximum request body on the Node path (`nodeJSRequest`, so plain server and Web Function): 1 MB. Larger bodies are rejected. Not currently configurable.
- JWT claims are exposed only after verification: configure `jwt` (see `RouterOptions`); there is no decode-without-verify helper.

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
   middleware: [loggingMiddleware, authMiddleware, rateLimitMiddleware];
   ```

3. **Error Handling:** Use RouteError.fromError() for secure error handling

   ```typescript
   try {
     const resource = await getResource(id);
     return { status: 200, body: resource };
   } catch (error) {
     return RouteError.fromError(error, {
       defaultMessage: 'Error retrieving resource',
       context: { resourceId: id },
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
      body: { products, page, limit },
    };
  }

  async create(req: RouterRequest): Promise<RouterResponse> {
    const product = await this.createProduct(req.body);

    return {
      status: 201,
      headers: { Location: `/api/products/${product.id}` },
      body: product,
    };
  }
}
```

## Related Documentation

- [Deployment Modes](./deployment-modes.md) - Web Function vs Event Function vs plain server
- [Server](./server.md) - HTTP server and `WebFunction.serve`
- [Local Development](./local.md) - Running Event Function handlers locally
- [Context & State](./context-state.md) - Application context
- [Logger](./logger.md) - Structured logging
- [RouteError](./route-error.md) - Custom errors
