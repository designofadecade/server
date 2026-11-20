# Deployment Modes

The same `Router` and the same route classes run in three places. This page is
about choosing between them, and about what changes operationally when you do.

| Mode                      | What the process is                                            | Entry point                                                      |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Lambda Web Function**   | A real HTTP/1.1 server that Lambda starts and sends traffic to | `WebFunction.serve(router, options)`                             |
| **Lambda Event Function** | A handler invoked once per API Gateway event                   | `export const handler = (event) => router.eventFunction(event)`  |
| **Plain Node server**     | A long-running HTTP server you host (or run locally)           | `new Server(opts, (req, res) => router.nodeJSRequest(req, res))` |

"Web Function" and "Event Function" are AWS's own names for the two Lambda
models. Neither is deprecated; they fit different workloads, and the sections
below say which.

## The one-paragraph version

Pick a **Web Function** when your application is an HTTP service: an API, a
server-rendered site, a BFF, anything that would be comfortable as a Node
process behind a load balancer. You get streaming, long requests, and real
concurrency inside one environment, and the exact same code runs locally with
no shim.

Pick an **Event Function** when the Lambda is driven by something other than a
browser or HTTP client (SQS, S3, EventBridge, Step Functions), or when you need
API Gateway itself: its authorizers, usage plans, custom domains, request
validation, or the fact that it is already in place and working.

Pick the **plain server** when you are not on Lambda at all (a container, a VM,
local development) or when you need WebSockets, which neither Lambda mode
offers.

## The same router, three entry files

Routes do not know which mode they run in. Define them once:

```typescript
// routes.ts
import {
  Routes,
  type Router,
  type RouterRequest,
  type RouterResponse,
} from '@designofadecade/server';

export class UserRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/users/:id', 'GET', this.getUser);
  }

  async getUser(req: RouterRequest): Promise<RouterResponse> {
    return { status: 200, body: { id: req.params.id, from: req.clientIp } };
  }
}
```

### 1. Lambda Web Function

```typescript
// index.ts — this exact file also runs locally on port 3000.
import { Router, WebFunction } from '@designofadecade/server';
import { UserRoutes } from './routes.js';

const router = new Router({ initRoutes: [UserRoutes] });

const server = WebFunction.serve(router, {
  port: 3000, // used locally; ignored under Lambda
  cors: ['https://app.example.com'],
});

server.on('error', (error) => {
  console.error('server failed to start', error);
  process.exit(1);
});

await server.ready;
```

Under Lambda, `Server` sees `AWS_LAMBDA_HTTP_ENDPOINT` (`host:port`), binds
there instead of `port`/`host`, and drains on `SIGTERM`. Locally the variable
is absent (or empty, which counts as absent), so it listens on `3000` and
ignores signals unless you ask it to. A variable that is set but not
`host:port` throws from the constructor rather than guessing an address.
Configure the function's start command to run this file (for example
`node index.js`); there is no exported `handler`.

### 2. Lambda Event Function

```typescript
// handler.ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Router } from '@designofadecade/server';
import { UserRoutes } from './routes.js';

const router = new Router({ initRoutes: [UserRoutes] });

export const handler = (event: APIGatewayProxyEventV2) => router.eventFunction(event);
```

For local development wrap the handler with
[`Local.EventFunctionProxy`](./local.md), which turns plain HTTP requests into
API Gateway format 2.0 events and back.

### 3. Plain Node server

```typescript
// server.ts
import { Router, Server } from '@designofadecade/server';
import { UserRoutes } from './routes.js';

const router = new Router({ initRoutes: [UserRoutes] });

const server = new Server(
  { port: Number(process.env.PORT ?? 3000), handleSignals: true },
  (req, res) => router.nodeJSRequest(req, res, { cors: ['https://app.example.com'] })
);

server.on('error', (error) => {
  console.error('server failed to start', error);
  process.exit(1);
});
```

`WebFunction.serve(router, { port })` is equivalent and shorter; it is the same
`Server` underneath. Use the long form when you need to compose `nodeJSRequest`
with other handlers (static files, a health check that bypasses the router).

## Decision table

| Need                                                     | Web Function                                               | Event Function                                                 | Plain server                  |
| -------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| Response streaming, Server-Sent Events                   | Yes, from a raw handler (see below)                        | No (whole response is one return value)                        | Yes, from a raw handler       |
| Requests longer than ~30 s                               | Yes, up to 15 min per request (configure `timeoutSeconds`) | No: API Gateway HTTP API integrations time out at ~30 s        | Yes                           |
| Several requests sharing one process (caches, pools)     | Yes, 64 by default                                         | No; one event per environment at a time                        | Yes                           |
| Binary request/response bodies                           | Native                                                     | Base64 through `isBase64Encoded`                               | Native                        |
| Multiple `Set-Cookie` headers                            | Native                                                     | Via the format 2.0 `cookies` array (handled for you)           | Native                        |
| WebSockets                                               | No                                                         | No (API Gateway WebSocket APIs are a separate event shape)     | Yes (`WebSocketServer`)       |
| Triggered by SQS, S3, EventBridge, Step Functions        | No                                                         | Yes                                                            | No                            |
| API Gateway authorizers, usage plans, request validation | No (CloudFront + your own middleware)                      | Yes                                                            | No                            |
| Custom domain, WAF                                       | Via CloudFront in front of the endpoint                    | Via API Gateway or CloudFront                                  | Your load balancer            |
| Runs locally unchanged                                   | Yes                                                        | Through `Local.EventFunctionProxy`                             | Yes                           |
| Request bodies over 1 MiB                                | `413` (router `maxBodyBytes`, default 1 MiB)               | `413` (same `maxBodyBytes`; API Gateway's own limit is higher) | `413` (router `maxBodyBytes`) |

Numbers in this table come from the AWS Lambda Developer Guide pages
"Lambda quotas" (`gettingstarted-limits.html`), "HTTP requests and responses"
(`web-functions-http.html`) and "Networking" (`web-functions-networking.html`),
checked on 2026-11-19. Quotas change; verify against the current page before
designing around a limit.

## Why a Web Function

### Streaming and SSE

An Event Function returns a single value, so the response cannot begin until
the handler has finished. A Web Function is an HTTP server: write to the
response as data becomes available. Server-Sent Events, progress output, and
large generated downloads all work the way they do on any Node server.

The transport is half-duplex: Lambda delivers the full request body before
your response starts flowing. Request streaming (reading a body while already
answering) is not available; response streaming is.

**Routes do not stream.** A route returns one `RouterResponse`, and
`nodeJSRequest` writes it in a single `res.end()`. To stream, handle that path
yourself in front of the router, using the long-form `Server` entry:

```typescript
const server = new Server({ port: 3000 }, (req, res) => {
  if (req.method === 'GET' && req.url === '/events') {
    // Authenticate here: this path bypasses router middleware.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const timer = setInterval(() => res.write(`data: ${Date.now()}\n\n`), 1000);
    req.on('close', () => clearInterval(timer)); // stop work when the client goes away
    return;
  }
  router.nodeJSRequest(req, res, { cors: ['https://app.example.com'] });
});
```

Keep a streamed response inside the endpoint's request timeout: when it
elapses Lambda ends the response and the client sees a truncated body.

### Long requests

The per-request timeout defaults to 30 seconds and is configurable from 3 to 900. An API Gateway HTTP API in front of an Event Function times out an
integration at about 30 seconds. If your workload has a report that takes two minutes, a Web
Function is the simpler path.

### Concurrency inside one environment

This is the biggest behavioural change, and it cuts both ways.

An Event Function environment handles one event at a time. A Web Function
environment handles up to 64 concurrent requests by default (configurable from
1 to 128), on 2 vCPU and 2 GB of memory per environment.

What you gain: an in-memory cache, a database connection pool, a warm HTTP
client, a compiled template — all of these are now shared by many requests
instead of being recreated per environment. Fewer environments means fewer
cold starts and fewer database connections for the same traffic.

What you lose: the implicit guarantee that "module-level state is per-request".
Code written for Event Functions sometimes stashes the current request, user or
tenant in a module variable because nothing else could touch it. In a Web
Function that is a data leak between users. Audit for it before switching:

```bash
grep -rn "^let \|^var " --include="*.ts" src | grep -v "const"
```

Anything per-request belongs on the `RouterRequest` (the router passes the same
object to middleware and the handler), in `AsyncLocalStorage`, or in a value
the handler returns. `AppState` is application-wide by design and is fine for
things that are truly global.

### Cold starts and the init budget

Lambda waits up to 10 seconds for the process to start listening on
`AWS_LAMBDA_HTTP_ENDPOINT`. `Server` binds in its constructor, so the budget is
spent before `WebFunction.serve` is called: imports, route construction, and
anything you `await` at the top of the module.

Open database connections lazily (on first request, or in the background after
`server.ready`), not before `serve`. A 10-second timeout is generous for Node,
but a synchronous warm-up of several AWS SDK clients plus a database handshake
can eat most of it on a cold region.

Because one environment serves many requests, a Web Function cold-starts less
often than an Event Function at the same traffic, which usually matters more
than the init time itself.

### Native HTTP

Lambda speaks HTTP/1.1 to your server. Binary bodies, repeated headers,
multiple `Set-Cookie` headers and chunked responses all work without the
base64 or `cookies[]` mapping that API Gateway events need. The router handles
that mapping for you in Event Function mode, so this is not a correctness
difference for routes built on this package, but it removes a class of
surprises for anything that bypasses the router.

### Graceful shutdown

Lambda sends `SIGTERM` and allows roughly one second before stopping the
environment. In Web Function mode `Server` handles the signal by default
(`handleSignals` is `true` when `AWS_LAMBDA_HTTP_ENDPOINT` is set): it stops
accepting connections, lets in-flight requests finish for `shutdownTimeoutMs`
(default 800 ms, chosen to fit inside that window), then cuts whatever is left.
Idle keep-alive sockets are closed at once so they do not hold the server open.

If you need to flush something on shutdown (a metrics buffer, a trace), do it
in a `'close'` listener and keep it short; the second is shared.

## Why an Event Function

### Event sources that are not HTTP

SQS, S3, EventBridge, DynamoDB Streams, Step Functions and scheduled rules
invoke a handler with an event. There is no HTTP request to serve, so a Web
Function has nothing to do. If one codebase handles both an API and a queue,
run the API as a Web Function and the queue consumer as a separate Event
Function; they can share route classes and services but not an entry file.

### API Gateway features

If you rely on API Gateway for JWT or Lambda authorizers, usage plans and API
keys, request validation, throttling per route, WebSocket APIs, or a custom
domain with its certificate already attached, an Event Function keeps all of
that. A Web Function endpoint has no custom domains or WAF integration; the
AWS guidance is to put CloudFront in front of it, and to do the rest in your
application or at the CloudFront layer.

### An existing, working deployment

`router.eventFunction(event)` is the same code path it has been since 6.x,
renamed. If the deployment works and none of the Web Function reasons above
apply, there is no need to move. The security fixes in 11.0 (client IP, request
id) apply to both modes.

### WebSockets

Neither Lambda mode gives you a WebSocket server. Web Function endpoints reject
`Upgrade` (Lambda strips the header); Event Functions behind an API Gateway
WebSocket API receive connect/message/disconnect events, which this package's
`WebSocketServer` does not model. For real-time delivery from a Lambda, use SSE
from a Web Function. For a bidirectional socket, run `WebSocketServer` on the
plain server mode on a host that keeps connections open.

## Fronting a Web Function with CloudFront

A Web Function endpoint is a generated `*.lambda-web.<region>.on.aws` hostname
with no custom-domain or WAF support of its own. For a production API you will
normally put CloudFront in front of it:

- Use an origin request policy that forwards all viewer headers **except**
  `Host`. Lambda routes on `Host` and answers 404 if it is not the endpoint
  name, so CloudFront must send its own.
- With the `IamAuth` authentication type, CloudFront signs requests to the
  origin and Lambda strips the `Authorization` header before your code sees
  it. Public endpoints (`None`) need no signing.
- Set `trustedProxies: 1` on the `Router` (see below) so `clientIp` is the
  viewer's address rather than CloudFront's — but only once the endpoint
  accepts nothing except CloudFront's signed requests.
- Treat the raw endpoint hostname as reachable: if the origin must not be
  called directly, use `IamAuth` with invoke permission scoped to the
  distribution rather than relying on obscurity. This is a prerequisite for
  `trustedProxies`, not just hygiene.

## Client IP and `trustedProxies`

`request.clientIp` is populated from a source the caller cannot forge in each
mode:

| Mode           | Source                                                                           |
| -------------- | -------------------------------------------------------------------------------- |
| Event Function | `requestContext.http.sourceIp` (set by API Gateway)                              |
| Web Function   | The **last** `X-Forwarded-For` value (Lambda appends it), minus `trustedProxies` |
| Plain server   | `socket.remoteAddress`; `X-Forwarded-For` is ignored entirely                    |

The common idiom of reading the _first_ `X-Forwarded-For` value is wrong in all
three: that value is whatever the client sent. Lambda documents that earlier
values "come from the client and aren't validated".

`trustedProxies` counts the proxies **you** control between the client and the
Lambda endpoint. With CloudFront in front, the last entry is a CloudFront
address and the client is one entry before it:

```typescript
const router = new Router({ initRoutes: [UserRoutes], trustedProxies: 1 });
```

> **`trustedProxies` is only safe when the endpoint cannot be reached except
> through those proxies.** The router walks back from the entry Lambda wrote;
> if a client can call the endpoint hostname directly, the entry one hop back
> is text the client sent, and `clientIp` is whatever it chose. For CloudFront
> that means `IamAuth` on the Web Function endpoint, with invoke permission
> granted only to your distribution (a resource policy whose source-ARN
> condition names the distribution), so an unsigned direct call is refused
> before it reaches your code. A public (`None`) endpoint behind CloudFront
> must keep `trustedProxies: 0` and accept that `clientIp` is CloudFront's
> address.

Leave it at `0` (the default) when clients reach the endpoint directly. Setting
it higher than the number of proxies you actually have hands the client the
choice of its own IP again, because the extra hop is a client-supplied value.

Whatever entry is selected is accepted only if it is a literal IPv4 or IPv6
address (`net.isIP`); anything else yields `''`. That stops a misconfigured
`trustedProxies` from smuggling arbitrary strings, including log-forging
characters, into `clientIp`.

The `webFunction` option controls whether `nodeJSRequest` reads these Lambda
headers at all. It defaults to "`AWS_LAMBDA_HTTP_ENDPOINT` is set", which is
right for every deployment. Never force it to `true` on a server clients reach
directly: `X-Forwarded-For` and `lambda-web-request-id` are only trustworthy
because Lambda rewrites them.

`X-Forwarded-Host` is forwarded by Lambda without validation. Do not use it to
build redirects, absolute URLs or host-based authorization.

## Request ids

`request.requestId` is API Gateway's `requestId` in Event Function mode,
Lambda's `lambda-web-request-id` in Web Function mode (Lambda removes any
`lambda-web-*` header a client sends before adding its own), and a fresh UUID
on a plain server. Lambda also returns `lambda-web-request-id` on the response,
so a client-reported failure can be matched to a log line. Pass the
`RouterRequest` to `createRequestLogger` / `logRequest` and the id is included
automatically.

## Production checklist

Things that have to be right before a Web Function takes traffic. Most of them
are "the default does this; do not undo it".

**Startup**

- [ ] Do not `await` network calls at module top level before `WebFunction.serve`. The 10-second init budget starts when the process does.
- [ ] Attach an `'error'` listener to the returned `Server` and decide what a failed bind means for you (`process.exit(1)` is reasonable: Lambda will retry the environment).
- [ ] Do not pass `host`/`port` expecting them to apply under Lambda; they are ignored there and only matter locally.

**Request handling**

- [ ] Grep for module-level mutable state that assumes one request at a time (see [Concurrency](#concurrency-inside-one-environment)).
- [ ] Size connection pools for 64 concurrent requests per environment (or whatever you configure), not for one.
- [ ] Set `cors` to an explicit origin allowlist if browsers send credentials. Lambda adds no CORS headers of its own. Non-safe methods and preflights from an origin off the list (and not same-origin) get a `403`; see [CORS](router.md#cors).
- [ ] Keep request bodies under 1 MiB or handle large uploads out of band (pre-signed S3 URLs). The router answers `413` above `maxBodyBytes` (default 1 MiB) on every transport.
- [ ] Only `GET HEAD POST PUT PATCH OPTIONS DELETE` reach the function; Lambda answers 400 to anything else before your code runs.
- [ ] Request line plus headers must fit in 128 KiB (Lambda answers 431 otherwise). Large cookies and bearer tokens count.

**Network and identity**

- [ ] Put CloudFront in front if you need a custom domain or WAF; forward all viewer headers except `Host`.
- [ ] Set `trustedProxies` to the number of proxies you control (CloudFront = 1) and no higher.
- [ ] **Only** set `trustedProxies` above `0` if the endpoint is unreachable except through those proxies: `IamAuth` on the endpoint, invoke permission granted only to your distribution. On a directly reachable endpoint the client chooses `clientIp`.
- [ ] Never build URLs or authorize on `X-Forwarded-Host`.
- [ ] Use `IamAuth` on the endpoint if the raw hostname must not be reachable without going through CloudFront.

**Shutdown and observability**

- [ ] Leave `handleSignals` at its default; if you take over `SIGTERM` yourself, finish inside one second.
- [ ] Keep `shutdownTimeoutMs` below 1000. Anything you flush in a `'close'` listener shares that second.
- [ ] Log `request.requestId`; it matches the `lambda-web-request-id` header Lambda returns to the client.
- [ ] Do not expect WebSocket upgrades to arrive. Design real-time features around SSE or a separate host.

**Local parity**

- [ ] Run the same entry file locally (`node index.js`) and confirm it binds `port` and ignores `SIGTERM` as expected. Set `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080` to exercise the Web Function branch without deploying.

## Related documentation

- [Server](./server.md) - `Server`, `WebFunction.serve`, `ready`, `address`, events and shutdown
- [Router](./router.md) - `eventFunction`, `nodeJSRequest`, `clientIp`, `requestId`, `trustedProxies`
- [Local Development](./local.md) - `Local.EventFunctionProxy` for Event Function handlers
- [Logger](./logger.md) - Structured logging and request correlation
