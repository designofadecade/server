# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
