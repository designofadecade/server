# Server

HTTP server wrapper for Node.js with built-in error handling, port validation, and graceful shutdown capabilities.

## Overview

The `Server` class provides a production-ready HTTP server implementation that wraps Node.js's native HTTP server with enhanced error handling, logging, and lifecycle management.

## Installation

```typescript
import Server from '@designofadecade/server';
```

## Basic Usage

```typescript
import Server from '@designofadecade/server';

// Create server with request handler
const server = new Server(
  { port: 3000, host: '0.0.0.0' },
  (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello World');
  }
);

// Server starts automatically on instantiation
```

## API Reference

### Constructor

```typescript
new Server(options: ServerOptions, requestHandler: RequestHandler)
```

#### Parameters

- `options` - Configuration object
  - `port` (number, optional) - Port number (1-65535). Default: `3000`
  - `host` (string, optional) - Host to bind to. Default: `'0.0.0.0'`
- `requestHandler` (function) - Function to handle incoming HTTP requests
  - Signature: `(req: IncomingMessage, res: ServerResponse) => void`

#### Throws

- `Error` - If port is invalid (not between 1-65535)
- `Error` - If request handler is not a function

### Properties

#### server

```typescript
get server(): Http.Server | null
```

Returns the underlying Node.js HTTP server instance.

**Returns:** `Http.Server | null`

### Methods

#### close()

```typescript
close(): Promise<void>
```

Gracefully closes the server and stops accepting new connections.

**Returns:** Promise that resolves when server is closed or rejects on error

**Example:**
```typescript
await server.close();
console.log('Server closed successfully');
```

## Configuration Examples

### Development Server

```typescript
const devServer = new Server(
  { port: 3000, host: 'localhost' },
  (req, res) => {
    res.end('Development mode');
  }
);
```

### Production Server

```typescript
const prodServer = new Server(
  { port: 8080, host: '0.0.0.0' },
  (req, res) => {
    // Your production request handler
  }
);
```

### Custom Port from Environment

```typescript
const port = parseInt(process.env.PORT || '3000', 10);
const server = new Server({ port }, requestHandler);
```

## Error Handling

The Server class automatically handles common errors:

### Port Already in Use (EADDRINUSE)

```typescript
// Logs error and exits process with code 1
// Error code: SERVER_PORT_IN_USE
```

### General Server Errors

```typescript
// Logs error details and exits process with code 1
// Error code: SERVER_ERROR
```

### Close Errors

```typescript
try {
  await server.close();
} catch (error) {
  // Error code: SERVER_CLOSE_ERROR
  console.error('Failed to close server:', error);
}
```

## Integration with Router

```typescript
import Server from '@designofadecade/server';
import Router from '@designofadecade/server/router';

const router = new Router({
  initRoutes: [MyRoutes]
});

const server = new Server(
  { port: 3000 },
  router.nodeJSRequest.bind(router)
);
```

## Logging

The Server class uses the built-in logger for CloudWatch-compatible structured logging:

- **Startup:** Logs server listening on host:port
- **Errors:** Logs with error codes for monitoring
- **Shutdown:** Logs successful close or errors

All logs include `source` field for tracking (e.g., `Server.start`, `Server.close`).

## Best Practices

1. **Port Validation:** Always validate port numbers are within valid range (1-65535)
2. **Error Handling:** Server exits on critical errors - use process managers like PM2 for auto-restart
3. **Graceful Shutdown:** Always call `close()` on shutdown signals:
   ```typescript
   process.on('SIGTERM', async () => {
     await server.close();
     process.exit(0);
   });
   ```
4. **Host Binding:** 
   - Use `0.0.0.0` for production (accepts external connections)
   - Use `localhost` for development (local only)

## Type Definitions

```typescript
interface ServerOptions {
  port?: number;
  host?: string;
}

type RequestHandler = (
  req: IncomingMessage, 
  res: ServerResponse
) => void;
```

## Related Documentation

- [Router](./router.md) - Request routing and handling
- [Logger](./logger.md) - CloudWatch logging
- [Local Development](./local.md) - Local testing utilities

## Examples

### Complete Application

```typescript
import Server from '@designofadecade/server';
import Router from '@designofadecade/server/router';
import { UserRoutes, PostRoutes } from './routes';

// Initialize router
const router = new Router({
  initRoutes: [UserRoutes, PostRoutes]
});

// Create server
const server = new Server(
  {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0'
  },
  router.nodeJSRequest.bind(router)
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  await server.close();
  process.exit(0);
});
```
