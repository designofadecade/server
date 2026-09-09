# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

Frames larger than 1 MiB are now refused and the connection is closed with code
1009. If you legitimately send larger messages, raise the cap:

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
  Gateway *after* validation; the Node.js path had no such guarantee, and the
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
  decoded *after* tags were stripped, so `&lt;img src=x onerror=alert(1)&gt;` passed
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
  status: 400 
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
  status: 400 
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
