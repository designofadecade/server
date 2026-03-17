# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
