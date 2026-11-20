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
  // Loopback only: other machines cannot even connect.
  .listen(3000, '127.0.0.1', () => {
    console.log('Local Event Function server listening on http://127.0.0.1:3000');
  });
```

## API Reference

### EventFunctionProxy()

```typescript
static EventFunctionProxy(
  eventFunctionHandler: (event: EventFunctionProxyEvent) => Promise<EventFunctionProxyResult | string>,
  options?: EventFunctionProxyOptions
): { request: (req: IncomingMessage, res: ServerResponse, requestOptions?) => Promise<void> }
```

Creates a proxy that wraps an Event Function handler for local development.

**Parameters:**

- `eventFunctionHandler` (function) - AWS Lambda handler function
- `options` (object, optional)
  - `requestContext` (object) - Additional `requestContext` fields merged into every event
  - `event` (object) - Additional top-level event fields merged into every event
  - `cors` (`boolean | string[]`, optional) - Cross-origin access. Default:
    loopback origins only. See [Security: peer, Host and CORS](#security-peer-host-and-cors)
  - `allowedPeers` (`string[] | true`, optional) - Client IP addresses or CIDR
    ranges to serve besides this machine. Default: loopback peers only. See
    [Peer check](#peer-check)
  - `allowedHosts` (`string[] | true`, optional) - Extra `Host` names to serve
    besides loopback ones. Default: loopback only. See below
  - `maxBodyBytes` (number, optional) - Largest request body accepted, in
    bytes; a larger one gets `413 PAYLOAD_TOO_LARGE` before the handler runs.
    Default: `1048576` (1 MiB), the router's default. Set it to the
    `maxBodyBytes` of the router the handler wraps
    (`maxBodyBytes: router.maxBodyBytes`), so local development refuses and
    accepts what deployment does. Must be a positive integer

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

## Security: peer, Host and CORS

The proxy is a development server, but it runs the handler with whatever
`authorizer` you inject (or one derived from a JWT). **An injected authorizer
applies to every caller that reaches the proxy**, not just your own frontend.
Four checks are on by default.

The first keeps other machines out: only a client connecting from this
machine (a loopback peer) is served. The other three block, for other
websites open in your browser:

- **reading responses**: CORS is granted to loopback origins only;
- **sending anything but GET**: a cross-origin `POST`, `PUT`, `DELETE`,
  `HEAD`, `OPTIONS` preflight and so on from an origin that is not allowed
  gets `403` before the handler runs (form posts and `no-cors` fetches
  included);
- **DNS rebinding**: a request whose `Host` is not a loopback name gets `403`.

They do **not** stop a cross-site `GET` from running: a link, an `<img>` or a
`no-cors` fetch still reaches the handler with the injected authorizer; only
reading the reply is blocked. Only `GET` is exempt, so **GET routes must not
have side effects.**

In the default mode any loopback origin on any port (including `*.localhost`)
may write, so another local app with an XSS hole can drive the proxy; list
your frontend's origins with `cors: [...]` to narrow that.

### Peer check

A request is served only when its TCP peer (`req.socket.remoteAddress`) is a
loopback address: `127.0.0.0/8`, `::1`, or `::ffff:127.x.x.x` (what a
dual-stack server reports for an IPv4 loopback client). This is decided from
the socket, never from the `Host` header: any machine on the network can send
`Host: localhost`. Any other peer, or a socket with no address, gets `403`:

```json
{ "success": false, "error": { "code": "PEER_NOT_ALLOWED", "message": "Peer not allowed" } }
```

The refusal is logged as `LOCAL_PEER_NOT_ALLOWED` with the peer address (cut
at 64 characters) and the method. It runs before anything else: the Host
check, CORS, reading the body, deriving the authorizer and the handler.

Bind the server to loopback as well (`listen(3000, '127.0.0.1')`), so other
machines cannot even connect; `listen(3000)` alone binds every interface.

Tunnels such as cloudflared or ngrok connect to the proxy from this machine,
so they pass the peer check and need only their name in `allowedHosts`.

To let another device in (a phone on your LAN, a second laptop), list its
address or a range, bind an interface it can reach, and add the name it uses
to `allowedHosts`:

```typescript
const local = Local.EventFunctionProxy(handler, {
  allowedPeers: ['192.168.1.0/24'], // who may connect
  allowedHosts: ['192.168.1.20'], // the name they use to reach this machine
});
http.createServer((req, res) => local.request(req, res)).listen(3000, '0.0.0.0');
```

Entries are IPv4 or IPv6 addresses or CIDR ranges (`10.0.0.0/8`,
`fd00::/8`); an IPv4-mapped IPv6 peer is matched against IPv4 entries, and an
IPv4-mapped range (`::ffff:10.0.0.0/104`) is taken as the IPv4 range it maps
(`10.0.0.0/8`). IPv6 entries cover IPv4 peers too: Node's `BlockList` maps the
two families, so `::/0` admits every IPv4 peer as well. An entry that is
neither, an IPv6 address with a zone id (`fe80::1%eth0`, which no peer
address carries) or an IPv4-mapped range wider than `/96` throws when the
proxy is created. `allowedPeers: true`
serves any peer and logs `LOCAL_PEER_CHECK_DISABLED` once at startup: every
machine that can reach the port then acts as the injected authorizer.

### Host check (DNS rebinding)

A request is served only when its `Host` header names a loopback host:
`localhost`, `*.localhost`, any `127.0.0.0/8` address or `[::1]`, on any port.
Anything else, including a missing or malformed `Host`, gets `403`:

```json
{ "success": false, "error": { "code": "HOST_NOT_ALLOWED", "message": "Host not allowed" } }
```

The refusal is logged as `LOCAL_HOST_NOT_ALLOWED`. The check runs right after
the peer check, for every method (`OPTIONS` and `HEAD` included), before the
body is read, the authorizer is derived or the handler runs. It blocks DNS
rebinding: an attacker re-points their own domain at `127.0.0.1`, and the
browser then treats your backend as same-origin with their page, but it still
sends their domain as `Host`. It does not decide which machines may connect:
the client chooses the `Host` header, so that is the peer check's job.

To reach the proxy through a tunnel or, together with `allowedPeers`, from
another device on your LAN, list the names they use. Matching is
case-insensitive and ignores the port:

```typescript
Local.EventFunctionProxy(handler, {
  allowedHosts: ['192.168.1.20', 'my-app.tunnel.example'],
});
```

`allowedHosts: true` turns the check off. It is unsafe: a DNS-rebinding page
can then read `GET` responses. The proxy logs a warning
(`LOCAL_HOST_CHECK_DISABLED`) once when it is created. Writes stay limited:
with the Host check off, neither `Sec-Fetch-Site: same-origin` nor an
`Origin` that matches the `Host` vouches for a non-loopback origin (a
rebinding page produces both), so only loopback origins and, with
`cors: [...]`, the listed origins may write. Prefer listing names in
`allowedHosts`.

### CORS

| `cors`               | Behaviour                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| omitted (default)    | A loopback `Origin` (`http`/`https`, same hosts as above, any port) is reflected in `Access-Control-Allow-Origin`, with `Vary: Origin` and no `Access-Control-Allow-Credentials`.                             |
| `false`              | No CORS headers.                                                                                                                                                                                              |
| `['https://a.test']` | The router's allowlist: exact origins are reflected **with** `Access-Control-Allow-Credentials: true`. Loopback origins are not added implicitly. Every response carries `Vary: Origin`, the `403`s included. |
| `true`               | `Access-Control-Allow-Origin: *`. Unsafe: any website can call the proxy and read the responses. Logs `LOCAL_CORS_WILDCARD` once at startup.                                                                  |

A malformed `Origin`, the opaque `null` origin (sandboxed iframes, `file:`
pages) and any non-http(s) scheme get no CORS grant.

### Cross-origin writes

Withholding CORS headers only stops another site reading the response; a
browser still sends a form post or a `no-cors` fetch. So, unless `cors: true`,
a request whose method is not `GET` (`HEAD` and `OPTIONS` included) is refused
when it is cross-origin from an origin the mode does not allow:

- it carries an `Origin` that is not allowed, or
- its `Sec-Fetch-Site` is `cross-site` or `same-site` and it carries no allowed
  `Origin`, or
- it carries neither `Origin` nor `Sec-Fetch-Site` (older browsers send
  neither on a form post) and its `Content-Type` is one a form can send
  (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`,
  compared on the MIME type as the router does), or it has a body
  (`Content-Length` above 0, or `Transfer-Encoding`) with no `Content-Type`.

Allowed origins are loopback origins for the default and `cors: false`, and the
listed origins plus same-origin requests for `cors: string[]` (with
`allowedHosts: true`, same-origin counts only for a loopback origin). The
refusal runs after the Host check and before the body is read:

```json
{
  "success": false,
  "error": { "code": "CROSS_ORIGIN_FORBIDDEN", "message": "Cross-origin request not allowed" }
}
```

and is logged as `LOCAL_CROSS_ORIGIN_BLOCKED`. A request with no `Origin` and no
`Sec-Fetch-Site` (curl, server-to-server) passes when it sends a non-form
`Content-Type` such as `application/json`, or no body and no `Content-Type`;
send `-H 'Content-Type: application/json'` from curl. `cors: true` keeps
allowing everything.

CORS is enforced by browsers only. A non-browser client on the same machine
can still call the proxy, and neither the peer check nor the Host check stops
it: keep the injected authorizer to what you would accept any local process
using.

A frontend served from a host you added to `allowedHosts` is not a loopback
origin, so give it a `cors` entry too:

```typescript
Local.EventFunctionProxy(handler, {
  allowedHosts: ['192.168.1.20'],
  cors: ['http://192.168.1.20:5173'],
});
```

## Log codes

The proxy's own warnings carry a `code`:

| Code                         | When                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `LOCAL_PEER_NOT_ALLOWED`     | A request from a non-allowed peer was refused (`403`)   |
| `LOCAL_PEER_CHECK_DISABLED`  | Created with `allowedPeers: true` (once, at startup)    |
| `LOCAL_HOST_NOT_ALLOWED`     | A request with a non-allowed `Host` was refused (`403`) |
| `LOCAL_CROSS_ORIGIN_BLOCKED` | A cross-origin request was refused (`403`)              |
| `LOCAL_CORS_WILDCARD`        | Created with `cors: true` (once, at startup)            |
| `LOCAL_HOST_CHECK_DISABLED`  | Created with `allowedHosts: true` (once, at startup)    |

Its refusals carry `error.code` `PEER_NOT_ALLOWED`, `HOST_NOT_ALLOWED` or
`CROSS_ORIGIN_FORBIDDEN` in the body. Everything else, including the `413 PAYLOAD_TOO_LARGE` for a body
over `maxBodyBytes`, comes from the router the proxy runs on and is logged with
the router's codes (`ROUTER_PAYLOAD_TOO_LARGE`, `ROUTER_CLIENT_ABORTED`, ...;
see [Router error codes](./router.md#error-codes)).

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
  body?: string; // Raw request text, or base64 (see below); omitted when empty
  isBase64Encoded: boolean;
  // ...additional fields from options
}
```

`body` is the request body as API Gateway sends it: the raw text, unchanged,
when it is valid UTF-8 (a JSON body is passed through as sent, not parsed and
re-serialised), otherwise the bytes base64-encoded with
`isBase64Encoded: true`. It is omitted when the request has no body. Parse it
in the handler (`JSON.parse(event.body)`), or decode a binary one with
`Buffer.from(event.body, 'base64')`; `router.eventFunction(event)` does both
for you.

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
server.listen(PORT, '127.0.0.1', () => {
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

  server.listen(3000, '127.0.0.1', () => {
    console.log('Local server running on http://127.0.0.1:3000');
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

The injected identity is given to every request the proxy serves. The peer
check (and binding to `127.0.0.1`) is what limits that to your own machine;
the Host and CORS checks keep other websites in your browser out. Keep the
defaults unless you need to widen them.

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

server.listen(3000, '127.0.0.1', () => {
  console.log('Event Function handler running on http://127.0.0.1:3000');
});
```

## Related Documentation

- [Deployment Modes](./deployment-modes.md) - Web Function vs Event Function
- [Router](./router.md) - Request routing
- [Server](./server.md) - HTTP server
- [Context & State](./context-state.md) - Application context
