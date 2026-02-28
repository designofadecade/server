# Documentation Index

Comprehensive documentation for @designofadecade/server - A modern TypeScript server framework with WebSocket support, routing, HTML sanitization, and AWS Lambda compatibility.

## Core Components

### Server & Routing

- **[Server](./server.md)** - HTTP server wrapper with error handling and graceful shutdown
- **[Router](./router.md)** - High-performance request router with URLPattern support, middleware, and Lambda compatibility
- **[Routes](./router.md#routes-class)** - Base class for organizing route definitions
- **[Local Development](./local.md)** - Run AWS Lambda handlers locally with Node.js

### WebSocket & Real-time

- **[WebSocketServer](./websocket.md)** - Production-ready WebSocket server with automatic message formatting
- **[EventsManager](./events-manager.md)** - Event management system for organized WebSocket message handling
- **[WebSocketMessageFormatter](./websocket.md#message-format)** - Standardized message formatting

### Security & Sanitization

- **[HtmlSanitizer](./html-sanitizer.md)** - Production-grade HTML sanitization for XSS prevention
- **[Logger](./logger.md)** - CloudWatch-compatible structured logging with sensitive data redaction

### HTTP Client & Integrations

- **[ApiClient](./api-client.md)** - Feature-rich HTTP client with retry logic and interceptors
- **[Slack](./utilities.md#slack)** - Slack webhook notifications

### State & Context Management

- **[Context](./context-state.md#context)** - Abstract base class for type-safe application context
- **[AppState](./context-state.md#appstate)** - Singleton state management for global application state

### Utilities

- **[StaticFileHandler](./utilities.md#staticfilehandler)** - Secure static file serving
- **[RouteError](./utilities.md#routeerror)** - Custom HTTP error class
- **[HtmlRenderer](./utilities.md#htmlrenderer)** - Simple HTML template rendering
- **[RequestLogger](./utilities.md#requestlogger)** - Request logging middleware
- **[OpenApiGenerator](./api-documentation.md)** - OpenAPI/Swagger documentation generation

## Quick Start Examples

### HTTP Server with Router

```typescript
import Server from '@designofadecade/server';
import Router from '@designofadecade/server/router';
import Routes from '@designofadecade/server/router/Routes';

// Define routes
class UserRoutes extends Routes {
  constructor(router: Router) {
    super(router);
    this.addRoute('/users', 'GET', this.listUsers);
    this.addRoute('/users/:id', 'GET', this.getUser);
  }
  
  async listUsers(req) {
    return { status: 200, body: { users: [] } };
  }
  
  async getUser(req) {
    return { status: 200, body: { id: req.params.id } };
  }
}

// Initialize
const router = new Router({ initRoutes: [UserRoutes] });
const server = new Server({ port: 3000 }, router.nodeJSRequest.bind(router));
```

### WebSocket Server with Events

```typescript
import WebSocketServer from '@designofadecade/server/websocket';
import EventsManager from '@designofadecade/server/events';
import Events from '@designofadecade/server/events/Events';

// Define event handlers
class ChatEvents extends Events {
  constructor(manager) {
    super(manager);
    this.addEvent('chat:message', this.handleMessage);
  }
  
  async handleMessage(msg) {
    this.manager.broadcast('chat:message', msg.payload);
  }
}

// Initialize
const wss = new WebSocketServer({ port: 8080 });
const events = new EventsManager({
  registerWebSocketServer: wss,
  initEvents: [ChatEvents]
});
```

### HTML Sanitization

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

const userInput = '<p>Hello <script>alert("xss")</script></p>';
const safe = HtmlSanitizer.clean(userInput, ['p', 'b', 'i']);
// Returns: '<p>Hello </p>'
```

### HTTP Client

```typescript
import ApiClient from '@designofadecade/server/client';

const client = new ApiClient('https://api.example.com');
client.setAuthToken('your-token');

const users = await client.get('/users', { page: 1, limit: 10 });
const newUser = await client.post('/users', { name: 'John' });
```

## Architecture Patterns

### Full-Stack Application

```typescript
import Server from '@designofadecade/server';
import Router from '@designofadecade/server/router';
import WebSocketServer from '@designofadecade/server/websocket';
import EventsManager from '@designofadecade/server/events';
import Context from '@designofadecade/server/context';

// Application context
class AppContext extends Context {
  constructor(
    public readonly database: Database,
    public readonly config: Config
  ) {
    super();
  }
}

// Initialize context
const context = new AppContext(db, config);

// HTTP server
const router = new Router({
  context,
  initRoutes: [UserRoutes, PostRoutes]
});

const httpServer = new Server(
  { port: 3000 },
  router.nodeJSRequest.bind(router)
);

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });

const eventsManager = new EventsManager({
  registerWebSocketServer: wss,
  initEvents: [ChatEvents, NotificationEvents]
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await httpServer.close();
  await wss.close();
  eventsManager.close();
  process.exit(0);
});
```

### AWS Lambda Application

```typescript
import Router from '@designofadecade/server/router';
import Local from '@designofadecade/server/local';

// Define routes
const router = new Router({
  initRoutes: [ApiRoutes]
});

// Lambda handler
export const handler = async (event: any) => {
  return await router.lambdaEvent(event);
};

// Local development
if (process.env.NODE_ENV === 'development') {
  const localHandler = Local.LambdaProxyRouter(handler);
  const server = http.createServer((req, res) => {
    localHandler.request(req, res);
  });
  server.listen(3000);
}
```

## Key Features

### 🚀 Performance
- Route caching for fast lookups
- Efficient WebSocket broadcasting
- Configurable request timeouts
- Body size limits (1MB default)

### 🔒 Security
- XSS prevention with HtmlSanitizer
- Directory traversal protection
- Sensitive data redaction in logs
- DoS protection with size limits
- URL validation in sanitizer

### 📊 Observability
- CloudWatch-compatible structured logging
- Error codes for monitoring
- Source tracking for debugging
- Request context propagation
- Performance metrics

### 🔄 Flexibility
- AWS Lambda compatible
- Node.js HTTP server support
- URLPattern-based routing
- Middleware system
- Custom context injection

### ⚡ Developer Experience
- TypeScript first
- Comprehensive documentation
- Local development utilities
- Hot reload support
- Extensive test coverage (556+ tests)

## Configuration

### Environment Variables

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# WebSocket
WS_PORT=8080

# Database
DATABASE_URL=mongodb://localhost:27017/mydb

# Cache
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key

# Logging
LOG_LEVEL=info

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# AWS (for Lambda deployment)
AWS_REGION=us-east-1
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

## Testing

The framework includes comprehensive test coverage:

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Benchmarks
npm run bench
```

## Best Practices

### 1. Error Handling

```typescript
// Use RouteError for expected errors
throw new RouteError('User not found', 404);

// Try-catch for unexpected errors
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { code: 'OP_FAILED', error });
  throw new RouteError('Internal error', 500);
}
```

### 2. Logging

```typescript
// Always include error codes and source
logger.error('Database connection failed', {
  code: 'DB_CONNECTION_ERROR',
  source: 'UserService.getUser',
  error
});
```

### 3. Sanitization

```typescript
// Sanitize all user input before storage
const safe = HtmlSanitizer.clean(userInput, allowedTags);
await db.save(safe);

// Sanitize again before display (defense in depth)
const display = HtmlSanitizer.clean(content, allowedTags);
```

### 4. Context Usage

```typescript
// Keep context immutable
class AppContext extends Context {
  constructor(
    public readonly db: Database,  // readonly
    public readonly config: Config // readonly
  ) {
    super();
  }
}
```

### 5. Route Organization

```typescript
// Group related routes
class UserRoutes extends Routes {
  static basePath = '/api/users';
}

class AdminRoutes extends Routes {
  static basePath = '/api/admin';
  static register = [UserAdminRoutes, PostAdminRoutes];
}
```

## Migration Guides

### From Express.js

```typescript
// Express
app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

// @designofadecade/server
class UserRoutes extends Routes {
  constructor(router) {
    super(router);
    this.addRoute('/users/:id', 'GET', this.getUser);
  }
  
  async getUser(req) {
    return {
      status: 200,
      body: { id: req.params.id }
    };
  }
}
```

### From Socket.IO

```typescript
// Socket.IO
io.on('connection', (socket) => {
  socket.on('chat:message', (data) => {
    io.emit('chat:message', data);
  });
});

// @designofadecade/server
class ChatEvents extends Events {
  constructor(manager) {
    super(manager);
    this.addEvent('chat:message', this.handleMessage);
  }
  
  async handleMessage(msg) {
    this.manager.broadcast('chat:message', msg.payload);
  }
}
```

## Support & Contributing

### Getting Help

- **Documentation Issues:** File an issue if docs are unclear
- **Bug Reports:** Include minimal reproduction example
- **Feature Requests:** Explain use case and benefits

### Contributing

1. Check existing issues and pull requests
2. Follow TypeScript best practices
3. Add tests for new features
4. Update documentation
5. Run `npm test` before submitting

## Version History

- **v3.1.0** - Logger improvements, production hardening
- **v3.0.0** - Major refactor with TypeScript
- **v2.0.0** - Added WebSocket and Events system
- **v1.0.0** - Initial release

## License

See [LICENSE](../LICENSE) file for details.

## Related Links

- [GitHub Repository](#)
- [NPM Package](#)
- [Examples Repository](#)
- [API Reference](#)
