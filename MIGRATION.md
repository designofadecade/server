# Migration Guide

Upgrade checklists for `@designofadecade/server`. For the full history of every
change, see [CHANGELOG.md](./CHANGELOG.md).

---

## Upgrading from 6.x to 10.x

Six releases sit between 6.1.0 and 10.2.0, four of them breaking. This is the
consolidated checklist. Every item tells you what to look for, how to find it,
and what to do.

Most projects need **none** of these changes. Work through the greps: if a search
returns nothing, that item does not apply to you.

### 1. `cors: true` no longer sends credentials (6.3.0)

```bash
grep -rn "cors:" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

`cors: true` previously reflected any `Origin` back with
`Access-Control-Allow-Credentials: true`, which let any website make
cookie-authenticated cross-origin requests and read the response. It is now
anonymous: `Access-Control-Allow-Origin: *` and no credentials header.

If a browser sends cookies or an `Authorization` header cross-origin, pass an
allowlist instead:

```typescript
router.nodeJSRequest(req, res, { cors: ['https://app.example.com'] });
```

Not affected: same-origin requests, and local dev where a bundler (Vite, webpack)
proxies the API — those are same-origin from the browser's point of view.

### 2. `request.authorizer` requires JWT verification (7.0.0)

```bash
grep -rn "\.authorizer" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

Earlier versions base64-decoded the JWT payload **without checking the
signature**, so any caller could choose their own claims. On the Node.js path
(`nodeJSRequest`), `request.authorizer` is now `null` unless you configure
verification:

```typescript
const router = new Router({
  initRoutes: [Routes],
  jwt: { secret: process.env.JWT_SECRET },
});

// or bring your own verifier for RS256 / JWKS
const router = new Router({
  initRoutes: [Routes],
  jwt: { verify: async (token) => myJwtLibrary.verify(token, publicKey) },
});
```

**Not affected: AWS Lambda behind API Gateway.** `lambdaEvent()` passes through
`event.requestContext.authorizer`, which the gateway populates _after_ it has
validated the token. If your `.authorizer` hits are on the Lambda event rather
than on `request.authorizer` from `nodeJSRequest`, there is nothing to do.

### 3. `HtmlRenderer` escapes by default (8.0.0, softened in 10.2.0)

```bash
grep -rn "HtmlRenderer" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

`{{value}}` is now HTML-escaped. If you interpolate plain text, nothing changes.
If you interpolate **HTML** — a rendered fragment, sanitized rich text — it will
appear as visible markup instead of rendering.

Two ways to fix, depending on where your templates live:

**Templates in your repo** — mark the intentional-HTML slots:

```html
<div>{{{body}}}</div>
```

**Templates outside your repo** (S3, a database, a CMS) — opt out per call so a
code deploy is not coupled to an asset migration:

```typescript
const safe = HtmlSanitizer.clean(richText, ['strong', 'em', 'a']);
HtmlRenderer.render(template, { body: safe }, { escape: false });
```

`{ escape: false }` applies to the **whole call**, so it is only as safe as the
least-sanitized value in that object. Use it when every value is sanitized,
app-generated, or validated — and keep the default for anything user-supplied
that is rendered as text.

Either way, template injection stays blocked: a value containing `{{other}}` is
never resolved against your data, at any escape setting.

### 4. WebSocket frames capped at 1 MiB (9.0.0)

```bash
grep -rn "WebSocketServer" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

`ws` defaults to 100 MiB and buffers each frame in full, so a few connections can
exhaust memory. The cap is now 1 MiB. Raise it if you legitimately send more:

```typescript
new WebSocketServer({ port: 8080, maxPayload: 8 * 1024 * 1024 });
```

While you are here, set an origin allowlist. Browsers do not apply the
same-origin policy to WebSockets and _do_ send cookies with the upgrade, so
without one, any site a user visits can open an authenticated socket on their
behalf:

```typescript
new WebSocketServer({ port: 8080, allowedOrigins: ['https://app.example.com'] });
```

Non-browser clients send no `Origin` and are refused when an allowlist is set —
gate those with `verifyClient` instead.

### 5. Servers no longer call `process.exit()` (10.0.0)

```bash
grep -rn "new Server(\|new WebSocketServer(" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

Both used to terminate the host process on any error, including a plain
`EADDRINUSE`. They now emit an `error` event. **If you do not listen, an
unhandled error becomes an uncaught exception** rather than a silent exit.

```typescript
const server = new Server({ port: 3000 }, handler);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use`);
  }
  process.exit(1); // your call, not the library's
});
```

Or keep the old behaviour with `{ port: 3000, exitOnError: true }`.

### 6. Sanitizer output changes (6.3.0)

```bash
grep -rn "HtmlSanitizer" --include="*.ts" --include="*.js" src packages | grep -v node_modules
```

No API change, but output differs in exactly the cases that were vulnerable:

- `clean()` no longer lets a removed tag splice its neighbours into a live
  element, and escapes stray `<` as `&lt;`
- `stripAllTags()` / `stripAll()` decode entities **before** stripping, so
  `&lt;b&gt;` is removed rather than being turned back into a live `<b>` tag on
  the way out, and leftover angle brackets are escaped

Plain text is unaffected — names, addresses and passwords come out byte-identical.
Only content containing tags or encoded tags changes, and in those cases the old
output was the bug.

### 7. Requires `@types/node` >= 24 (10.0.1)

The hand-written `URLPattern` type shim was removed; `URLPattern` is a global in
Node 24 and typed by `@types/node` 24. The package already required Node >= 24
via `engines`, so this only matters if your `@types/node` is older.

---

## Verifying an upgrade

Worth doing in this order, because each step rules out a class of problem:

1. **Baseline first.** Record `tsc --noEmit` errors and test results _before_
   upgrading. Projects often carry pre-existing failures, and without a baseline
   you cannot tell them apart from the ones you just introduced.
2. **Diff the type errors**, do not just read them.
3. **Run the test suite twice** — once upgraded, once with your changes stashed —
   to separate real regressions from flaky tests.
4. **Render your real templates** under both the old and new version and compare
   the output. If the bytes match, your rendering path is safe.
5. **Load every entry point** (`import('./handler.js')`) to catch resolution
   problems that type-checking misses.
6. **Start the server and make a request.** A route that resolves and returns a
   properly formatted error is far stronger evidence than a passing unit test.
