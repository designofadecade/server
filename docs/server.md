# Server

HTTP server wrapper for Node.js with error handling, port validation, graceful
shutdown, and automatic AWS Lambda Web Function support.

## Overview

The `Server` class wraps Node's native HTTP server with error events, structured
logging and lifecycle management. It runs unchanged in two of the package's
three [deployment modes](./deployment-modes.md):

- **Plain Node server** (any host, local development): listens on `port`/`host`.
- **AWS Lambda Web Function**: detected through the `AWS_LAMBDA_HTTP_ENDPOINT`
  environment variable, which then dictates the address. `SIGTERM` drains the
  server.

The third mode, a Lambda Event Function, has no server at all: the handler calls
`router.eventFunction(event)`. See [Router](./router.md#eventfunction).

## Installation

```typescript
import { Server, WebFunction } from '@designofadecade/server';
// or the subpath
import Server from '@designofadecade/server/server';
```

## Basic Usage

```typescript
import { Server } from '@designofadecade/server';

// Create server with request handler
const server = new Server({ port: 3000, host: '0.0.0.0' }, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World');
});

server.on('error', (error) => {
  console.error('server failed', error);
  process.exit(1);
});

await server.ready; // listening
```

The server starts listening in the constructor. Nothing else needs to be called.

## WebFunction.serve()

The shortest way to run a `Router` as an HTTP server, in a Lambda Web Function
or anywhere else:

```typescript
import { Router, WebFunction } from '@designofadecade/server';

const router = new Router({ initRoutes: [UserRoutes] });

const server = WebFunction.serve(router, {
  port: 3000, // local only; ignored under Lambda
  cors: ['https://app.example.com'],
});

await server.ready;
```

```typescript
static serve(router: Router, options?: WebFunctionOptions): Server

interface WebFunctionOptions extends ServerOptions {
  /** CORS policy, as for `router.nodeJSRequest`. Lambda adds no CORS headers itself. */
  cors?: boolean | string[];
}
```

`serve` returns an ordinary `Server`. It wires `router.nodeJSRequest(req, res, { cors })`
as the request handler and adds a last-resort catch so a bug inside the router
cannot become an unhandled rejection that takes down the environment and every
concurrent request in it. Unless you pass `maxBodyBytes` yourself, it sets the
server's `maxBodyBytes` to `router.maxBodyBytes`, so an `Expect: 100-continue`
upload over the router's limit is refused before the client sends it.

## Web Function mode

A Lambda Web Function is a real HTTP/1.1 server. Lambda starts the process,
waits up to 10 seconds for it to listen on the address in
`AWS_LAMBDA_HTTP_ENDPOINT` (`host:port`), forwards requests over HTTP/1.1, and
sends `SIGTERM` about one second before it stops the environment.

When that variable is set, `Server`:

- parses it with `Server.parseEndpoint()` and binds there; `port` and `host`
  options are ignored (binding anywhere else means the function never receives
  a request and fails its init check);
- defaults `handleSignals` to `true`, so `SIGTERM` calls `close()`;
- logs `mode: 'web-function'` on startup.

An **empty** `AWS_LAMBDA_HTTP_ENDPOINT` counts as unset: the server behaves as
a plain Node server (`port`/`host` apply, no signal handling). A value that is
set but not `host:port` throws from the constructor.

Everything else is identical, which is why the same entry file runs locally and
deployed. To exercise the Web Function branch locally:

```bash
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node index.js
```

See [Deployment Modes](./deployment-modes.md) for when to choose a Web Function
and the production checklist.

## API Reference

### Constructor

```typescript
new Server(options: ServerOptions, requestHandler: RequestHandler)
```

#### Parameters

- `options` - Configuration object
  - `port` (number, optional) - Port number (1-65535). Default: `3000`. Ignored
    in Web Function mode.
  - `host` (string, optional) - Host to bind to. Default: `'0.0.0.0'`. Ignored
    in Web Function mode.
  - `exitOnError` (boolean, optional) - Call `process.exit(1)` on a server
    error instead of only emitting `'error'`. Default: `false`.
  - `handleSignals` (boolean, optional) - Drain and close on `SIGTERM`.
    Default: `true` in Web Function mode, `false` otherwise.
  - `shutdownTimeoutMs` (number, optional) - How long `close()` waits for
    in-flight requests before cutting remaining connections. Default: `800`,
    which fits inside Lambda's one-second `SIGTERM` window.
  - `maxBodyBytes` (number, optional) - Largest body, in bytes, a client may
    start sending after `Expect: 100-continue`. When set, such a request whose
    `Content-Length` is over the limit gets `413` with
    `{ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } }` and
    `Connection: close` instead of `100 Continue`, so the body is never
    uploaded; it is logged as `SERVER_PAYLOAD_TOO_LARGE` at `warn`. Any other
    `Expect: 100-continue` request gets its `100 Continue` and reaches the
    handler as usual. Default: unset (Node answers `100 Continue` to
    everything). `WebFunction.serve` sets it to the router's `maxBodyBytes`.
    The handler still enforces its own limit on the bytes actually read. Must
    be a positive integer.
  - `requestTimeout` (number, optional) - Milliseconds a client has to send
    the whole request, headers and body, before Node answers `408` and closes
    the connection: the defence against slow uploads holding sockets open. It
    does not limit how long a handler runs or a response streams. Default:
    `30000` (`Server.DEFAULT_REQUEST_TIMEOUT_MS`) on a plain Node host; in a
    Web Function, Node's own default (300 s) unless set, since Lambda is the
    only client, delivers each request whole and enforces `timeoutSeconds`
    itself. `0` disables it.
  - `headersTimeout` (number, optional) - Milliseconds a client has to send
    the complete request headers (`408` otherwise). Default: `10000`
    (`Server.DEFAULT_HEADERS_TIMEOUT_MS`) on a plain Node host, or a shorter
    non-zero `requestTimeout`; Node's own default (60 s) in a Web Function
    unless set. Must not exceed a non-zero `requestTimeout`.

  Node checks `requestTimeout` and `headersTimeout` every 30 s, so a request
  can outlive them by up to that. Raise `requestTimeout` for long uploads on
  slow links.

- `requestHandler` (function) - Function to handle incoming HTTP requests
  - Signature: `(req: IncomingMessage, res: ServerResponse) => void`

#### Throws

- `Error` - If port is invalid (not between 1-65535)
- `Error` - If request handler is not a function
- `Error` - If `AWS_LAMBDA_HTTP_ENDPOINT` is set but is not `host:port`
- `Error` - If `maxBodyBytes` is not a positive integer, `requestTimeout` or
  `headersTimeout` is not a non-negative integer, or `headersTimeout` exceeds
  a non-zero `requestTimeout`

### Static methods

#### Server.isWebFunction()

```typescript
static isWebFunction(env?: NodeJS.ProcessEnv): boolean
```

`true` when `AWS_LAMBDA_HTTP_ENDPOINT` is set in `env` (default `process.env`).

#### Server.parseEndpoint()

```typescript
static parseEndpoint(value: string): ServerAddress
```

Parses `host:port`, including a bracketed IPv6 host (`[::1]:8080`). Throws on
anything else rather than guessing.

#### Server.WEB_FUNCTION_ENDPOINT_ENV

The variable name, `'AWS_LAMBDA_HTTP_ENDPOINT'`.

#### Server.DEFAULT_REQUEST_TIMEOUT_MS / Server.DEFAULT_HEADERS_TIMEOUT_MS

The `requestTimeout` (`30000`) and `headersTimeout` (`10000`) defaults off a
Web Function, in milliseconds.

### Properties

#### ready

```typescript
readonly ready: Promise<void>
```

Resolves once the server is listening; rejects if it fails to start. Awaiting it
is optional: a rejection is also reported through the `'error'` event, and the
promise never produces an unhandled rejection on its own.

#### address

```typescript
get address(): ServerAddress
```

The address the server binds: `{ host, port }` from the options, or Lambda's
endpoint in Web Function mode.

#### server

```typescript
get server(): Http.Server | null
```

Returns the underlying Node.js HTTP server instance, or `null` after `close()`
has completed (or after a failed start has been closed).

### Events

`Server` extends `EventEmitter`.

| Event         | Payload         | When                                                                             |
| ------------- | --------------- | -------------------------------------------------------------------------------- |
| `'listening'` | `ServerAddress` | The server has bound and accepts connections.                                    |
| `'close'`     | none            | `close()` has finished.                                                          |
| `'error'`     | `Error`         | The underlying server failed (for example `EADDRINUSE`). Unhandled, this throws. |

### Methods

#### close()

```typescript
close(): Promise<void>
```

Stops accepting connections, lets in-flight requests finish for up to
`shutdownTimeoutMs`, then cuts whatever is left. Idle keep-alive sockets are
closed immediately so they do not hold the server open for the keep-alive
timeout. Removes the `SIGTERM` listener if one was installed.

Lifecycle guarantees:

- **Concurrent calls** while a close is in progress share one promise.
- **A call after close has finished** resolves immediately; `server.server` is
  `null` once closed, and nothing is re-closed.
- **A call before the server is listening** waits for startup to finish or
  fail, then closes (or, on a failed start, just resolves). `ready` is never
  left hanging.
- **A failed start** removes the `SIGTERM` listener, so a crashed server does
  not keep the process alive through a dangling signal handler.

**Returns:** Promise that resolves when server is closed or rejects on error

**Example:**

```typescript
await server.close();
console.log('Server closed successfully');
```

## Configuration Examples

### Development Server

```typescript
const devServer = new Server({ port: 3000, host: 'localhost' }, (req, res) => {
  res.end('Development mode');
});
```

### Production Server (your own host)

```typescript
const prodServer = new Server({ port: 8080, host: '0.0.0.0', handleSignals: true }, (req, res) => {
  // Your production request handler
});
```

`handleSignals: true` gives a container or systemd-managed process the same
drain-on-`SIGTERM` behaviour a Web Function gets by default. Raise
`shutdownTimeoutMs` if your orchestrator allows longer than a second.

### Custom Port from Environment

```typescript
const port = parseInt(process.env.PORT || '3000', 10);
const server = new Server({ port }, requestHandler);
```

## Error Handling

Errors are emitted as an `'error'` event and recorded with a code for
monitoring. The server does **not** exit the process unless `exitOnError` is
set. If no listener is attached, Node's standard `EventEmitter` behaviour
applies and the error is thrown.

### Port Already in Use (EADDRINUSE)

```typescript
server.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    // Error code in the log: SERVER_PORT_IN_USE
  }
});
```

### General Server Errors

Logged with code `SERVER_ERROR`, then emitted.

### Close Errors

```typescript
try {
  await server.close();
} catch (error) {
  // Error code: SERVER_CLOSE_ERROR
  console.error('Failed to close server:', error);
}
```

### Log codes

| Code                       | When                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| `SERVER_PORT_IN_USE`       | The port is already in use (`EADDRINUSE`)                                         |
| `SERVER_ERROR`             | Any other server error                                                            |
| `SERVER_CLOSE_ERROR`       | `close()` failed                                                                  |
| `SERVER_PAYLOAD_TOO_LARGE` | An `Expect: 100-continue` body over `maxBodyBytes` was refused (`warn`)           |
| `SERVER_CLIENT_ERROR`      | Node rejected a malformed or timed-out request (`warn`); a client reset (`debug`) |

The `413` the server sends for that refusal carries `error.code`
`PAYLOAD_TOO_LARGE` in its body, as the router's does, and closes the
connection the same way: the connection is marked so a request pipelined
behind the refused body is never handed to `requestHandler`, and a client that
sends the body anyway still reads the `413` rather than a reset.

`SERVER_CLIENT_ERROR` covers what Node's parser or timers reject before (or
while) a request reaches the handler: malformed or smuggling-style framing
(`HPE_INVALID_CHUNK_SIZE`, `HPE_STRICT`, a body cut short), oversized headers
and `requestTimeout`/`headersTimeout`. The log carries only Node's code, as
`errorCode`, never the raw bytes. Node's answers are kept: `431` for oversized
headers, `413` for oversized chunk extensions, `408` for a timeout, `400`
otherwise, each with `Connection: close`, written only when no response has
started on the connection. A client that reset the connection
(`ECONNRESET`, `ECONNABORTED`, `EPIPE`) gets nothing and is logged at
`debug`.

## Integration with Router

```typescript
import { Router, Server } from '@designofadecade/server';

const router = new Router({ initRoutes: [MyRoutes] });

const server = new Server({ port: 3000 }, (req, res) =>
  router.nodeJSRequest(req, res, { cors: ['https://app.example.com'] })
);
```

Or, equivalently, `WebFunction.serve(router, { port: 3000, cors: [...] })`.

## Logging

The Server class uses the built-in logger for CloudWatch-compatible structured logging:

- **Startup:** Logs server listening on host:port and `mode` (`'node'` or `'web-function'`)
- **Errors:** Logs with error codes for monitoring
- **Signal:** Logs `SIGTERM received, draining HTTP Server` when `handleSignals` is on
- **Shutdown:** Logs successful close or errors

All logs include `source` field for tracking (e.g., `Server.start`, `Server.signal`, `Server.close`).

## Best Practices

1. **Listen for `'error'`.** Decide yourself what a failed bind means; the library
   no longer exits the process for you.
2. **Await `ready` before announcing.** Health checks and "listening on" messages
   belong after `await server.ready`, not after the constructor returns.
3. **Graceful shutdown.** In a Web Function it is on by default. Elsewhere, pass
   `handleSignals: true` or call `close()` from your own signal handler:
   ```typescript
   process.on('SIGTERM', async () => {
     await server.close();
     process.exit(0);
   });
   ```
   Keep anything you run after `close()` short: Lambda gives the whole shutdown
   about one second.
4. **Do not spend the init budget before `serve`.** Lambda waits 10 seconds for
   the listener. Open connections lazily or after `ready`.
5. **Host Binding:**
   - Use `0.0.0.0` for production on your own host (accepts external connections)
   - Use `localhost` for development (local only)
   - Neither applies under Lambda, where the endpoint is dictated.

## Type Definitions

```typescript
interface ServerOptions {
  port?: number;
  host?: string;
  exitOnError?: boolean;
  handleSignals?: boolean;
  shutdownTimeoutMs?: number;
  maxBodyBytes?: number;
  requestTimeout?: number;
  headersTimeout?: number;
}

interface ServerAddress {
  host: string;
  port: number;
}

interface WebFunctionOptions extends ServerOptions {
  cors?: boolean | string[];
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;
```

`ServerOptions`, `ServerAddress` and `WebFunctionOptions` are exported from the
package root.

## Related Documentation

- [Deployment Modes](./deployment-modes.md) - Web Function vs Event Function vs plain server
- [Router](./router.md) - Request routing and handling
- [Logger](./logger.md) - CloudWatch logging
- [Local Development](./local.md) - Running Event Function handlers locally

## Examples

### Complete Application

```typescript
import { Router, WebFunction } from '@designofadecade/server';
import { UserRoutes, PostRoutes } from './routes.js';

// Initialize router
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes],
  trustedProxies: process.env.BEHIND_CLOUDFRONT ? 1 : 0,
});

// One entry file: a Lambda Web Function when AWS_LAMBDA_HTTP_ENDPOINT is set,
// a plain server on PORT otherwise. SIGTERM is handled in both.
const server = WebFunction.serve(router, {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  handleSignals: true,
  cors: ['https://app.example.com'],
});

server.on('error', (error) => {
  console.error('server failed to start', error);
  process.exit(1);
});

server.on('close', () => {
  // flush metrics, close pools — keep it under a second
});

await server.ready;
console.log(`listening on ${server.address.host}:${server.address.port}`);
```
