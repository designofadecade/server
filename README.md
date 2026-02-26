# Design of a Decade Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node->=24.0.0-brightgreen.svg)](https://nodejs.org)

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

This package is published to GitHub Packages. To install:

1. **Create or update `.npmrc` in your project root:**
   ```
   @designofadecade:registry=https://npm.pkg.github.com
   ```

2. **Authenticate with GitHub Packages:**
   ```bash
   npm login --registry=https://npm.pkg.github.com
   # Username: your-github-username
   # Password: your-github-personal-access-token (with read:packages permission)
   ```

3. **Install the package:**
   ```bash
   npm install @designofadecade/server
   ```

### Requirements

- **Node.js** >= 24.0.0
- **ES Modules** support (package uses `"type": "module"`)
- TypeScript >= 5.0 (if using TypeScript)
- GitHub account with read:packages permission

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
├── events/             # Event system
├── local/              # Local storage utilities
├── logger/             # Logging utilities
├── middleware/         # Request middleware
├── notifications/      # Notification integrations (Slack, etc.)
├── router/             # Routing system
├── sanitizer/          # HTML sanitization
├── server/             # Core server implementation
├── state/              # Application state management
├── types/              # TypeScript type definitions
├── utils/              # Utilities and helpers
└── websocket/          # WebSocket server implementation
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Design of a Decade <info@designofadecade.com>

## Repository

[https://github.com/designofadecade/server](https://github.com/designofadecade/server)
