# WebSocket Server

Production-ready WebSocket server with automatic message formatting, connection management, and event handling.

## Overview

The `WebSocketServer` class provides a robust WebSocket implementation built on the `ws` library with automatic message formatting, error handling, and integration with the Events system.

## Installation

```typescript
import WebSocketServer from '@designofadecade/server/websocket';
```

## Quick Start

```typescript
import WebSocketServer from '@designofadecade/server/websocket';

// Create WebSocket server
const wss = new WebSocketServer({
  port: 8080,
  host: '0.0.0.0'
});

// Handle incoming messages
wss.on('message', (parsed) => {
  console.log('Received:', parsed.type, parsed.payload);
});

// Broadcast to all clients
wss.broadcast('notification', { text: 'Hello everyone!' });

// Get client count
console.log(`Connected clients: ${wss.clientCount}`);
```

## API Reference

### Constructor

```typescript
new WebSocketServer(options?: WebSocketServerOptions)
```

**Options:**
- `port` (number, optional) - Port number (1-65535). Default: `8080`
- `host` (string, optional) - Host to bind to. Default: `'0.0.0.0'`

**Throws:**
- `Error` - If port is invalid (not between 1-65535)

**Example:**
```typescript
const wss = new WebSocketServer({ port: 8080, host: 'localhost' });
```

### Properties

#### clientCount

```typescript
get clientCount(): number
```

Returns the number of currently connected clients.

**Returns:** `number` - Connected client count

**Example:**
```typescript
console.log(`Active connections: ${wss.clientCount}`);
```

### Methods

#### broadcast()

```typescript
broadcast(type: string, message: any): void
```

Broadcast a message to all connected clients.

**Parameters:**
- `type` (string) - Message type identifier
- `message` (any) - Message payload (will be serialized)

**Example:**
```typescript
// Send notification to all clients
wss.broadcast('notification', {
  title: 'System Update',
  body: 'Server will restart in 5 minutes'
});

// Send data update
wss.broadcast('data:update', {
  entity: 'users',
  action: 'created',
  data: newUser
});
```

#### close()

```typescript
close(): Promise<void>
```

Gracefully close the WebSocket server and disconnect all clients.

**Returns:** Promise that resolves when server is closed

**Example:**
```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  await wss.close();
  process.exit(0);
});
```

### Events

The WebSocketServer extends EventEmitter and emits the following events:

#### 'message'

Emitted when a valid message is received from any client.

```typescript
wss.on('message', (parsed: ParsedMessage) => {
  // Handle message
});
```

**ParsedMessage Format:**
```typescript
{
  id?: string;      // Optional message ID
  type: string;     // Message type
  payload: any;     // Message data
}
```

**Example:**
```typescript
wss.on('message', (parsed) => {
  switch (parsed.type) {
    case 'chat:message':
      handleChatMessage(parsed.payload);
      break;
    case 'user:typing':
      broadcastTypingIndicator(parsed.payload);
      break;
  }
});
```

## Message Format

All WebSocket messages use a standardized JSON format managed by `WebSocketMessageFormatter`.

### Outgoing Messages

```typescript
{
  "id": "uuid-v4",
  "type": "message:type",
  "payload": { /* your data */ },
  "timestamp": 1234567890
}
```

### Incoming Messages

Clients should send messages in the same format. The server automatically:
- Parses incoming JSON messages
- Validates message structure
- Emits parsed messages via the 'message' event

## Built-in Message Types

### ws:connected

Automatically sent to clients upon connection.

```json
{
  "type": "ws:connected",
  "payload": {
    "message": "WebSocket connection established"
  }
}
```

### ws:ping / ws:pong

Built-in ping/pong for connection keep-alive.

```javascript
// Client sends
{ "type": "ws:ping" }

// Server responds
{ "type": "ws:pong" }
```

### ws:error

Sent when message parsing or handling fails.

```json
{
  "type": "ws:error",
  "payload": {
    "error": "Invalid message format"
  }
}
```

## Integration with EventsManager

```typescript
import WebSocketServer from '@designofadecade/server/websocket';
import EventsManager from '@designofadecade/server/events';
import { ChatEvents, NotificationEvents } from './events';

// Create WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Create events manager
const eventsManager = new EventsManager({
  registerWebSocketServer: wss,
  initEvents: [ChatEvents, NotificationEvents]
});

// EventsManager automatically handles messages and broadcasting
```

## Error Handling

### Server Errors

The WebSocket server handles common errors automatically:

#### Port Already in Use (EADDRINUSE)

```typescript
// Logs error and exits process with code 1
// Error code: WEBSOCKET_PORT_IN_USE
```

#### Server Initialization Errors

```typescript
// Logs error and exits process with code 1
// Error code: WEBSOCKET_SERVER_ERROR
```

### Client Errors

Individual client errors are logged but don't affect other connections:

```typescript
// Error code: WEBSOCKET_CLIENT_ERROR
// Server continues running
```

### Message Handling Errors

```typescript
// Error code: WEBSOCKET_MESSAGE_ERROR
// Client receives ws:error message
```

### Broadcast Errors

```typescript
// Error code: WEBSOCKET_BROADCAST_ERROR
// Individual client failures logged, others continue to receive
```

## Connection Lifecycle

```
1. Client connects
   ↓
2. Server logs connection (WEBSOCKET_CLIENT_CONNECTED)
   ↓
3. Server sends ws:connected message
   ↓
4. Client can send/receive messages
   ↓
5. Client disconnects
   ↓
6. Server logs disconnection (WEBSOCKET_CLIENT_DISCONNECTED)
```

## Security Considerations

1. **Message Size:** Implement message size limits at application level
2. **Rate Limiting:** Add rate limiting for message handling
3. **Authentication:** Validate clients before accepting connections
4. **Message Validation:** Always validate message payloads

```typescript
wss.on('message', (parsed) => {
  // Validate message type
  const allowedTypes = ['chat:message', 'user:typing'];
  if (!allowedTypes.includes(parsed.type)) {
    return; // Ignore invalid types
  }
  
  // Validate payload structure
  if (!parsed.payload || typeof parsed.payload !== 'object') {
    return;
  }
  
  // Process valid message
  handleMessage(parsed);
});
```

## Best Practices

1. **Connection Limits:** Monitor `clientCount` and implement limits
   ```typescript
   if (wss.clientCount > MAX_CONNECTIONS) {
     // Reject new connections or scale horizontally
   }
   ```

2. **Graceful Shutdown:** Always close WebSocket server on process termination
   ```typescript
   process.on('SIGTERM', async () => {
     await wss.close();
   });
   ```

3. **Message Types:** Use namespaced message types
   ```typescript
   // Good: chat:message, user:typing, notification:new
   // Bad: message, typing, notification
   ```

4. **Error Recovery:** Handle client disconnections gracefully
   ```typescript
   wss.on('message', async (parsed) => {
     try {
       await processMessage(parsed);
     } catch (error) {
       // Log but don't crash
       console.error('Message processing failed:', error);
     }
   });
   ```

5. **Broadcast Efficiency:** Batch broadcasts when possible
   ```typescript
   const updates = await getMultipleUpdates();
   wss.broadcast('batch:update', { updates });
   ```

## Performance

- **Connection Management:** Efficient Set-based client tracking
- **Message Broadcasting:** Parallel broadcasting to all clients
- **Error Isolation:** Individual client errors don't affect others
- **Memory:** Automatic cleanup on client disconnect

## Examples

### Chat Application

```typescript
import WebSocketServer from '@designofadecade/server/websocket';

const wss = new WebSocketServer({ port: 8080 });

// Store user sessions
const sessions = new Map();

wss.on('message', (parsed) => {
  switch (parsed.type) {
    case 'chat:join':
      sessions.set(parsed.payload.userId, {
        username: parsed.payload.username,
        joinedAt: Date.now()
      });
      
      // Notify others
      wss.broadcast('user:joined', {
        username: parsed.payload.username
      });
      break;
      
    case 'chat:message':
      // Broadcast message to all
      wss.broadcast('chat:message', {
        username: parsed.payload.username,
        text: parsed.payload.text,
        timestamp: Date.now()
      });
      break;
      
    case 'chat:leave':
      sessions.delete(parsed.payload.userId);
      
      wss.broadcast('user:left', {
        username: parsed.payload.username
      });
      break;
  }
});
```

### Real-time Notifications

```typescript
import WebSocketServer from '@designofadecade/server/websocket';

const wss = new WebSocketServer({ port: 8080 });

// Database change watcher
database.on('change', (change) => {
  // Broadcast to all connected clients
  wss.broadcast('db:update', {
    collection: change.collection,
    operation: change.op,
    data: change.data
  });
});

// System notifications
function sendNotification(title: string, body: string) {
  wss.broadcast('notification', {
    title,
    body,
    timestamp: Date.now()
  });
}
```

### Client Health Monitoring

```typescript
const wss = new WebSocketServer({ port: 8080 });

// Monitor connection count
setInterval(() => {
  console.log(`Active connections: ${wss.clientCount}`);
  
  if (wss.clientCount === 0) {
    console.log('No active connections');
  }
  
  // Broadcast health check
  wss.broadcast('health:check', {
    timestamp: Date.now(),
    clients: wss.clientCount
  });
}, 30000);
```

## Client Example

```javascript
// Browser/Node.js WebSocket client
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
  console.log('Connected to WebSocket server');
  
  // Send a message
  ws.send(JSON.stringify({
    type: 'chat:message',
    payload: {
      username: 'John',
      text: 'Hello, everyone!'
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message.type, message.payload);
  
  // Handle connection confirmation
  if (message.type === 'ws:connected') {
    console.log('Connection confirmed');
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from server');
};

// Ping to keep connection alive
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ws:ping' }));
  }
}, 30000);
```

## Related Documentation

- [EventsManager](./events.md) - Event handling system
- [WebSocketMessageFormatter](./websocket-formatter.md) - Message formatting
- [Logger](./logger.md) - Structured logging
