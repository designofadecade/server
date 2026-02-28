# Design of a Decade Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@designofadecade/server.svg)](https://www.npmjs.com/package/@designofadecade/server)
[![Node.js Version](https://img.shields.io/badge/node->=24.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Build Status](https://github.com/designofadecade/server/workflows/Test/badge.svg)](https://github.com/designofadecade/server/actions)

A modern, type-safe Node.js server framework with built-in WebSocket support, routing, static file handling, and middleware capabilities. Built with TypeScript for Node.js 24+.

## Features

- ✅ Full TypeScript support with comprehensive type definitions
- ✅ ESM (ES Modules) compatible
- ✅ WebSocket server with message formatting and event handling
- ✅ Flexible routing system with URL pattern matching
- ✅ Static file serving with MIME type detection
- ✅ Built-in middleware support (request logging, etc.)
- ✅ Application state management
- ✅ Event system with pub/sub pattern
- ✅ HTML sanitization utilities
- ✅ Comprehensive test coverage with Vitest
- ✅ Modern async/await API

## 📦 Installation

```bash
npm install @designofadecade/server
```

Or using other package managers:

```bash
# Yarn
yarn add @designofadecade/server

# pnpm
pnpm add @designofadecade/server

# Bun
bun add @designofadecade/server
```

### Requirements

- **Node.js** >= 24.0.0
- **ES Modules** support (package uses `"type": "module"`)
- TypeScript >= 5.0 (if using TypeScript)

## Quick Start

```typescript
import { Server } from '@designofadecade/server';

// Create a new server instance
const server = new Server({
  port: 3000,
  hostname: 'localhost'
});

// Start the server
await server.start();
console.log('Server running on http://localhost:3000');
```

## Architecture Overview

The server is composed of several modular components:

### Server Core
- **Server**: Main HTTP/HTTPS server with WebSocket upgrade support
- **Router**: URL pattern-based routing with request handlers
- **Routes**: Route collection and management

### WebSocket Support
- **WebSocketServer**: WebSocket connection management
- **WebSocketMessageFormatter**: Message serialization/deserialization

### Middleware & Utilities
- **RequestLogger**: HTTP request logging middleware
- **StaticFileHandler**: Static file serving with caching
- **HtmlSanitizer**: XSS protection for HTML content
- **HtmlRenderer**: Server-side HTML rendering

### State & Events
- **AppState**: Application-wide state management
- **Events**: Event emitter with type-safe event handling
- **EventsManager**: Event subscription and lifecycle management

### Storage
- **Local**: Local file system utilities

### Integrations
- **Slack**: Slack notifications integration
- **ApiClient**: HTTP client for external APIs

## Usage Examples

### Basic Routing

```typescript
import { Router } from '@designofadecade/server';

const router = new Router();

// Add routes
router.addRoute({
  pattern: '/api/users/:id',
  method: 'GET',
  handler: async (req, res, params) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId: params.id }));
  }
});

// Handle requests
await router.route(request, response);
```

### WebSocket Communication

```typescript
import { WebSocketServer } from '@designofadecade/server';

const wsServer = new WebSocketServer({ port: 8080 });

wsServer.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (data) => {
    console.log('Received:', data);
    ws.send('Echo: ' + data);
  });
});
```

### Static File Serving

```typescript
import { StaticFileHandler } from '@designofadecade/server';

const staticHandler = new StaticFileHandler({
  rootDir: './public',
  cacheControl: 'public, max-age=3600'
});

await staticHandler.serve(request, response, '/assets/style.css');
```

### Event System

```typescript
import { Events, EventsManager } from '@designofadecade/server';

const events = new Events();
const manager = new EventsManager(events);

// Subscribe to events
manager.on('user:login', (data) => {
  console.log('User logged in:', data);
});

// Emit events
events.emit('user:login', { userId: 123, timestamp: Date.now() });
```

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[Logger Documentation](docs/logger.md)** - CloudWatch Logger with AWS Lambda integration, sensitive data redaction, and performance tracking
- **[API Documentation](docs/api-documentation.md)** - OpenAPI/Swagger documentation generation guide
- **[New Features](FEATURES.md)** - Performance benchmarks, pre-commit hooks, and recent additions
- **[Changelog](CHANGELOG.md)** - Version history and release notes
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute to the project

## Development

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
npm test                 # Run tests once
npm run test:watch      # Run tests in watch mode
npm run test:ui         # Open Vitest UI
npm run test:coverage   # Generate coverage report
```

### Build
```bash
npm run build           # Build once
npm run build:watch     # Build in watch mode
```

### Linting & Formatting
```bash
npm run lint            # Run ESLint
npm run format          # Format code with Prettier
npm run typecheck       # Type-check without emitting
```

## Project Structure

```
src/
├── client/             # API client utilities
├── context/            # Request context handling
├── docs/               # OpenAPI/Swagger documentation generators
├── events/             # Event system with pub/sub pattern
├── local/              # Local storage utilities
├── logger/             # Logging utilities with CloudWatch support
├── middleware/         # Request middleware (logging, etc.)
├── notifications/      # Notification integrations (Slack, etc.)
├── router/             # Routing system with URL pattern matching
├── sanitizer/          # HTML sanitization for XSS protection
├── server/             # Core HTTP/HTTPS server implementation
├── state/              # Application state management
├── types/              # TypeScript type definitions
├── utils/              # Utilities and helpers
└── websocket/          # WebSocket server implementation
```

## API Reference

Full API documentation is available in the [docs](docs/) directory:

- **[Server](docs/server.md)** - Core server setup and configuration
- **[Router](docs/router.md)** - Routing and request handling
- **[WebSocket](docs/websocket.md)** - WebSocket server and messaging
- **[Logger](docs/logger.md)** - CloudWatch logging and performance tracking
- **[Events Manager](docs/events-manager.md)** - Event system usage
- **[API Documentation](docs/api-documentation.md)** - OpenAPI/Swagger setup
- **[State & Context](docs/context-state.md)** - State management
- **[Utilities](docs/utilities.md)** - Helper functions and utilities

## Security

This package includes built-in security features:

- **HTML Sanitization** - XSS protection for user-generated content
- **Type Safety** - Full TypeScript support for compile-time safety
- **Input Validation** - URL pattern matching and parameter validation

If you discover a security vulnerability, please send an email to info@designofadecade.com instead of using the issue tracker.

## Versioning

This project follows [Semantic Versioning](https://semver.org/). For available versions, see the [tags on this repository](https://github.com/designofadecade/server/tags) or the [npm registry](https://www.npmjs.com/package/@designofadecade/server).

See [CHANGELOG.md](CHANGELOG.md) for a history of changes.

## Support

- **Documentation**: [GitHub Repository](https://github.com/designofadecade/server)
- **Issues**: [GitHub Issues](https://github.com/designofadecade/server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/designofadecade/server/discussions)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on:

- Code of Conduct
- Development workflow
- Pull request process
- Coding standards
- Testing requirements

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Design of a Decade**  
Email: info@designofadecade.com  
Website: [designofadecade.com](https://designofadecade.com)

## Links

- [GitHub Repository](https://github.com/designofadecade/server)
- [npm Package](https://www.npmjs.com/package/@designofadecade/server)
- [Issue Tracker](https://github.com/designofadecade/server/issues)
- [Changelog](CHANGELOG.md)

## Acknowledgments

Built with:
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vitest](https://vitest.dev/) - Unit testing framework
- [ws](https://github.com/websockets/ws) - WebSocket implementation

---

Made with ❤️ by Design of a Decade
