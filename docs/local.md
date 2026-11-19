# Local Development Utilities

Run an AWS Lambda **Event Function** handler locally behind a plain Node.js HTTP
server.

## Overview

`Local.EventFunctionProxy` wraps a handler written for API Gateway HTTP API
(payload format 2.0) so ordinary HTTP requests drive it: each request is turned
into a format 2.0 event, and the handler's result is turned back into an HTTP
response.

A **Web Function** needs none of this. It already is an HTTP server and runs
locally as-is: `WebFunction.serve(router, { port: 3000 })`. See
[Deployment Modes](./deployment-modes.md).

## Installation

```typescript
import { Local } from '@designofadecade/server';
```

## Quick Start

```typescript
import http from 'http';
import { Local } from '@designofadecade/server';

// Your Event Function handler
const handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from Lambda!' }),
  };
};

// Wrap for local development
const localHandler = Local.EventFunctionProxy(handler, {
  requestContext: { stage: 'dev' },
});

// Create HTTP server
http
  .createServer((req, res) => {
    localHandler.request(req, res);
  })
  .listen(3000, () => {
    console.log('Local Event Function server listening on port 3000');
  });
```

## API Reference

### EventFunctionProxy()

```typescript
static EventFunctionProxy(
  eventFunctionHandler: (event: EventFunctionProxyEvent) => Promise<EventFunctionProxyResult | string>,
  options?: { requestContext?: Record<string, unknown>; event?: Record<string, unknown> }
): { request: (req: IncomingMessage, res: ServerResponse, requestOptions?) => Promise<void> }
```

Creates a proxy that wraps an Event Function handler for local development.

**Parameters:**

- `eventFunctionHandler` (function) - AWS Lambda handler function
- `options` (object, optional)
  - `requestContext` (object) - Additional `requestContext` fields merged into every event
  - `event` (object) - Additional top-level event fields merged into every event

**Returns:** Object with a `request` method for handling HTTP requests. `request`
accepts the same `{ requestContext, event }` overrides per call.

**Example:**

```typescript
const handler = Local.EventFunctionProxy(
  async (event) => {
    const body = JSON.parse(event.body || '{}');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: event.rawPath,
        method: event.requestContext.http.method,
        data: body,
      }),
    };
  },
  {
    requestContext: {
      stage: 'local',
      accountId: '123456789',
    },
    event: {
      version: '2.0',
    },
  }
);
```

## Event Format

The proxy converts HTTP requests to API Gateway HTTP API (format 2.0) events:

```typescript
interface EventFunctionProxyEvent {
  version: string; // Always '2.0'
  routeKey: string; // "<METHOD> <path>"
  rawPath: string; // Request path
  rawQueryString: string; // Encoded query string
  headers: Record<string, string | undefined>; // Repeated headers joined with ', '
  queryStringParameters: Record<string, string>;
  cookies: string[]; // ["name=value", ...], as API Gateway sends
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string; // HTTP method
      path: string; // Request path
      protocol: string;
      sourceIp: string; // The TCP peer address — never X-Forwarded-For
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string; // '$default' unless overridden
    time: string;
    timeEpoch: number;
    authorizer: unknown; // Authorization data
    // ...additional fields from options
  };
  body?: string; // Omitted when there is no body
  isBase64Encoded: boolean;
  // ...additional fields from options
}
```

The event carries every field AWS marks required on `APIGatewayProxyEventV2`,
so a handler typed with `@types/aws-lambda` can be wrapped directly:

```typescript
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const handler = async (event: APIGatewayProxyEventV2) => router.eventFunction(event);
const local = Local.EventFunctionProxy(handler);
```

Fields the local server cannot know (`accountId`, `apiId`, …) get placeholder
values. Override any of them with the `requestContext` option.

### `sourceIp` and `requestId`

`requestContext.http.sourceIp` is the socket's remote address, which is what
API Gateway reports for a deployed function. It is **not** read from
`X-Forwarded-For`: that header is whatever the client chose to send, so a
handler that rate-limits or authorizes on `sourceIp` would have been testable
against a forged address locally and then behave differently deployed.

Because it is the socket address, on a local machine it is usually `::1` or
`::ffff:127.0.0.1` rather than `127.0.0.1`; tests that compare it should accept
any loopback form or override it through the `requestContext` option.

`requestContext.requestId` is a fresh UUID per request, as API Gateway's is
unique per request.

## Response Format

Your handler should return:

```typescript
interface EventFunctionProxyResult {
  statusCode?: number; // HTTP status code
  headers?: Record<string, string | number | boolean>; // Response headers
  cookies?: string[]; // Set-Cookie headers
  body?: string; // Response body
  isBase64Encoded?: boolean; // For binary responses
}
```

As with API Gateway format 2.0, a return value with no `statusCode` (including
a bare string) is sent as `200` with `content-type: application/json` and the
value itself as the body.

## Complete Example

```typescript
import http from 'http';
import { Local } from '@designofadecade/server';

// Event Function handler with routing
const handler = async (event: any) => {
  const { method, path } = event.requestContext.http;

  if (path === '/users' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: [{ id: 1 }, { id: 2 }] }),
    };
  }

  if (path === '/users' && method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now(), ...body }),
    };
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ error: 'Not Found' }),
  };
};

// Wrap for local development
const localHandler = Local.EventFunctionProxy(handler, {
  requestContext: { stage: 'local' },
});

// Create server
const server = http.createServer((req, res) => {
  localHandler.request(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Event Function handler running locally on http://localhost:${PORT}`);
});
```

## With Router Integration

```typescript
import http from 'http';
import { Local, Router } from '@designofadecade/server';
import { UserRoutes, PostRoutes } from './routes.js';

// Create router (works in every deployment mode)
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes],
});

// For Event Function deployment
export const handler = async (event: any) => {
  return await router.eventFunction(event);
};

// For local development
if (process.env.NODE_ENV === 'development') {
  const localHandler = Local.EventFunctionProxy(handler);

  const server = http.createServer((req, res) => {
    localHandler.request(req, res);
  });

  server.listen(3000, () => {
    console.log('Local server running on port 3000');
  });
}
```

If the routes are built on this package's `Router`, consider skipping the proxy
entirely during development and running `WebFunction.serve(router, { port: 3000 })`.
The handler above and the Web Function share every route; only the entry file
differs.

## Request Context Examples

### Basic Context

```typescript
const handler = Local.EventFunctionProxy(lambdaHandler, {
  requestContext: {
    stage: 'dev',
    accountId: '123456789',
  },
});
```

### With Authorization

```typescript
const handler = Local.EventFunctionProxy(lambdaHandler, {
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          sub: 'user-123',
          email: 'user@example.com',
        },
      },
    },
  },
});
```

### Per-request overrides

```typescript
http.createServer((req, res) => {
  localHandler.request(req, res, {
    requestContext: { stage: req.headers['x-stage'] ?? '$default' },
  });
});
```

## Testing Event Function Handlers

```typescript
import { handler } from './lambda';

describe('Event Function handler', () => {
  it('should handle GET requests', async () => {
    const event = {
      rawPath: '/users',
      requestContext: {
        http: { method: 'GET', path: '/users', sourceIp: '127.0.0.1' },
        requestId: 'test-1',
      },
      headers: {},
      queryStringParameters: {},
      cookies: [],
      body: null,
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty('users');
  });
});
```

## Best Practices

1. **Environment Detection:** Only use `Local` in development

   ```typescript
   if (process.env.NODE_ENV === 'development') {
     const localHandler = Local.EventFunctionProxy(handler);
     // ...
   }
   ```

2. **Request Context:** Match the production API Gateway stage

   ```typescript
   const handler = Local.EventFunctionProxy(lambdaHandler, {
     requestContext: { stage: process.env.STAGE || 'dev' },
   });
   ```

3. **Use Router:** Prefer the `Router` class for anything beyond a toy handler

   ```typescript
   const router = new Router({ initRoutes: [Routes] });
   const handler = async (event) => router.eventFunction(event);
   ```

4. **Hot Reload:** Use `node --watch` or nodemon for development
   ```json
   {
     "scripts": {
       "dev": "node --watch --experimental-strip-types src/local.ts"
     }
   }
   ```

## Type Definitions

`EventFunctionProxyEvent` and `EventFunctionProxyResult` are exported from the
package root.

```typescript
interface EventFunctionProxyEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string | undefined>;
  queryStringParameters: Record<string, string>;
  cookies: string[];
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
    authorizer: unknown;
    [key: string]: unknown;
  };
  body?: string;
  isBase64Encoded: boolean;
  [key: string]: unknown;
}

interface EventFunctionProxyResult {
  statusCode?: number;
  headers?: Record<string, string | number | boolean>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}
```

## Development Workflow

```typescript
// lambda/handler.ts - Your Event Function handler
import { Router } from '@designofadecade/server';
import { AppRoutes } from './routes.js';

const router = new Router({ initRoutes: [AppRoutes] });

export const handler = async (event: any) => {
  return await router.eventFunction(event);
};

// local.ts - Local development server
import http from 'http';
import { Local } from '@designofadecade/server';
import { handler } from './lambda/handler.js';

const localHandler = Local.EventFunctionProxy(handler, {
  requestContext: { stage: 'local', accountId: '000000000000' },
});

const server = http.createServer((req, res) => {
  localHandler.request(req, res);
});

server.listen(3000, () => {
  console.log('Event Function handler running on http://localhost:3000');
});
```

## Related Documentation

- [Deployment Modes](./deployment-modes.md) - Web Function vs Event Function
- [Router](./router.md) - Request routing
- [Server](./server.md) - HTTP server
- [Context & State](./context-state.md) - Application context
