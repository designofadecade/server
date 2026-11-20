# Utility Classes

Collection of utility classes for common tasks like HTML rendering, request logging, static file serving, and Slack notifications.

## StaticFileHandler

Secure static file serving with MIME type detection, caching, and security features.

### Overview

`StaticFileHandler` provides production-ready static file serving with directory traversal protection, automatic MIME type detection, and cache control.

### Installation

```typescript
import StaticFileHandler from '@designofadecade/server/router/StaticFileHandler';
```

### Quick Start

```typescript
import StaticFileHandler from '@designofadecade/server/router/StaticFileHandler';
import Routes from '@designofadecade/server/router/Routes';

class StaticRoutes extends Routes {
  constructor(router: Router) {
    super(router);

    // Serve static files from public directory
    const handler = new StaticFileHandler('./public', {
      cacheControl: 'public, max-age=3600',
    });

    this.addRoute('/static/*', 'GET', async (req) => {
      return await handler.serve(req.path.replace('/static', ''));
    });
  }
}
```

### API Reference

#### Constructor

```typescript
new StaticFileHandler(baseDir: string, options?: {
  cacheControl?: string;
})
```

**Parameters:**

- `baseDir` (string) - Base directory to serve files from (absolute path)
- `options` (object, optional)
  - `cacheControl` (string) - Cache-Control header value. Default: `'public, max-age=3600'`

**Throws:**

- `Error` - If baseDir is not a valid string

#### serve()

```typescript
async serve(requestPath: string): Promise<ServeResponse>
```

Serve a static file.

**Parameters:**

- `requestPath` (string) - Requested file path

**Returns:** Promise resolving to response object

**Example:**

```typescript
const handler = new StaticFileHandler('/var/www/public');

// Serve specific file
const response = await handler.serve('/assets/style.css');

// Serve with directory index
const index = await handler.serve('/');
// Returns /index.html if it exists
```

### Security Features

- **Directory Traversal Protection:** Prevents access outside base directory
- **403 Forbidden:** Returns 403 for invalid paths
- **404 Not Found:** Returns 404 for missing files
- **MIME Type Validation:** Automatic content type detection
- **X-Content-Type-Options:** Adds `nosniff` header

### Supported MIME Types

```typescript
'.html' => 'text/html'
'.css'  => 'text/css'
'.js'   => 'application/javascript'
'.json' => 'application/json'
'.png'  => 'image/png'
'.jpg'  => 'image/jpeg'
'.gif'  => 'image/gif'
'.svg'  => 'image/svg+xml'
'.woff' => 'font/woff'
'.woff2' => 'font/woff2'
// ... and more
```

### Example Integration

```typescript
import Router from '@designofadecade/server/router';
import Routes from '@designofadecade/server/router/Routes';
import StaticFileHandler from '@designofadecade/server/router/StaticFileHandler';

class AppRoutes extends Routes {
  private staticHandler: StaticFileHandler;

  constructor(router: Router) {
    super(router);

    // Serve static assets
    this.staticHandler = new StaticFileHandler('./public', {
      cacheControl: 'public, max-age=31536000, immutable',
    });

    // API routes
    this.addRoute('/api/users', 'GET', this.getUsers);

    // Static files (must be last)
    this.addRoute('/*', 'GET', this.serveStatic);
  }

  async serveStatic(req: RouterRequest): Promise<RouterResponse> {
    return await this.staticHandler.serve(req.path);
  }
}
```

---

## RouteError

Custom error class for HTTP errors with status codes.

### Installation

```typescript
import RouteError from '@designofadecade/server/router/RouteError';
```

### Quick Start

```typescript
import RouteError from '@designofadecade/server/router/RouteError';

// Throw HTTP errors
throw new RouteError('User not found', 404);
throw new RouteError('Unauthorized', 401);
throw new RouteError('Bad Request', 400);
```

### API Reference

#### Constructor

```typescript
new RouteError(message: string, statusCode?: number)
```

**Parameters:**

- `message` (string) - Error message
- `statusCode` (number, optional) - HTTP status code. Default: `500`

### Usage Examples

```typescript
class UserRoutes extends Routes {
  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const user = await db.users.findById(req.params.id);

    if (!user) {
      throw new RouteError('User not found', 404);
    }

    return {
      status: 200,
      body: user,
    };
  }

  async createUser(req: RouterRequest): Promise<RouterResponse> {
    if (!req.body.email) {
      throw new RouteError('Email is required', 400);
    }

    const user = await db.users.create(req.body);

    return {
      status: 201,
      body: user,
    };
  }
}
```

---

## HtmlRenderer

Simple HTML template rendering utility.

### Installation

```typescript
import HtmlRenderer from '@designofadecade/server/utils/HtmlRenderer';
```

### Quick Start

```typescript
import HtmlRenderer from '@designofadecade/server/utils/HtmlRenderer';

const html = HtmlRenderer.render(
  `
  <html>
    <head>
      <title>{{title}}</title>
    </head>
    <body>
      <h1>{{heading}}</h1>
      <p>{{message}}</p>
    </body>
  </html>
`,
  {
    title: 'My Page',
    heading: 'Welcome!',
    message: 'Hello, World!',
  }
);
```

### API Reference

#### render()

```typescript
static render(template: string, data: Record<string, any>): string
```

Render HTML template with data.

**Escaping.** `{{value}}` is HTML-escaped, so interpolated data cannot introduce
markup or break out of an attribute:

```typescript
HtmlRenderer.render('<p>{{comment}}</p>', {
  comment: '<img src=x onerror=alert(1)>',
});
// '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
```

Use the triple-brace form `{{{value}}}` only for values you know are safe HTML —
never for anything a user supplied:

```typescript
HtmlRenderer.render('<div>{{{body}}}</div>', { body: '<b>bold</b>' });
// '<div><b>bold</b></div>'
```

**Data is never treated as template syntax.** A value containing `{{...}}` is
rendered literally rather than resolved, so data cannot read other variables or
introduce a block:

```typescript
HtmlRenderer.render('{{#each items}}{{name}}{{/each}}', {
  secret: 'S3CRET',
  items: [{ name: '{{secret}}' }],
});
// '{{secret}}' - not 'S3CRET'
```

**Parameters:**

- `template` (string) - HTML template with `{{key}}` placeholders
- `data` (object) - Data to inject into template

**Returns:** Rendered HTML string

### Example

```typescript
class PageRoutes extends Routes {
  async home(req: RouterRequest): Promise<RouterResponse> {
    const html = HtmlRenderer.render(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>{{title}}</title>
        </head>
        <body>
          <h1>{{username}}</h1>
          <p>Last login: {{lastLogin}}</p>
        </body>
      </html>
    `,
      {
        title: 'Dashboard',
        username: req.authorizer?.name || 'Guest',
        lastLogin: new Date().toLocaleString(),
      }
    );

    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html,
    };
  }
}
```

---

## RequestLogger

Request-scoped logging helpers that attach method, path, client IP, request id
and user agent to every line.

### Installation

```typescript
import { createRequestLogger, logRequest, logResponse } from '@designofadecade/server';
```

### Quick Start

```typescript
const requestLogger = createRequestLogger(req); // req: RouterRequest

requestLogger.info('Processing user creation');
requestLogger.error('Validation failed', { errors });
```

### API Reference

```typescript
createRequestLogger(request: RouterRequest | ApiGatewayEvent): {
  info(message: string, context?: Record<string, any>): void;
  error(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  debug(message: string, context?: Record<string, any>): void;
}

logRequest(request: RouterRequest | ApiGatewayEvent, options?: LogRequestOptions): void;
logResponse(request: RouterRequest | ApiGatewayEvent, response: { status?: number; statusCode?: number }, durationMs: number): void;
```

Pass the `RouterRequest` the router hands to middleware and handlers
(preferred). It already carries `clientIp` and `requestId` from a source the
caller cannot forge, in all three deployment modes. Any object with a string
`method` property is treated as a `RouterRequest`; API Gateway events have no
top-level `method`, so the two are told apart by that. A raw API Gateway event
(format 2.0 or 1.0) is also accepted; its `sourceIp` is read from
`requestContext.http.sourceIp` / `requestContext.identity.sourceIp`, never from
`X-Forwarded-For`.

By default `logRequest` logs no request data values at all:

- the body as a summary only: `{ contentType, bytes }` for a raw body,
  `{ contentType, fields }` for a parsed object, `{ contentType, items }` for
  an array;
- query and path parameters as their names only, e.g.
  `queryParams: ['page', 'email']` (at most 50 names, each cut at 256
  characters).

A body or query string can hold personal data under any name (`dob`,
`diagnosis`, `address`), and a list of names to redact can never be complete,
so logging values means naming the fields you want:

```typescript
interface LogRequestOptions {
  /** Log body content. Default false. Needs a non-empty bodyFields. */
  logBody?: boolean;
  /** Body field names to log; every other field becomes '[REDACTED]'. */
  bodyFields?: readonly string[];
  /** Query and path parameter names whose values are logged. */
  paramFields?: readonly string[];
}

logRequest(req, {
  logBody: true,
  bodyFields: ['orderId', 'items', 'sku', 'qty'],
  paramFields: ['page', 'id'],
});
```

`logBody: true` without a non-empty `bodyFields` logs the summary only and
writes one `REQUEST_LOGGER_BODY_FIELDS_REQUIRED` warning per process (it never
throws at request time).

The allowlists follow the same rules:

- Every key not listed is `[REDACTED]`, at any depth. Names match exactly. A
  nested object or array is walked only when its own key is listed, so
  `{ order: { id } }` needs both `order` and `id`. Primitives in a top-level
  array have no field name and are redacted.
- Keys matching the logger's sensitive list (`password`, `token`, `secret`,
  `apiKey`, `authorization`, `cookie`, `session`, `cardNumber`, `cvv`, `ssn`,
  ...) are always `[REDACTED]`, even when listed.
- String values are cut at 256 characters and nesting at 10 levels.
- A raw event body is parsed as JSON (never thrown on). A body that is text
  rather than JSON (form posts, multipart, plain text, base64) is never logged,
  because redaction cannot see inside a string; it appears as
  `[text body omitted, N chars]`.

`logResponse` accepts a
`RouterResponse` (`status`) or an Event Function result (`statusCode`) and logs
at `error` level for 4xx/5xx.

### Example

```typescript
class UserRoutes extends Routes {
  async createUser(req: RouterRequest): Promise<RouterResponse> {
    const logger = createRequestLogger(req);

    logger.info('Creating user', { userId: req.authorizer?.sub });

    try {
      const user = await db.users.create(req.body);
      logger.info('User created', { userId: user.id });

      return {
        status: 201,
        body: user,
      };
    } catch (error: any) {
      logger.error('Failed to create user', { error: error.message });
      throw error;
    }
  }
}
```

---

## Slack

Slack webhook notification utility.

### Installation

```typescript
import Slack from '@designofadecade/server/notifications';
```

### Quick Start

```typescript
import Slack from '@designofadecade/server/notifications';

const webhookUrl = process.env.SLACK_WEBHOOK_URL;

// Simple notification
await Slack.sendNotification(webhookUrl, 'Hello from server!');

// Rich message
await Slack.sendMessage({
  webhookUrl,
  text: 'Deployment completed',
  channel: '#deployments',
  username: 'Deploy Bot',
  icon_emoji: ':rocket:',
  attachments: [
    {
      color: 'good',
      title: 'Production Deploy',
      text: 'Version 1.2.3 deployed successfully',
      fields: [
        { title: 'Environment', value: 'Production', short: true },
        { title: 'Version', value: '1.2.3', short: true },
      ],
    },
  ],
});
```

### API Reference

#### sendNotification()

```typescript
static async sendNotification(
  webhookUrl: string,
  message: string,
  options?: Record<string, any>
): Promise<{ success: boolean; status: number }>
```

Send simple text notification.

**Parameters:**

- `webhookUrl` (string) - Slack webhook URL
- `message` (string) - Message text
- `options` (object, optional) - Additional Slack message options

#### sendMessage()

```typescript
static async sendMessage({
  webhookUrl: string;
  text?: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  blocks?: any[];
  attachments?: any[];
}): Promise<{ success: boolean; status: number }>
```

Send formatted Slack message.

### Examples

#### Error Notifications

```typescript
try {
  await processData();
} catch (error: any) {
  await Slack.sendMessage({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    text: 'Error in data processing',
    channel: '#errors',
    username: 'Error Bot',
    icon_emoji: ':warning:',
    attachments: [
      {
        color: 'danger',
        title: 'Processing Error',
        text: error.message,
        fields: [
          { title: 'Environment', value: process.env.NODE_ENV, short: true },
          { title: 'Timestamp', value: new Date().toISOString(), short: true },
        ],
      },
    ],
  });
}
```

#### Deployment Notifications

```typescript
const deployInfo = {
  version: '1.2.3',
  environment: 'production',
  deployedBy: 'john@example.com',
};

await Slack.sendMessage({
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  text: `Deployed version ${deployInfo.version} to ${deployInfo.environment}`,
  channel: '#deployments',
  username: 'Deploy Bot',
  icon_emoji: ':rocket:',
  attachments: [
    {
      color: 'good',
      title: 'Deployment Successful',
      fields: [
        { title: 'Version', value: deployInfo.version, short: true },
        { title: 'Environment', value: deployInfo.environment, short: true },
        { title: 'Deployed By', value: deployInfo.deployedBy, short: false },
      ],
      footer: 'CI/CD Pipeline',
      ts: Math.floor(Date.now() / 1000),
    },
  ],
});
```

#### Monitoring Alerts

```typescript
const metrics = await getSystemMetrics();

if (metrics.cpuUsage > 80) {
  await Slack.sendMessage({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    text: 'High CPU usage detected',
    channel: '#monitoring',
    username: 'Monitoring Bot',
    icon_emoji: ':chart_with_upwards_trend:',
    attachments: [
      {
        color: 'warning',
        title: 'Performance Alert',
        text: `CPU usage is at ${metrics.cpuUsage}%`,
        fields: [
          { title: 'CPU', value: `${metrics.cpuUsage}%`, short: true },
          { title: 'Memory', value: `${metrics.memoryUsage}%`, short: true },
          { title: 'Server', value: metrics.serverName, short: false },
        ],
      },
    ],
  });
}
```

## Best Practices

### StaticFileHandler

1. **Long Cache Times:** Use long cache for static assets with versioned filenames

   ```typescript
   // assets/app.v123.js
   new StaticFileHandler('./public', {
     cacheControl: 'public, max-age=31536000, immutable',
   });
   ```

2. **Security:** Never expose sensitive directories
   ```typescript
   // Good
   new StaticFileHandler('./public');

   // Bad - exposes source code
   new StaticFileHandler('./');
   ```

### RouteError

1. **Specific Errors:** Use appropriate status codes
   ```typescript
   throw new RouteError('Not Found', 404);
   throw new RouteError('Unauthorized', 401);
   throw new RouteError('Forbidden', 403);
   throw new RouteError('Bad Request', 400);
   ```

### Slack

1. **Environment Variables:** Store webhook URL securely

   ```typescript
   const webhookUrl = process.env.SLACK_WEBHOOK_URL;
   if (!webhookUrl) {
     console.warn('Slack webhook not configured');
     return;
   }
   ```

2. **Error Handling:** Don't let Slack failures break app
   ```typescript
   try {
     await Slack.sendNotification(webhookUrl, message);
   } catch (error) {
     console.error('Failed to send Slack notification:', error);
     // Continue app execution
   }
   ```

## Related Documentation

- [Router](./router.md) - Request routing
- [Logger](./logger.md) - Structured logging
- [Server](./server.md) - HTTP server
