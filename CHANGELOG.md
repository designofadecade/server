# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [10.4.1] - 2026-09-10

Package metadata only. No code, no type and no build-output changes; the
published `dist` is identical to 10.4.0.

### Changed

- The npm description now leads with what distinguishes this package — the same
  routes running on AWS Lambda (API Gateway HTTP API v2) and a plain Node HTTP
  server — rather than with the brand name. It matches the repository
  description.
- Keywords gained the serverless cluster (`aws-lambda`, `lambda`, `serverless`,
  `api-gateway`) and `nodejs`/`backend`. That capability has been the focus of
  the last three releases and was absent from the terms anyone would search.

## [10.4.0] - 2026-09-10

Completes the 10.3.0 type-boundary work on the two fields it did not reach:
`RouteError.fromError`'s `body`, and the _response_ side of
`Local.LambdaProxyRouter`. Deployed handlers are unaffected; the Lambda change
is local-dev only.

### Fixed — types

- **`RouteErrorResponse.body` is now required.** 10.3.0 narrowed `status` and
  `headers` to required because `fromError` always assigns them. `body` is
  assigned just as unconditionally but was left optional, so a consumer whose
  handler type declares `body` required got the identical TS2322 one field over:
  "Property 'body' is optional in type 'RouteErrorResponse' but required in
  type 'RouteResponse'". `body` stays `unknown` — this narrows only its
  optionality, so existing `RouteErrorBody` casts are unaffected.

- **`Local.LambdaProxyRouter` accepts a handler typed with AWS's result type.**
  This is the response-side mirror of 10.3.0's `LambdaHttpEvent` fix. The event
  is a parameter and was checked contravariantly; the return type is covariant,
  so `LambdaResponse` has to be a type AWS's own result is assignable _to_. It
  was not, in three separate ways, and TypeScript only reports the first
  mismatched property, so each was hidden behind the last:

  - `APIGatewayProxyResultV2` is a union including a bare `string`.
  - `APIGatewayProxyStructuredResultV2.statusCode` is optional.
  - its header values are `string | number | boolean`, not `string`.

  The only handler signature that compiled was one that abandoned the AWS types
  at the boundary — the situation 10.3.0 set out to remove. `LambdaResponse` is
  widened to match what AWS actually permits and the handler may now return
  `LambdaResponse | string`.

### Fixed — cookies

- **Response cookies no longer disappear.** Payload format 2.0 returns cookies
  in a top-level `cookies` array, because a header map cannot hold two values
  under one name and cookie values contain commas, so they cannot be folded into
  one string. Nothing in the response path could carry them:

  - `LambdaProxyRouter` read a handler's `cookies` and discarded it, behind a
    comment asserting cookies travel as `Set-Cookie` headers — which is true of
    format 1.0, not 2.0. A handler that set a session cookie worked deployed and
    silently did not work locally.
  - `LambdaHttpResponse` had no `cookies` field at all, so a route served
    through `router.lambdaEvent` could not set a cookie deployed either.

  `RouterResponse.headers` now accepts `string | string[]`, and each transport
  renders an array the way that transport expects: Node repeats the header, and
  `lambdaEvent` lifts `set-cookie` into the format 2.0 `cookies` field and
  comma-joins any other multi-value header. A route that sets cookies now
  behaves identically in both.

  `cookies` is omitted from the `lambdaEvent` response unless a route actually
  set one, so responses that set no cookie are byte-for-byte unchanged.

### Fixed — response fidelity

- **Response bodies are passed through byte for byte.** `LambdaProxyRouter`
  decoded a JSON response body and the router re-encoded it. That is a no-op for
  compact JSON — which is why it went unnoticed — and a silent rewrite of
  anything else: indentation collapsed, `\uXXXX` escapes were expanded, and
  number formatting was normalised (`1.0` became `1`). API Gateway passes the
  body through unchanged, so what a developer saw locally was not what the
  deployed API sends. The decode is gone.

- **A route's content type is no longer overwritten.** The default only checked
  for the exact spellings `Content-Type` and `content-type`, so any other casing
  fell through and the default was appended on top. `setHeader` _is_
  case-insensitive, so it then overwrote the content type the route had
  deliberately set — `CONTENT-TYPE: text/html` went out as `application/json`.
  The check is now case-insensitive.

- **Defaulting the content type no longer mutates the route's headers.** The
  default was written into whatever object the route returned. A route returning
  a shared header constant had it mutated for every later request, and a frozen
  one threw. The headers are copied first.

- **Both transports default the content type the same way.** The node path
  defaulted it whenever it was absent; the lambda path only when `headers` was
  absent entirely. A route that set any other header got a content type locally
  and none deployed. Both now use the same rule.

### Changed

- **Local dev now infers a response the way API Gateway does.** Widening the
  type alone would have been wrong: a handler returning a bare string hit
  `.statusCode`/`.body` on a string, and local dev answered `200` with an
  _empty_ body — silently dropping the payload for a handler AWS considers
  conforming. Payload format 2.0 specifies that a return value carrying no
  `statusCode` is inferred as `200`, `content-type: application/json`, with the
  return value itself as the body, so `LambdaProxyRouter` now does that.

  This changes local behaviour for a handler that returns an object with a
  `body` but no `statusCode`: local now sends `{"body":"..."}`, matching
  deployed, where it previously sent `"..."`. Such a handler was already off-type
  under 10.3.x — `statusCode` was required — and the divergence from deployed
  behaviour was the defect.

- Non-string response header values are collapsed to strings. AWS permits
  numbers and booleans; Node's `setHeader` rejects booleans outright.

### Notes

- `LambdaResponse.statusCode` and `headers` are now weaker types, as is
  `RouterResponse.headers`. Code that _returns_ either is unaffected; code that
  _reads_ one — and relied on `statusCode` being present, or on a header value
  being a `string` — will need a guard. That makes this a minor, not a patch.
- The response path is now byte-identical between local dev and deployed for
  status, headers, cookies and body. Any remaining difference is a bug.

## [10.3.1] - 2026-09-10

Fixes a polynomial ReDoS reachable from attacker-controlled input in the HTML
sanitizer, the template renderer and the router. No API change.

### Security

- **`HtmlSanitizer` could be stalled for minutes by one request (high).** Every
  tag pattern ended in `[^>]*`. On input containing many `<` and no `>`, the
  regex engine rescanned to the end of input from each `<` and backtracked,
  making the work quadratic in input size. `MAX_INPUT_SIZE` did not help — 1MB
  is _inside_ the cap, and quadratic growth at that size extrapolated to roughly
  19 minutes of blocked event loop. Node is single-threaded, so a single request
  stalled the whole process; on Lambda it is a timeout you are billed for.

  Measured before the fix: 20KB took 421ms, 40KB 1.6s, 80KB 6.6s — a clean 4x
  per doubling. After: 500KB completes in under 60ms.

  The tag patterns now match unquoted characters and fully quoted attribute
  values separately. The alternatives are disjoint on their first character, so
  the match is deterministic and linear. A naive `[^<>]*` would also have been
  linear but wrong — a quoted attribute value may legally contain `<`, and
  ending the tag there let attribute content escape into the document as
  structure.

  CodeQL flagged two of these sites; the same defect was present at three more
  that it did not report. All five are fixed.

- **`Router` path normalization was quadratic (moderate).** `path.replace(/\/+$/, '')`
  has an anchored `+`, so the engine retried from every index in a run of
  slashes, scanning to the end each time. Request paths are attacker-controlled,
  though bounded by HTTP header limits, so the practical cost was ~100-260ms of
  CPU per request rather than minutes. Trailing slashes are now stripped with an
  index scan.

- **`HtmlRenderer` `{{#if}}` condition matching was quadratic (low).** `\s+([^}]+)`
  — both parts match a space, so the engine tried every split point and rescanned
  to the end for each. Exploiting it requires an attacker-controlled _template_;
  values passed as data go through the slot table and are never re-parsed as
  template syntax, so ordinary use is not affected. `HtmlRenderer` has no input
  cap, so it is fixed regardless: the condition must now start with a non-space,
  making the two parts disjoint.

### Changed

- Sanitizing malformed input where a stray `<` immediately precedes a tag now
  removes the whole construct instead of leaving part of it behind.
  `HtmlSanitizer.clean('<<b>>')` returns `''` where it previously returned
  `'&gt;'`. This is the only observable output difference — verified by diffing
  every sanitizer and renderer output against 10.3.0 across a payload corpus —
  and it errs toward removing more, not less.

### Added

- ReDoS regression tests for all three modules, asserting linear-time completion
  on pathological input. Against the unfixed code these take 4-55 seconds each
  and fail; against the fix they complete in milliseconds, so the bounds are not
  timing-sensitive.
- Sanitizer bypass tests covering multi-character sanitization: nested tag
  reassembly (`<scr<script>ipt>`), triple nesting, comment splitting, entity and
  hex encoding, tab-broken `javascript:` URLs, and `on*` handlers smuggled
  through attribute values.

  These pin a mitigation CodeQL cannot see. It reports
  `js/incomplete-multi-character-sanitization` on the individual `.replace()`
  calls, but the sanitizer repeats the strip until output is stable, escapes any
  residual `<`, and re-emits only allowlisted tags from a builder. Those two
  alerts are dismissed as false positives; these tests are what keeps that
  dismissal honest, by failing if the mitigation is ever removed.

## [10.3.0] - 2026-09-10

Type-definition fixes found while integrating the package into an AWS Lambda +
TypeScript consumer. All three reported issues were confirmed against the source
and are consumer-facing type problems; fixing the second uncovered a runtime bug
in `Local` as well.

Code following the documented patterns needs no edits — `as any` workarounds at
the Lambda boundary simply become unnecessary. A few narrow surfaces did change
shape; see _Upgrade Notes_ below for what to check if you went off the documented
path.

### Fixed

- **`RouteError.fromError()` declared `status` optional but always sets it.** It
  destructures with `status = 500` and returns that unconditionally, so
  `RouterResponse` — where `status` is optional because a _handler_ may omit it
  and let the router default it — was weaker than the guarantee. Any consumer
  whose handler declares a required `status` got `TS2322` on every
  `return RouteError.fromError(...)`.

  `fromError` now returns `RouteErrorResponse`, which narrows `status` and
  `headers` to required. `RouterResponse.status` stays optional, which is correct
  for handlers.

```typescript
interface HandlerResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

async function getUser(): Promise<HandlerResponse> {
  try {
    return { status: 200, body: await users.find() };
  } catch (error) {
    // Previously TS2322; now assignable directly.
    return RouteError.fromError(error, { defaultMessage: 'Error loading user' });
  }
}
```

- **`LambdaHttpEvent` was incompatible with `@types/aws-lambda`.**
  `queryStringParameters` was typed `Record<string, string>`, narrower than AWS's
  `{ [name: string]: string | undefined }`, so the canonical handler failed to
  typecheck and needed an `as any` at the boundary. It is now
  `Record<string, string | undefined>`, which also matches the wire format —
  API Gateway genuinely omits values.

  Handlers are unaffected: `RouterRequest.query` remains
  `Record<string, string>`, and parameters with no value are now dropped at the
  boundary rather than forwarded as `undefined` behind a type that promised
  `string`.

```typescript
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Previously TS2345; now accepted with no cast.
export const handler = async (event: APIGatewayProxyEventV2) => router.lambdaEvent(event);
```

- **`Local.LambdaProxyRouter` silently discarded every cookie.** It built the
  Lambda event with `cookies` as an object, but API Gateway v2 sends
  `["name=value", ...]` and `Router.lambdaEvent` guards with `Array.isArray`.
  Handed an object it took the guard and returned `{}`, so a cookie-authenticated
  route worked when deployed and failed locally. Cookies are now emitted in wire
  format.

- **`Local`'s event was not assignable to `APIGatewayProxyEventV2`.** It omitted
  `version`, `routeKey`, `rawQueryString` and `isBase64Encoded`, sent Node's
  `string | string[]` headers where API Gateway sends one joined string, and
  supplied only part of `requestContext`. Because function parameters are checked
  contravariantly, passing a handler typed with the official AWS event — including
  `router.lambdaEvent` — was a type error. The synthesised event now carries every
  field AWS marks required.

- **The documented typed-context pattern did not compile.** `RouterOptions.initRoutes`
  and `Routes.register` typed the route-class constructor's context parameter as
  `Context`. Constructor parameters are contravariant, so a route class that
  narrowed it — the pattern shown throughout the docs — was rejected:

```typescript
class UserRoutes extends Routes {
  constructor(router: Router, context?: AppContext) {
    super(router, context);
  }
}
new Router({ initRoutes: [UserRoutes] }); // TS2322 before this release
```

Both now use `RoutesConstructor`, whose context parameter is `never` and so
accepts any narrowing.

- **`Context`'s protected members made it impractical to stub in tests.**
  `validate()`, `initialize()` and `dispose()` are `protected`, which only real
  inheritance can satisfy, so a consumer test passing a plain object where a
  `Context` was expected hit `TS2739` and had to cast — discarding type safety in
  exactly the place it is most useful.

  The framework never calls those methods; it stores the context and hands it to
  route classes. `RouterOptions.context` and `Routes.context` therefore now accept
  `ContextLike`, a structural type. Extend it to describe your own context and
  plain objects satisfy it. The abstract `Context` class is unchanged and still
  works as a convenience base for code that wants the lifecycle hooks.

```typescript
interface AppContext extends ContextLike {
  db: Db;
  config: Config;
}

// In a unit test - no cast, and the stub is still checked against the real shape.
const context: AppContext = { db: fakeDb, config: { assetsBucket: 'x' } };
```

### Added

- Exported types that were previously unreachable from the package root:
  `LambdaHttpEvent`, `LambdaHttpResponse`, `RouteRegistration`,
  `RoutesConstructor`, `ContextLike`, `RouteErrorResponse`, `RouteErrorBody`, and
  `LambdaEvent` / `LambdaResponse` from `Local`. Consumers had to restate these
  shapes by hand.
- `*.test-d.ts` type-level regression tests, run by `vitest --typecheck` as part
  of `npm test`. Every defect in this release was invisible to the runtime suite
  because it only affected the `.d.ts` a consumer sees.
- `npm run typecheck:types` and a non-blocking `typescript-next` CI job, which
  typechecks source and the type tests against `typescript@next`. TypeScript 7 is
  released but cannot be adopted yet — `typescript-eslint` peers
  `typescript: >=4.8.4 <6.1.0` — so this surfaces a regression before the switch
  becomes possible. Source and the shipped `.d.ts` compile clean under 7.0.2
  today.
- `@types/aws-lambda` as a devDependency, so the type tests assert against AWS's
  real definitions rather than a local replica.

### Upgrade Notes

Nothing here affects deployed behaviour, and nothing affects code using the
documented patterns. Three surfaces changed shape:

- **`LambdaHttpEvent` no longer has an `[key: string]: unknown` index signature**
  (type-only). It had to go: `APIGatewayProxyEventV2` is an interface, carries no
  implicit index signature, and so could never satisfy a target that declared
  one. The router reads only the declared fields.

  Passing a _variable_ is unaffected — excess property checks apply only to fresh
  object literals. Only code that constructs an event literal with extra fields,
  or reads an undeclared field off an event typed as `LambdaHttpEvent`, needs a
  cast or a wider local type. This surfaces as a compile error, never as a
  runtime surprise.

- **`Local.LambdaProxyRouter` now synthesises a correct API Gateway v2 event**
  (local development only). Deployed behaviour was already this shape — that is
  the point of the change. Worth a look only if you pass `LambdaProxyRouter` a
  hand-written handler rather than one wrapping `router.lambdaEvent`:
  - `event.cookies` is `string[]` (`["name=value"]`), was an object. Through a
    wrapped `Router.lambdaEvent` cookies previously never arrived at all, so
    nothing that worked before can regress here.
  - `event.headers[name]` is `string`, with repeated headers joined by `", "`;
    was Node's `string | string[]`.
  - `event.body` is omitted when there is no body; was `null`. Check falsiness
    rather than `=== null`.

- **`RouterOptions.context` and `Routes.context` are typed `ContextLike`, not
  `Context`.** This widens what is accepted, so existing code compiles — a
  subclass that redeclares `protected context?: AppContext` is still fine. Only
  code relying on `this.context` being _nominally_ a `Context` needs to say so
  explicitly.

## [10.2.1] - 2026-09-09

### Documentation

- Added `MIGRATION.md`, shipped in the published package. It consolidates the
  6.x -> 10.x upgrade into a single checklist: what changed, a `grep` to find
  whether it affects you, and the fix. Six releases sit between 6.1.0 and 10.2.0
  and four are breaking, so reading the changelog entries individually and
  synthesizing a path is error-prone — this replaces that.
- Linked the guide from `README.md`.

## [10.2.0] - 2026-09-09

### Added

- `HtmlRenderer.render()` and `renderFromFile()` accept a `RenderOptions` argument
  with an `escape` flag (default `true`). Passing `{ escape: false }` restores
  pre-8.0.0 interpolation for `{{value}}`.

  8.0.0 made escaping unconditional, which is the right default but breaks a
  legitimate pattern: composing HTML that the caller has _already_ sanitized. An
  application that runs `HtmlSanitizer.clean()` over rich text and then places the
  result in an email or page template has no way to express that intent short of
  editing every `{{value}}` in every template to `{{{value}}}` — impractical when
  templates are external assets rather than code.

  **This does not re-open the 8.0.0 template-injection hole.** Values still pass
  through the slot table, so data can never be read back as template syntax
  regardless of the escape setting; `{{secret}}` supplied as data stays literal and
  an injected `{{#if}}` is never executed. The flag controls HTML escaping only.

  Use it only for values you have sanitized. For anything user-supplied rendered
  as text, keep the default.

```typescript
// Default - escaped, for untrusted values
HtmlRenderer.render('<p>{{comment}}</p>', { comment: userInput });

// Opt out - for HTML you have already sanitized
const safe = HtmlSanitizer.clean(richText, ['strong', 'em', 'a']);
HtmlRenderer.render('<div>{{body}}</div>', { body: safe }, { escape: false });
```

- Exported the `RenderOptions` type.

## [10.1.0] - 2026-09-09

Fixes an authorization bypass found while writing integration tests, and closes
the testing gaps identified in the production-readiness review.

### Security

- **Route-level middleware was silently ignored on static routes (high).**
  `#buildRoutesPatterns` stored only `{ handler }` for static paths, discarding
  `middleware` and everything else on the registration. Dynamic paths stored the
  whole route, so the same guard worked there. A route registered as

  ```typescript
  this.addRoute('/admin', 'GET', handler, [requireAdmin]);
  ```

  ran **without** `requireAdmin`, while `/admin/:id` correctly refused. Since
  `docs/router.md` documents route middleware as the way to gate admin routes, any
  guard on a static path was silently absent — the handler ran unauthenticated with
  no error or warning. The full registration is now stored.

  **Check your routes:** if you attach middleware to a route whose path contains no
  `:` `*` `(` or `[`, it was never running before this release. Requests that
  previously succeeded may now be correctly refused.

### Added

- Integration tests that exercise real servers and sockets rather than mocks:
  - `Router.integration.test.ts` — a real `http.Server` over a real socket, covering
    the malformed `Host` 400 and process survival, oversized and unparseable bodies,
    forged vs. signed JWTs, bearer 401/403, CORS wildcard vs. allowlist, and route
    middleware short-circuiting.
  - `WebSocketServer.integration.test.ts` — real WebSocket connections, covering the
    origin allowlist (403 for unlisted and absent origins), `verifyClient`, the
    `maxPayload` cap closing with 1009, and the `connection` event exposing the
    upgrade request.

  These verify the fixes from 6.3.0 through 9.0.0, which until now had only been
  confirmed by hand.

- Edge-case suites for the branches attackers reach deliberately: malformed JWTs
  (bad segments, unparseable header or payload, non-object claims, `nbf`), sanitizer
  size caps, encoded protocols, malformed entities, and logger handling of BigInt,
  Symbol, circular references, depth limits and payloads past the 256KB CloudWatch
  cap.
- A smoke test for the package entry point, previously the only source file with no
  test at all.

### Changed

- Coverage now runs with `all: true`, so a source file with no tests reports as 0%
  instead of being silently omitted from the report. This is what surfaced the
  untested entry point.

### Coverage

686 -> 789 tests. Statements 90.8% -> 95.5%, branches 85.7% -> 90.0%, functions
95.4% -> 99.0%. `Router.ts` moved from 85.0%/78.3% to 94.0%/86.1%, `Logger.ts` from
79.1%/67.1% to 95.6%/82.2%, and `HtmlSanitizer.ts` from 89.5%/86.2% to 94.3%/89.9%.

## [10.0.1] - 2026-09-09

### Removed

- Deleted the hand-written `URLPattern` type shim (`src/types/urlpattern.d.ts`).
  `URLPattern` has been a global since Node 24 and is declared by `@types/node` 24,
  and this package already requires Node >= 24 via `engines`, so the local
  declaration was redundant. It was never shipped — `.d.ts` inputs are not emitted —
  so consumers are unaffected beyond needing `@types/node` >= 24, which the Node
  floor already implies.

### Fixed

- Route params no longer contain `undefined` values. The removed shim declared
  pattern groups as `Record<string, string>`, but an optional segment that does not
  match (`/files/:name?` against `/files`) yields `undefined` at runtime — so a
  handler could read `undefined` from `request.params` where the types promised a
  string. `@types/node` types this correctly as `Record<string, string | undefined>`,
  which surfaced the mismatch; unmatched groups are now omitted from `params`.

  This was latent for as long as the shim existed: the incorrect declaration hid it
  from the compiler.

## [10.0.0] - 2026-09-09

Stops the library terminating its host process, and modernises the toolchain.

### Changed

- **BREAKING: `Server` and `WebSocketServer` no longer call `process.exit(1)`.** Both
  killed the host process on any server error — including a plain `EADDRINUSE` —
  giving the application no chance to log, drain, retry on another port, or fail
  over. A library has no business making that decision.
  - Both now emit an `error` event instead. An application that listens decides what
    to do; one that does not gets an uncaught exception with a stack trace, rather
    than a silent exit code 1.
  - `Server` now extends `EventEmitter` to make this possible.
  - Pass `exitOnError: true` to either constructor to restore the old behaviour.

### Migration Guide

```typescript
// Handle failures yourself (recommended)
const server = new Server({ port: 3000 }, handler);
server.on('error', (error) => {
  logger.error('server failed', error);
  process.exit(1); // your call, not the library's
});

// Or keep the previous fail-fast behaviour
const server = new Server({ port: 3000, exitOnError: true }, handler);
```

The same applies to `WebSocketServer`.

### Fixed

- Two unused catch bindings in `ApiClient` that older lint rules did not report.

### Development

- Upgraded ESLint 8.57.1 → 10.10.0. ESLint 8 has been end-of-life and unsupported
  since 2024, so it no longer receives fixes of its own.
- Migrated `.eslintrc.json` to flat config (`eslint.config.js`); ESLint 9 removed
  `.eslintrc` support. Replaced the separate `@typescript-eslint/*` packages with
  the `typescript-eslint` meta-package (v8).
- Upgraded `lint-staged` 16 → 17 and `@types/node` to 24.13.4.
- Changed `moduleResolution` from the legacy `node` (node10) to `nodenext`, matching
  how this ESM package is actually consumed.
- Fixed the two pre-existing lint errors in test files; `npm run lint` now reports
  zero errors.
- Stopped tracking `dist/` in git. It was committed despite being listed in
  `.gitignore`, so the checked-in build could drift from source. Publishes are
  unaffected — both `prepublishOnly` and the release workflow build it fresh.

### Note on TypeScript 7

TypeScript was **not** upgraded to 7.x. `typescript-eslint` 8.70.0 (the current
release) declares a peer range of `>=4.8.4 <6.1.0`, so TypeScript 7 and a working
lint setup are mutually exclusive today. Since ESLint 8 reaching end-of-life was the
actual security concern and TypeScript 7 offers none, the lint toolchain won.
TypeScript stays on 5.9.3 until `typescript-eslint` supports 7.x.

## [9.0.0] - 2026-09-09

Final release from the security review: closes the sanitizer denial of service and
the WebSocket hardening gaps. All findings from the review are now addressed.

### Security

- **`HtmlSanitizer` — quadratic blowup on hostile input (moderate/high).** The
  dangerous-tag pattern `<(script|...)[^>]*>[\s\S]*?<\/\1>` and the comment pattern
  `<!--[\s\S]*?-->` restarted their lazy body scan at every unclosed opener, so cost
  grew with the square of the input. Measured 13ms / 47ms / 165ms / 623ms at 16KB /
  32KB / 64KB / 128KB, extrapolating to roughly 40 seconds of CPU at the 1MB input
  cap — one request per second was enough to pin a core. Both are now single
  left-to-right scans that never re-read a region: the same 128KB input takes 5ms,
  and the worst case at the full 1MB cap is 38ms.
- **BREAKING: `WebSocketServer` frames are capped at 1 MiB (moderate).** No size
  limit was configurable, so `ws`'s 100 MiB default applied and every frame was
  buffered in full before reaching a handler. A handful of connections sending
  maximum-sized frames could exhaust memory. The new default matches the 1MB limits
  already used for request bodies and sanitizer input.
- **`WebSocketServer` had no origin check (moderate).** Browsers do not apply the
  same-origin policy to WebSockets and do send cookies with the upgrade, so any site
  a user visited could open an authenticated socket on their behalf and read what it
  published — cross-site WebSocket hijacking. There was no hook to prevent it: the
  constructor took only `port` and `host`, and the `connection` event did not expose
  the upgrade request.

### Added

- `WebSocketServer` options:
  - `maxPayload` — largest accepted frame in bytes, defaults to 1 MiB
  - `allowedOrigins` — origins permitted to connect; an upgrade with a missing or
    unlisted `Origin` is refused with 403
  - `verifyClient` — custom upgrade gate receiving `{ origin, secure, req }`, sync or
    async, applied after the `allowedOrigins` check
- `WebSocketServer` now emits `connection` with `(ws, req)`, so consumers can read
  headers and cookies for their own authentication.
- Exported `WebSocketServerOptions` and `WebSocketUpgradeInfo` types.

### Migration Guide

Frames larger than 1 MiB are now refused and the connection is closed with code 1009. If you legitimately send larger messages, raise the cap:

```typescript
const wss = new WebSocketServer({ port: 8080, maxPayload: 8 * 1024 * 1024 });
```

The origin allowlist is opt-in, so nothing changes until you set it. For any server
that browsers connect to, you should:

```typescript
const wss = new WebSocketServer({
  port: 8080,
  allowedOrigins: ['https://app.example.com'],
});
```

Note that non-browser clients send no `Origin` header and are refused when
`allowedOrigins` is set — gate those with `verifyClient` instead.

### Documentation

- Documented `maxPayload`, `allowedOrigins`, `verifyClient` and the `connection`
  event in `docs/websocket.md`, replacing the previous advice to handle message
  size limits and client validation "at application level" — which the API offered
  no way to do.

## [8.0.0] - 2026-09-09

Closes the `HtmlRenderer` findings from the security review. Interpolated values
are now escaped by default, which changes the output of existing templates, so
this lands as a major.

### Security

- **BREAKING: `HtmlRenderer` did not escape interpolated values (high).** `{{value}}`
  wrote data straight into the output, so any user-supplied string became markup:
  `render('<p>{{comment}}</p>', { comment: '<img src=x onerror=alert(1)>' })` produced
  a live element, and a value containing `"` broke out of a surrounding attribute to
  add its own. Values are now HTML-escaped (`&`, `<`, `>`, `"`, `'`).
- **BREAKING: data was re-interpreted as template syntax (high).** Values substituted
  inside `{{#each}}` were written back into the working string, which the render loop
  and final pass then re-scanned. An array item of `{{secret}}` resolved against the
  outer scope and leaked a sibling variable, and an item containing `{{#if}}` or
  `{{#each}}` had that block executed. Substituted values are now parked in a slot
  table and spliced in only after every construct has been processed, so nothing
  originating in data is ever read as template syntax.
- NUL bytes are stripped from templates and from substituted values.

### Added

- Triple-brace `{{{value}}}` for deliberate raw HTML output. Use it only for values
  known to be safe; it bypasses escaping but is still immune to template injection.

### Migration Guide

If your templates interpolate plain text, no change is required.

If you relied on `{{value}}` emitting HTML — a rendered fragment, a preformatted
block — switch those to `{{{value}}}`:

```typescript
// Before (7.x) - emitted raw HTML
HtmlRenderer.render('<div>{{body}}</div>', { body: '<b>bold</b>' });
// '<div><b>bold</b></div>'

// After (8.0.0) - escaped
// '<div>&lt;b&gt;bold&lt;/b&gt;</div>'

// Use the triple brace where raw HTML is intended
HtmlRenderer.render('<div>{{{body}}}</div>', { body: '<b>bold</b>' });
```

Only use `{{{ }}}` for values you control. For anything user-supplied, keep the
double brace, or sanitize first with `HtmlSanitizer.clean()`.

A value containing `{{...}}` is now rendered literally instead of being resolved.
If you were using that as a feature — storing template fragments in data and
letting them expand — it no longer works, and it was reading whatever variable the
data named.

### Documentation

- Documented escaping, the raw form, and the template-injection behavior in
  `docs/utilities.md`.

## [7.0.0] - 2026-09-09

Closes the last finding from the 6.3.0 security review: JWTs presented on the
Node.js path were never signature-checked. Fixing this safely requires refusing
tokens that previous versions accepted, so it lands as a major.

### Security

- **BREAKING: `request.authorizer` is no longer populated from an unverified token
  (critical).** `Router.nodeJSRequest()` base64-decoded the JWT payload and exposed
  it as `request.authorizer.lambda` **without validating the signature**. Any caller
  could mint a token with arbitrary claims — `sub`, `email`, `isAdmin` — and defeat
  every check built on them. On AWS Lambda the same structure is filled in by API
  Gateway _after_ validation; the Node.js path had no such guarantee, and the
  documentation recommended gating admin routes on exactly this value.
  - Tokens are now verified before their claims are exposed.
  - With no `jwt` option configured, `request.authorizer` is always `null`.
  - The algorithm is taken from an allowlist, never from the token's own `alg`
    header, so `alg: none` and algorithm-confusion forgeries are refused.
  - `exp` and `nbf` are honoured, with optional `clockToleranceSec` leeway.
  - Signatures are compared in constant time.
- Bearer token comparison (`bearerToken`) now uses a constant-time comparison
  instead of `!==`, so the configured token cannot be recovered from response timing.

### Added

- `jwt` option on `RouterOptions`:
  - `jwt.secret` — shared secret for the built-in HMAC verifier
  - `jwt.algorithms` — accepted algorithms, defaults to `['HS256']` (`HS256`/`HS384`/`HS512`)
  - `jwt.verify` — custom async verifier for RS256/ES256/JWKS or an existing JWT
    library; returns claims to accept, `null` to reject
  - `jwt.clockToleranceSec` — leeway applied to `exp` and `nbf`, defaults to `0`
- Exported `JwtOptions` and `JwtHmacAlgorithm` types.

### Migration Guide

If you do not read `request.authorizer`, no change is required.

If you do, supply a `jwt` option — otherwise `authorizer` is `null` and any route
gated on it will deny every request:

```typescript
// Before (6.x) — claims were trusted without verification
const router = new Router({ initRoutes: [Routes] });

// After (7.0.0)
const router = new Router({
  initRoutes: [Routes],
  jwt: { secret: process.env.JWT_SECRET },
});

// Or bring your own verifier for asymmetric keys / JWKS
const router = new Router({
  initRoutes: [Routes],
  jwt: { verify: async (token) => myJwtLibrary.verify(token, publicKey) },
});
```

Tokens that were previously accepted **will now be rejected** if they are
unsigned, signed with a different secret, expired, or use an algorithm outside
the allowlist. This is the point of the change: treat any resulting failures as
tokens that should never have been trusted.

### Documentation

- Rewrote the JWT section of `docs/router.md` to cover verification, the
  algorithm allowlist and custom verifiers, replacing the 6.3.0 security warning.

## [6.3.0] - 2026-09-09

Security release. Fixes a cross-site scripting bypass in `HtmlSanitizer`, a
remote denial of service in `Router`, and an unsafe CORS default. Upgrading is
recommended for all users; see **Behavior changes** below before doing so.

### Security

- **`HtmlSanitizer.clean()` — XSS bypass via mutation (critical).** Disallowed tags
  were removed with a single string replace and the result was never re-scanned, so
  deleting one tag could splice its neighbours into a brand-new tag. `<<z>img src=x
onerror=alert(1)>` collapsed into a live `<img>` element regardless of the
  allowlist. Tags are now emitted only by the sanitizer's own tag builder, and any
  `<` that does not begin a recognised tag is escaped to `&lt;`.
- **`HtmlSanitizer.stripAllTags()` — emitted live tags (high).** Entities were
  decoded _after_ tags were stripped, so `&lt;img src=x onerror=alert(1)&gt;` passed
  through the strip as inert text and was then decoded into a real tag in the
  returned "plain text". Entities are now decoded first, stripping repeats until
  stable, and any remaining angle brackets are escaped. This also affects
  `stripAll()` and `clean(html, [])`, which delegate to it.
- **`Router.nodeJSRequest()` — remote denial of service (high).** The request URL
  was built outside the surrounding `try`, so a malformed `Host` header (e.g.
  `Host: a b`) threw from the URL constructor, escaped as an unhandled rejection and
  could terminate the process. Malformed URLs and Host headers now return `400`.
- **`Router.nodeJSRequest()` — unsafe CORS default (moderate).** `cors: true`
  reflected any `Origin` back with `Access-Control-Allow-Credentials: true`, letting
  any website make cookie-authenticated cross-origin requests and read the response.

### Added

- `cors` now accepts an array of allowed origins: `{ cors: ['https://app.example.com'] }`.
  Listed origins are reflected and receive credentials; everything else is refused,
  and `Vary: Origin` is set so caches cannot serve one origin's response to another.

### Behavior changes

- `cors: true` is now **anonymous**: it sends `Access-Control-Allow-Origin: *` and no
  longer sends `Access-Control-Allow-Credentials`. Cookie- or `Authorization`-bearing
  cross-origin requests that previously worked will now be refused by the browser.
  **Migration:** pass an explicit allowlist — `{ cors: ['https://your-app.example'] }`.
- `HtmlSanitizer` output may now contain `&lt;` where a stray `<` was previously
  passed through verbatim, and `stripAllTags()` removes encoded tags rather than
  decoding them back into markup.

### Documentation

- Documented that `req.authorizer` on the Node.js path is an **unverified** JWT
  payload — the signature is never checked, so any caller can choose their own
  claims. The `docs/router.md` examples that gated on `req.authorizer?.isAdmin` now
  carry an explicit warning. Signature verification is planned for the next major
  release; until then, verify tokens in middleware.
- Documented the `cors` option, which was previously undocumented.

## [6.2.0] - 2026-09-09

### Security

- Updated `ws` to `^8.21.3` (from `^8.16.0`), picking up fixes for two high-severity advisories:
  - Uninitialized memory disclosure ([GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx))
  - Memory exhaustion DoS from tiny fragments and data chunks ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p))
  - This raises the minimum `ws` version for consumers so the patched release cannot be deduped away by an older constraint elsewhere in the dependency tree.
- Resolved all remaining development-time advisories (`brace-expansion`, `picomatch`, `postcss`, `yaml`, `fflate`, `esbuild`/`vite` via the vitest upgrade). `npm audit` now reports 0 vulnerabilities, down from 16.

### Changed

- Upgraded `vitest`, `@vitest/coverage-v8` and `@vitest/ui` to `^5.0.0` (from `^2.0.0`)
- Upgraded `@types/node` to `^24.13.3` (from `^20.11.0`) to match the `engines.node >= 24.0.0` requirement and satisfy vitest 5's peer range

No runtime or public API changes. `ws` is the only production dependency; all other updates are development-only.

Note: the `Security` items above describe **dependency** updates only. This release does not modify any of the library's own runtime code.

## [6.1.0] - 2026-03-17

### Added

- `Router.lambdaEvent()` now catches all unhandled errors in a top-level `try/catch` and returns a consistent 500 error response via `RouteError.fromError()`, preventing unformatted errors from leaking to callers

### Changed

- `Router.lambdaEvent()` JSON parse errors now use `RouteError.fromError()` for consistent error formatting, matching the structured `{ success: false, error: { code, message } }` response shape introduced in v6.0.0

## [6.0.0] - 2026-03-13

### Changed

- **BREAKING:** `RouteError.fromError()` now returns response body as an object instead of stringified JSON
  - Old behavior: `body: JSON.stringify({ error, message, statusCode, code? })`
  - New behavior: `body: { success: false, error: { code, message } }`
  - Allows routers to handle serialization themselves, providing more flexibility
- **BREAKING:** Response structure now follows standard REST API format
  - Always includes `success: false` field for consistency
  - Error details nested under `error` object with `code` and `message` fields
  - `code` field is always present (defaults to `'UNKNOWN_ERROR'` for unsafe errors)
  - Removed `statusCode` field from body (status code remains in `response.status`)
  - Removed `error` field with HTTP status text (e.g., "Bad Request", "Internal Server Error")

### Migration Guide

**Old code:**

```typescript
const response = RouteError.fromError(error, {
  defaultMessage: 'Failed',
  status: 400,
});
// response.body is a string: '{"error":"Bad Request","message":"Failed","statusCode":400}'
const parsed = JSON.parse(response.body);
console.log(parsed.error); // "Bad Request"
console.log(parsed.message); // "Failed"
```

**New code:**

```typescript
const response = RouteError.fromError(error, {
  defaultMessage: 'Failed',
  status: 400,
});
// response.body is an object
console.log(response.body.success); // false
console.log(response.body.error.code); // "UNKNOWN_ERROR" or custom code
console.log(response.body.error.message); // "Failed"
```

### Benefits

- **Consistency:** Matches standard REST API response patterns used across applications
- **Type Safety:** Object responses are easier to validate and work with in TypeScript
- **Flexibility:** Routers can serialize to JSON, XML, or any format as needed
- **Always Typed Errors:** `code` field always present for programmatic error handling
- **Cleaner API:** Single `error` object instead of flat structure

## [4.4.1] - 2026-03-13

### Fixed

- Fixed TypeScript type exports for `RouteError.fromError()` when using `moduleResolution: "bundler"`
  - Added `FromErrorOptions` type export to main package index
  - Resolves "Property 'fromError' does not exist on type 'typeof RouteError'" error
  - Compatible with modern module resolution used by Vite, esbuild, and other bundlers
  - No runtime changes - method already worked correctly, only type declarations were missing

## [4.4.0] - 2026-03-13

## [4.3.0] - 2026-03-12

### Added

- **RouteError.fromError()** - Intelligent error handling with built-in security
  - Automatically distinguishes between safe (ValidationError, ConflictError, etc.) and unsafe (system/library) errors
  - Prevents sensitive data leaks (credentials, paths, ARNs, SQL schemas, API keys)
  - Integrated logging with full error details and context
  - Defense-in-depth security regardless of NODE_ENV
  - Support for custom safe error classes via `safeErrorClasses` option
  - Error code preservation for safe errors only
  - 30 comprehensive tests including security scenarios
- Safe error classes whitelist: ValidationError, ConflictError, NotFoundError, AuthenticationError, AuthorizationError, UserError, BadRequestError, ForbiddenError
- Complete documentation in [docs/route-error.md](docs/route-error.md) with security features, usage examples, and best practices
- Migration examples and real-world usage scenarios

### Changed

- **BREAKING:** Removed `RouteError.create()` method in favor of secure `fromError()` only
- Router.ts now uses `fromError()` for all error handling (authentication, authorization, not found, handler errors)
- Router error handling now uses proper error classes (AuthenticationError, NotFoundError, etc.)
- Simplified error handling - all logging now handled automatically by `fromError()`

### Security

- Protected against exposure of database connection strings in error messages
- Protected against exposure of AWS credentials and ARNs
- Protected against exposure of file system paths
- Protected against exposure of SQL schema details
- Protected against exposure of API keys and tokens
- Stack traces never exposed to clients (logged internally only)

## [4.2.2] - 2026-03-12

### Fixed

- Add "default" export condition to all package.json exports for tsx/ts-node compatibility
  - Fixes ERR_PACKAGE_PATH_NOT_EXPORTED error when using tsx, ts-node, or similar TypeScript loaders
  - Required for Node.js v24+ module resolution in hybrid CJS/ESM environments
  - Follows modern Node.js package best practices (Node.js 12.20+)
- Added missing package.json exports for submodules (sanitizer, server, router, logger, etc.)
  - Resolves ERR_PACKAGE_PATH_NOT_EXPORTED error when importing subpaths
  - Enables direct imports like `@designofadecade/server/sanitizer`

### Added

- HtmlSanitizer now supports preserving specific attributes on allowed tags via optional `allowedAttributes` parameter
  - Enables granular control over which attributes are preserved on each tag
  - Maintains all existing security features (event handler blocking, URL validation, etc.)
  - Includes CSS style attribute validation with safe color property support
  - Useful for preserving class names, data attributes, and inline styles for email rendering and compliance tracking
  - Fully backward compatible - existing code continues to work without changes

## [4.1.0] - 2026-03-12

### Changed

- Improved CI/CD pipeline to use npm Trusted Publishing instead of tokens for enhanced security
- Moved deployment checklist to docs folder for better organization

### Added

- Documentation for granular npm token setup (for reference)
- Enhanced HtmlSanitizer with additional security features:
  - Never-Allow List for inherently dangerous tags (script, iframe, form, etc.)
  - Multi-pass entity decoding to prevent nested encoding attacks
  - Null byte protection to prevent string termination attacks
  - Event handler removal to strip all event attributes
  - External link security with auto-added target="_blank" rel="noopener noreferrer"
  - Final security check to verify output before returning

## [4.0.0] - 2026-02-28

### Changed

- Updated package to publish to npm.js registry instead of GitHub Packages
- Improved package.json with enhanced keywords and metadata
- Enhanced README.md with comprehensive badges, installation instructions, and documentation links
- Optimized build configuration to exclude test and benchmark files from distribution
- Updated GitHub Actions workflow for npm publishing with provenance
- Improved .gitignore with additional patterns

### Added

- .npmignore file to ensure only necessary files are published
- Security section in README
- API Reference section in README with links to all documentation
- Support and Links sections in README
- Additional badges for npm version, TypeScript, and build status

### Removed

- .npmrc file (no longer needed for public npm registry)
- Test and benchmark files from compiled output

## [3.0.0] - 2026-02-27

### Added

- Core HTTP/HTTPS server implementation
- WebSocket server with message formatting
- Flexible routing system with URL pattern matching
- Static file serving with MIME type detection
- Middleware support (request logging)
- Application state management
- Event system with pub/sub pattern
- HTML sanitization utilities
- Slack notifications integration
- Comprehensive test suite with Vitest
- TypeScript definitions and ESM support
- Performance benchmarks using Vitest bench for Router, AppState, EventsManager, and HtmlSanitizer
- OpenAPI/Swagger documentation generator with TypeScript support
- Pre-commit hooks using Husky and lint-staged for code quality (Prettier, ESLint, tests)
- Swagger UI HTML generation for interactive API documentation
- Benchmark npm scripts (`bench` and `bench:watch`)
- API client utility (ApiClient)
- Context object for request handling
- Route error handling (RouteError)
- HTML rendering utilities

## [1.0.0] - 2026-02-26

### Added

- Initial package setup
- GitHub Actions workflows for testing and publishing
- ESLint and Prettier configuration
- MIT License
- README and contributing guidelines
