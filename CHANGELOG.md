# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
