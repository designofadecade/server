# EventsManager

WebSocket event management system for organized message handling and broadcasting.

## Overview

`EventsManager` provides a structured way to handle WebSocket events through event classes, automatic message routing, and broadcast capabilities. It integrates seamlessly with `WebSocketServer` for real-time bidirectional communication.

## Installation

```typescript
import EventsManager from '@designofadecade/server/events';
import Events from '@designofadecade/server/events/Events';
```

## Quick Start

```typescript
import EventsManager from '@designofadecade/server/events';
import Events from '@designofadecade/server/events/Events';
import WebSocketServer from '@designofadecade/server/websocket';

// Define event handlers
class ChatEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('chat:message', this.handleMessage);
    this.addEvent('chat:typing', this.handleTyping);
  }
  
  async handleMessage(msg) {
    console.log('Message:', msg.payload);
    // Broadcast to all clients
    this.manager.broadcast('chat:message', msg.payload);
  }
  
  async handleTyping(msg) {
    this.manager.broadcast('chat:typing', msg.payload);
  }
}

// Initialize WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Create events manager
const eventsManager = new EventsManager({
  registerWebSocketServer: wss,
  initEvents: [ChatEvents]
});
```

## API Reference

### Constructor

```typescript
new EventsManager(options?: EventsManagerOptions)
```

**Options:**
- `registerWebSocketServer` (WebSocketServer, optional) - WebSocket server to integrate with
- `initEvents` (Array, optional) - Array of Events classes to register

**Example:**
```typescript
const eventsManager = new EventsManager({
  registerWebSocketServer: wss,
  initEvents: [UserEvents, ChatEvents, NotificationEvents]
});
```

### Methods

#### registerEvents()

Register individual event handlers.

```typescript
registerEvents(events: EventRegistration[]): void
```

**Parameters:**
- `events` - Array of event registration objects
  - `type` (string) - Event type identifier
  - `handler` (function) - Async function to handle the event

**Throws:**
- `Error` - If events is not an array

**Example:**
```typescript
eventsManager.registerEvents([
  {
    type: 'ping',
    handler: async (msg) => {
      console.log('Ping received');
      eventsManager.broadcast('pong', {});
    }
  },
  {
    type: 'user:update',
    handler: async (msg) => {
      await updateUser(msg.payload);
      eventsManager.broadcast('user:updated', msg.payload);
    }
  }
]);
```

#### broadcast()

Broadcast a message to all connected WebSocket clients.

```typescript
broadcast(type: string, message: any): void
```

**Parameters:**
- `type` (string) - Message type identifier
- `message` (any) - Message payload (will be serialized)

**Throws:**
- `Error` - If type is not a string

**Example:**
```typescript
// Broadcast notification
eventsManager.broadcast('notification', {
  title: 'New Message',
  body: 'You have a new message from John'
});

// Broadcast data update
eventsManager.broadcast('data:update', {
  entity: 'users',
  action: 'created',
  data: newUser
});
```

#### close()

Close the events manager and unregister from WebSocket server.

```typescript
close(): void
```

**Example:**
```typescript
// Cleanup on shutdown
process.on('SIGTERM', () => {
  eventsManager.close();
  process.exit(0);
});
```

## Events Class

Base class for organizing event handlers.

### Constructor

```typescript
class MyEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    // Register event handlers
    this.addEvent('event:type', this.handler);
  }
}
```

### Properties

#### manager

```typescript
protected manager: EventsManager
```

Reference to the EventsManager instance.

**Example:**
```typescript
class UserEvents extends Events {
  async handleLogin(msg) {
    // Use manager to broadcast
    this.manager.broadcast('user:online', msg.payload);
  }
}
```

#### managerEvents

```typescript
get managerEvents(): EventRegistration[]
```

Returns array of registered event handlers.

### Methods

#### addEvent()

Register an event handler.

```typescript
addEvent(
  type: string,
  handler: (msg: ParsedMessage) => void | Promise<void>
): void
```

**Parameters:**
- `type` (string) - Event type identifier
- `handler` (function) - Function to handle the event

**Example:**
```typescript
class ChatEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('chat:message', this.handleMessage);
    this.addEvent('chat:join', this.handleJoin);
    this.addEvent('chat:leave', this.handleLeave);
  }
  
  async handleMessage(msg) {
    // Handle message
  }
}
```

## Message Format

Events work with parsed messages from WebSocketServer:

```typescript
interface ParsedMessage {
  id?: string;      // Optional message ID
  type: string;     // Event type
  payload: any;     // Message data
}
```

## Event Patterns

### Namespaced Events

Use namespaces to organize related events:

```typescript
class UserEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('user:login', this.handleLogin);
    this.addEvent('user:logout', this.handleLogout);
    this.addEvent('user:update', this.handleUpdate);
  }
}

class ChatEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('chat:message', this.handleMessage);
    this.addEvent('chat:typing', this.handleTyping);
    this.addEvent('chat:read', this.handleRead);
  }
}
```

### Broadcast Patterns

```typescript
// Broadcast to all
eventsManager.broadcast('notification', data);

// Conditional broadcasting
class ChatEvents extends Events {
  async handleMessage(msg) {
    const { roomId, text, userId } = msg.payload;
    
    // Store message
    await db.messages.create({ roomId, text, userId });
    
    // Broadcast to all clients
    // (clients filter by room on their end)
    this.manager.broadcast('chat:message', {
      roomId,
      text,
      userId,
      timestamp: Date.now()
    });
  }
}
```

### Error Handling

```typescript
class SafeEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('process:data', async (msg) => {
      try {
        await this.processData(msg.payload);
      } catch (error) {
        console.error('Processing failed:', error);
        
        // Notify client of error
        this.manager.broadcast('error', {
          type: 'process:data',
          error: error.message
        });
      }
    });
  }
}
```

## Error Codes

EventsManager logs errors with specific codes:

- `EVENT_INVALID_REGISTRATION` - Invalid event handler registration
- `EVENT_NO_WEBSOCKET` - WebSocket server not registered
- `EVENT_BROADCAST_ERROR` - Broadcasting failed
- `EVENT_HANDLER_ERROR` - Handler execution error
- `EVENT_NO_HANDLERS` - No handlers for event type
- `EVENT_PROCESSING_ERROR` - Message processing error

All errors include `source` field (e.g., `EventsManager.broadcast`).

## Best Practices

1. **Organize by Feature:** Group related events in separate classes
   ```typescript
   class UserEvents extends Events { }
   class ChatEvents extends Events { }
   class NotificationEvents extends Events { }
   ```

2. **Use Namespaces:** Prevent type collisions with namespaces
   ```typescript
   // Good
   'user:login', 'chat:message', 'notification:new'
   
   // Bad
   'login', 'message', 'new'
   ```

3. **Handle Errors:** Always catch and handle errors in event handlers
   ```typescript
   this.addEvent('risky:operation', async (msg) => {
     try {
       await riskyOperation(msg.payload);
     } catch (error) {
       console.error('Operation failed:', error);
     }
   });
   ```

4. **Validation:** Validate message payloads
   ```typescript
   async handleMessage(msg) {
     if (!msg.payload.text || typeof msg.payload.text !== 'string') {
       return; // Ignore invalid messages
     }
     
     // Process valid message
     this.manager.broadcast('chat:message', msg.payload);
   }
   ```

5. **Async Handlers:** Use async/await for database operations
   ```typescript
   async handleSave(msg) {
     // Save to database
     const result = await db.save(msg.payload);
     
     // Broadcast confirmation
     this.manager.broadcast('saved', { id: result.id });
   }
   ```

## Examples

### Chat Application

```typescript
import EventsManager from '@designofadecade/server/events';
import Events from '@designofadecade/server/events/Events';

class ChatEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('chat:join', this.handleJoin);
    this.addEvent('chat:leave', this.handleLeave);
    this.addEvent('chat:message', this.handleMessage);
    this.addEvent('chat:typing', this.handleTyping);
  }
  
  async handleJoin(msg) {
    const { roomId, username } = msg.payload;
    
    // Track user in room
    await rooms.addUser(roomId, username);
    
    // Notify others
    this.manager.broadcast('chat:user-joined', {
      roomId,
      username,
      timestamp: Date.now()
    });
  }
  
  async handleLeave(msg) {
    const { roomId, username } = msg.payload;
    
    await rooms.removeUser(roomId, username);
    
    this.manager.broadcast('chat:user-left', {
      roomId,
      username,
      timestamp: Date.now()
    });
  }
  
  async handleMessage(msg) {
    const { roomId, username, text } = msg.payload;
    
    // Validate
    if (!text || text.length > 500) {
      return;
    }
    
    // Save message
    const message = await db.messages.create({
      roomId,
      username,
      text,
      createdAt: new Date()
    });
    
    // Broadcast to all
    this.manager.broadcast('chat:message', {
      id: message.id,
      roomId,
      username,
      text,
      timestamp: message.createdAt
    });
  }
  
  async handleTyping(msg) {
    const { roomId, username } = msg.payload;
    
    // Broadcast typing indicator (no persistence)
    this.manager.broadcast('chat:typing', {
      roomId,
      username
    });
  }
}
```

### Real-time Collaboration

```typescript
class DocumentEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('doc:open', this.handleOpen);
    this.addEvent('doc:edit', this.handleEdit);
    this.addEvent('doc:cursor', this.handleCursor);
    this.addEvent('doc:close', this.handleClose);
  }
  
  async handleOpen(msg) {
    const { docId, userId } = msg.payload;
    
    // Track document viewer
    await documents.addViewer(docId, userId);
    
    // Broadcast viewer list
    const viewers = await documents.getViewers(docId);
    this.manager.broadcast('doc:viewers', {
      docId,
      viewers
    });
  }
  
  async handleEdit(msg) {
    const { docId, userId, changes } = msg.payload;
    
    // Apply changes
    await documents.applyChanges(docId, changes);
    
    // Broadcast to other viewers
    this.manager.broadcast('doc:changes', {
      docId,
      userId,
      changes,
      timestamp: Date.now()
    });
  }
  
  async handleCursor(msg) {
    const { docId, userId, position } = msg.payload;
    
    // Broadcast cursor position (no persistence)
    this.manager.broadcast('doc:cursor', {
      docId,
      userId,
      position
    });
  }
}
```

### Game Server

```typescript
class GameEvents extends Events {
  constructor(manager: EventsManager) {
    super(manager);
    
    this.addEvent('game:join', this.handleJoin);
    this.addEvent('game:move', this.handleMove);
    this.addEvent('game:action', this.handleAction);
    this.addEvent('game:leave', this.handleLeave);
  }
  
  async handleJoin(msg) {
    const { gameId, playerId, playerName } = msg.payload;
    
    // Add player to game
    const game = await games.addPlayer(gameId, playerId, playerName);
    
    // Broadcast game state
    this.manager.broadcast('game:state', {
      gameId,
      players: game.players,
      status: game.status
    });
    
    // Start game if ready
    if (game.players.length === game.maxPlayers) {
      await games.start(gameId);
      this.manager.broadcast('game:started', { gameId });
    }
  }
  
  async handleMove(msg) {
    const { gameId, playerId, move } = msg.payload;
    
    // Validate and apply move
    const game = await games.applyMove(gameId, playerId, move);
    
    // Broadcast updated state
    this.manager.broadcast('game:moved', {
      gameId,
      playerId,
      move,
      state: game.state
    });
    
    // Check for game over
    if (game.isOver) {
      this.manager.broadcast('game:over', {
        gameId,
        winner: game.winner
      });
    }
  }
}
```

## Integration Patterns

### With Router

```typescript
import Router from '@designofadecade/server/router';
import EventsManager from '@designofadecade/server/events';

class ApiRoutes extends Routes {
  constructor(router: Router, eventsManager: EventsManager) {
    super(router);
    this.eventsManager = eventsManager;
    
    this.addRoute('/api/notify', 'POST', this.notify);
  }
  
  async notify(req) {
    // HTTP endpoint triggers WebSocket broadcast
    this.eventsManager.broadcast('notification', req.body);
    
    return {
      status: 200,
      body: { sent: true }
    };
  }
}
```

### With Database Events

```typescript
// Database change listener
database.on('change', (change) => {
  eventsManager.broadcast('db:change', {
    collection: change.collection,
    operation: change.op,
    documentId: change.documentKey._id
  });
});
```

## Related Documentation

- [WebSocketServer](./websocket.md) - WebSocket server
- [Events](./events-base.md) - Base event class
- [Logger](./logger.md) - Event logging
