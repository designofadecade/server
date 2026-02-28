# Local Development Utilities

Utilities for running AWS Lambda handlers locally with Node.js HTTP server.

## Overview

The `Local` class provides utilities to run AWS Lambda handlers locally during development, automatically converting between HTTP requests and Lambda event format.

## Installation

```typescript
import Local from '@designofadecade/server/local';
```

## Quick Start

```typescript
import http from 'http';
import Local from '@designofadecade/server/local';

// Your Lambda handler
const lambdaHandler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from Lambda!' })
  };
};

// Wrap for local development
const localHandler = Local.LambdaProxyRouter(lambdaHandler, {
  requestContext: { stage: 'dev' }
});

// Create HTTP server
http.createServer((req, res) => {
  localHandler.request(req, res);
}).listen(3000, () => {
  console.log('Local Lambda server listening on port 3000');
});
```

## API Reference

### LambdaProxyRouter()

```typescript
static LambdaProxyRouter(
  LambdaHandler: (event: LambdaEvent) => Promise<LambdaResponse>,
  options?: LambdaProxyRouterOptions
): { request: (req: IncomingMessage, res: ServerResponse) => Promise<void> }
```

Creates a router that wraps AWS Lambda handlers for local development.

**Parameters:**
- `LambdaHandler` (function) - AWS Lambda handler function
- `options` (object, optional)
  - `requestContext` (object) - Additional requestContext fields
  - `event` (object) - Additional event fields

**Returns:** Object with `request` method for handling HTTP requests

**Example:**
```typescript
const handler = Local.LambdaProxyRouter(
  async (event) => {
    const body = JSON.parse(event.body || '{}');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: event.rawPath,
        method: event.requestContext.http.method,
        data: body
      })
    };
  },
  {
    requestContext: {
      stage: 'local',
      accountId: '123456789'
    },
    event: {
      version: '2.0'
    }
  }
);
```

## Lambda Event Format

The utility converts HTTP requests to AWS Lambda HTTP API (v2.0) format:

```typescript
interface LambdaEvent {
  rawPath: string;                          // Request path
  headers: Record<string, string>;          // HTTP headers
  queryStringParameters: Record<string, string>;
  cookies: Record<string, string>;          // Parsed cookies
  requestContext: {
    http: {
      method: string;                       // HTTP method
      path: string;                         // Request path
    };
    authorizer: unknown;                    // Authorization data
    // ...additional fields from options
  };
  body: string | null;                      // Request body
  // ...additional fields from options
}
```

## Lambda Response Format

Your Lambda handler should return:

```typescript
interface LambdaResponse {
  statusCode: number;                       // HTTP status code
  headers?: Record<string, string>;         // Response headers
  cookies?: string[];                       // Set-Cookie headers
  body?: string;                            // Response body
  isBase64Encoded?: boolean;                // For binary responses
}
```

## Complete Example

```typescript
import http from 'http';
import Local from '@designofadecade/server/local';

// Lambda handler with routing
const handler = async (event: any) => {
  const { method, path } = event.requestContext.http;
  
  // Route based on path and method
  if (path === '/users' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' }
        ]
      })
    };
  }
  
  if (path.startsWith('/users/') && method === 'GET') {
    const id = path.split('/')[2];
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: 'John Doe'
      })
    };
  }
  
  if (path === '/users' && method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: Date.now(),
        ...body
      })
    };
  }
  
  return {
    statusCode: 404,
    body: JSON.stringify({ error: 'Not Found' })
  };
};

// Wrap for local development
const localHandler = Local.LambdaProxyRouter(handler, {
  requestContext: {
    stage: 'local',
    requestId: () => Math.random().toString(36)
  }
});

// Create server
const server = http.createServer((req, res) => {
  localHandler.request(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lambda handler running locally on http://localhost:${PORT}`);
});
```

## With Router Integration

The Local utility works seamlessly with the Router class:

```typescript
import Local from '@designofadecade/server/local';
import Router from '@designofadecade/server/router';
import { UserRoutes, PostRoutes } from './routes';

// Create router (works for both Lambda and HTTP)
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes]
});

// For Lambda deployment
export const handler = async (event: any) => {
  return await router.lambdaEvent(event);
};

// For local development
if (process.env.NODE_ENV === 'development') {
  const localHandler = Local.LambdaProxyRouter(handler);
  
  const server = http.createServer((req, res) => {
    localHandler.request(req, res);
  });
  
  server.listen(3000, () => {
    console.log('Local server running on port 3000');
  });
}
```

## Request Context Examples

### Basic Context

```typescript
const handler = Local.LambdaProxyRouter(lambdaHandler, {
  requestContext: {
    stage: 'dev',
    accountId: '123456789',
    region: 'us-east-1'
  }
});
```

### With Authorization

```typescript
const handler = Local.LambdaProxyRouter(lambdaHandler, {
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          sub: 'user-123',
          email: 'user@example.com'
        }
      }
    }
  }
});
```

### Dynamic Values

```typescript
const handler = Local.LambdaProxyRouter(lambdaHandler, {
  requestContext: {
    requestId: () => Math.random().toString(36).substring(7),
    timeEpoch: () => Date.now()
  }
});
```

## Testing Lambda Handlers

```typescript
import Local from '@designofadecade/server/local';
import { handler } from './lambda';

describe('Lambda Handler', () => {
  it('should handle GET requests', async () => {
    // Create test event
    const event = {
      rawPath: '/users',
      requestContext: {
        http: { method: 'GET', path: '/users' }
      },
      headers: {},
      queryStringParameters: {},
      cookies: {},
      body: null
    };
    
    const response = await handler(event);
    
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty('users');
  });
});
```

## Best Practices

1. **Environment Detection:** Only use Local in development
   ```typescript
   if (process.env.NODE_ENV === 'development') {
     // Local development setup
     const localHandler = Local.LambdaProxyRouter(handler);
     // ...
   }
   ```

2. **Request Context:** Match production Lambda context structure
   ```typescript
   const handler = Local.LambdaProxyRouter(lambdaHandler, {
     requestContext: {
       stage: process.env.STAGE || 'dev',
       // Match your actual Lambda configuration
     }
   });
   ```

3. **Use Router:** Prefer Router class for complex applications
   ```typescript
   // Better for complex apps
   const router = new Router({ initRoutes: [Routes] });
   const handler = async (event) => router.lambdaEvent(event);
   ```

4. **Hot Reload:** Use nodemon for development
   ```json
   {
     "scripts": {
       "dev": "nodemon --exec node --loader ts-node/esm src/local.ts"
     }
   }
   ```

## Type Definitions

```typescript
interface LambdaProxyRouterOptions {
  requestContext?: Record<string, unknown>;
  event?: Record<string, unknown>;
}

interface LambdaEvent {
  rawPath: string;
  headers: Record<string, string | string[] | undefined>;
  queryStringParameters: Record<string, string>;
  cookies: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
    authorizer: unknown;
    [key: string]: unknown;
  };
  body: string | null;
  [key: string]: unknown;
}

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}
```

## Development Workflow

```typescript
// lambda/handler.ts - Your Lambda handler
import Router from '@designofadecade/server/router';
import { AppRoutes } from './routes';

const router = new Router({
  initRoutes: [AppRoutes]
});

export const handler = async (event: any) => {
  return await router.lambdaEvent(event);
};

// local.ts - Local development server
import http from 'http';
import Local from '@designofadecade/server/local';
import { handler } from './lambda/handler';

const localHandler = Local.LambdaProxyRouter(handler, {
  requestContext: {
    stage: 'local',
    accountId: '000000000000'
  }
});

const server = http.createServer((req, res) => {
  localHandler.request(req, res);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Lambda handler running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});

// package.json
{
  "scripts": {
    "dev": "node --loader ts-node/esm local.ts",
    "dev:watch": "nodemon --exec 'node --loader ts-node/esm' local.ts"
  }
}
```

## Related Documentation

- [Router](./router.md) - Request routing
- [Server](./server.md) - HTTP server
- [Context](./context.md) - Application context
