# Context & State Management

Application context and state management for shared resources and configuration.

## Context

Abstract base class for type-safe application context throughout your application.

### Overview

The `Context` class provides a pattern for passing shared resources (database connections, services, configuration) to routes and handlers in a type-safe way.

### Installation

```typescript
import Context from '@designofadecade/server/context';
```

### Quick Start

```typescript
import Context from '@designofadecade/server/context';
import Router from '@designofadecade/server/router';
import Routes from '@designofadecade/server/router/Routes';

// Define your application context
class AppContext extends Context {
  constructor(
    public readonly database: Database,
    public readonly redis: Redis,
    public readonly config: Config
  ) {
    super();
  }
}

// Create context instance
const context = new AppContext(db, redis, config);

// Pass to router
const router = new Router({
  context,
  initRoutes: [UserRoutes, PostRoutes]
});

// Access in routes
class UserRoutes extends Routes {
  async getUser(req: RouterRequest): Promise<RouterResponse> {
    const ctx = this.context as AppContext;
    const user = await ctx.database.users.findById(req.params.id);
    
    return {
      status: 200,
      body: user
    };
  }
}
```

### API Reference

#### Constructor

```typescript
protected constructor()
```

The constructor is protected - Context cannot be instantiated directly and must be extended.

**Throws:**
- `TypeError` - If attempting to instantiate Context directly

#### Methods

##### validate()

```typescript
protected validate(): boolean
```

Optional method to validate context state. Override in derived classes.

**Returns:** `boolean` - True if context is valid

**Example:**
```typescript
class AppContext extends Context {
  protected validate(): boolean {
    return this.database.isConnected() && this.config.isValid();
  }
}
```

##### initialize()

```typescript
protected async initialize(): Promise<void>
```

Optional async initialization method. Override to set up resources.

**Example:**
```typescript
class AppContext extends Context {
  protected async initialize(): Promise<void> {
    await this.database.connect();
    await this.cache.warmup();
  }
}
```

##### dispose()

```typescript
protected async dispose(): Promise<void>
```

Optional cleanup method. Override to release resources.

**Example:**
```typescript
class AppContext extends Context {
  protected async dispose(): Promise<void> {
    await this.database.disconnect();
    await this.cache.close();
  }
}
```

### Examples

#### Complete Application Context

```typescript
import Context from '@designofadecade/server/context';

interface Config {
  apiUrl: string;
  dbConnectionString: string;
  cacheEnabled: boolean;
}

interface Services {
  emailService: EmailService;
  paymentService: PaymentService;
  notificationService: NotificationService;
}

class AppContext extends Context {
  constructor(
    public readonly database: Database,
    public readonly cache: Redis,
    public readonly config: Config,
    public readonly services: Services,
    public readonly logger: Logger
  ) {
    super();
  }
  
  protected validate(): boolean {
    return (
      this.database !== null &&
      this.config.apiUrl !== '' &&
      this.services !== null
    );
  }
  
  protected async initialize(): Promise<void> {
    // Connect to database
    await this.database.connect();
    
    // Initialize cache
    if (this.config.cacheEnabled) {
      await this.cache.connect();
    }
    
    // Initialize services
    await this.services.emailService.init();
    
    this.logger.info('Context initialized');
  }
  
  protected async dispose(): Promise<void> {
    // Cleanup in reverse order
    await this.services.emailService.shutdown();
    await this.cache.disconnect();
    await this.database.disconnect();
    
    this.logger.info('Context disposed');
  }
}

// Usage
const context = new AppContext(db, redis, config, services, logger);
await context['initialize'](); // Call protected method
```

---

## AppState

Singleton state management for global application state.

### Overview

`AppState` provides a thread-safe singleton for storing and retrieving application-wide state, environment configuration, and dynamic values.

### Installation

```typescript
import AppState from '@designofadecade/server/state';
```

### Quick Start

```typescript
import AppState from '@designofadecade/server/state';

// Get singleton instance
const state = AppState.getInstance({
  env: 'production',
  rootPath: '/app'
});

// Store values
state.set('apiKey', process.env.API_KEY);
state.set('startTime', Date.now());
state.set('version', '1.0.0');

// Retrieve values
const apiKey = state.get('apiKey');
const startTime = state.get('startTime');

// Check existence
if (state.has('apiKey')) {
  console.log('API key configured');
}

// Remove values
state.remove('tempData');

// Clear all dynamic state
state.clear();
```

### API Reference

#### getInstance()

```typescript
static getInstance(config?: {
  env?: string;
  rootPath?: string;
}): AppState
```

Gets or creates the singleton instance.

**Parameters:**
- `config` (object, optional)
  - `env` (string) - Environment mode. Default: `'development'`
  - `rootPath` (string) - Application root path. Default: `'/'`

**Returns:** `AppState` - The singleton instance

**Example:**
```typescript
// First call creates instance
const state = AppState.getInstance({
  env: 'production',
  rootPath: '/api'
});

// Subsequent calls return same instance
const sameState = AppState.getInstance();
```

#### Properties

##### env

```typescript
get env(): string
```

Get the current environment.

**Returns:** `string` - Environment mode ('development', 'production', etc.)

**Example:**
```typescript
const state = AppState.getInstance({ env: 'production' });
console.log(state.env); // 'production'

if (state.env === 'production') {
  // Production-specific logic
}
```

##### rootPath

```typescript
get rootPath(): string
```

Get the application root path.

**Returns:** `string` - Root path

**Example:**
```typescript
const state = AppState.getInstance({ rootPath: '/api/v1' });
console.log(state.rootPath); // '/api/v1'
```

#### Methods

##### get()

```typescript
get(key: string): any
```

Get a value from state.

**Parameters:**
- `key` (string) - The key to retrieve

**Returns:** `any` - The stored value or `undefined`

**Example:**
```typescript
const value = state.get('myKey');
if (value) {
  console.log('Found:', value);
}
```

##### set()

```typescript
set(key: string, value: any): AppState
```

Set a value in state.

**Parameters:**
- `key` (string) - The key to set
- `value` (any) - The value to store

**Returns:** `AppState` - Returns this for method chaining

**Example:**
```typescript
state
  .set('apiUrl', 'https://api.example.com')
  .set('timeout', 30000)
  .set('retries', 3);
```

##### has()

```typescript
has(key: string): boolean
```

Check if a key exists in state.

**Parameters:**
- `key` (string) - The key to check

**Returns:** `boolean` - True if key exists

**Example:**
```typescript
if (state.has('apiKey')) {
  const key = state.get('apiKey');
} else {
  console.error('API key not configured');
}
```

##### remove()

```typescript
remove(key: string): AppState
```

Remove a key from state.

**Parameters:**
- `key` (string) - The key to remove

**Returns:** `AppState` - Returns this for method chaining

**Example:**
```typescript
state.remove('tempData');
state.remove('cache').remove('session');
```

##### clear()

```typescript
clear(): AppState
```

Clear all dynamic state. Does not clear env and rootPath.

**Returns:** `AppState` - Returns this for method chaining

**Example:**
```typescript
// Clear all state on tests cleanup
afterEach(() => {
  AppState.getInstance().clear();
});
```

### Examples

#### Configuration Management

```typescript
import AppState from '@designofadecade/server/state';

// Initialize on app startup
const state = AppState.getInstance({
  env: process.env.NODE_ENV || 'development',
  rootPath: process.env.BASE_PATH || '/'
});

// Load configuration
state
  .set('database.url', process.env.DATABASE_URL)
  .set('database.pool', 10)
  .set('redis.url', process.env.REDIS_URL)
  .set('jwt.secret', process.env.JWT_SECRET)
  .set('jwt.expiresIn', '7d');

// Access anywhere in app
function getDatabaseConfig() {
  const state = AppState.getInstance();
  return {
    url: state.get('database.url'),
    pool: state.get('database.pool')
  };
}
```

#### Feature Flags

```typescript
// Set feature flags
const state = AppState.getInstance();

state
  .set('features.newUI', true)
  .set('features.betaFeatures', false)
  .set('features.analytics', true);

// Check features
function isFeatureEnabled(feature: string): boolean {
  return AppState.getInstance().get(`features.${feature}`) === true;
}

if (isFeatureEnabled('newUI')) {
  // Use new UI
}
```

#### Application Metrics

```typescript
const state = AppState.getInstance();

// Track application metrics
state
  .set('metrics.startTime', Date.now())
  .set('metrics.requestCount', 0)
  .set('metrics.errorCount', 0);

// Increment counters
function trackRequest() {
  const state = AppState.getInstance();
  const count = state.get('metrics.requestCount') || 0;
  state.set('metrics.requestCount', count + 1);
}

function trackError() {
  const state = AppState.getInstance();
  const count = state.get('metrics.errorCount') || 0;
  state.set('metrics.errorCount', count + 1);
}

// Get metrics
function getMetrics() {
  const state = AppState.getInstance();
  const uptime = Date.now() - state.get('metrics.startTime');
  
  return {
    uptime,
    requests: state.get('metrics.requestCount'),
    errors: state.get('metrics.errorCount')
  };
}
```

#### Cache Management

```typescript
const state = AppState.getInstance();

// Store cached data
function cacheData(key: string, data: any, ttl: number) {
  state.set(`cache.${key}`, {
    data,
    expiresAt: Date.now() + ttl
  });
}

// Retrieve cached data
function getCachedData(key: string): any {
  const cached = state.get(`cache.${key}`);
  
  if (!cached) return null;
  
  if (Date.now() > cached.expiresAt) {
    state.remove(`cache.${key}`);
    return null;
  }
  
  return cached.data;
}

// Usage
cacheData('users', userData, 5 * 60 * 1000); // 5 minutes
const users = getCachedData('users');
```

#### Testing Setup

```typescript
import AppState from '@designofadecade/server/state';

describe('My Tests', () => {
  beforeEach(() => {
    // Initialize clean state
    const state = AppState.getInstance();
    state.clear();
    
    // Set test configuration
    state
      .set('env', 'test')
      .set('database.url', 'mongodb://localhost:27017/test')
      .set('features.test', true);
  });
  
  afterEach(() => {
    // Clean up
    AppState.getInstance().clear();
  });
  
  it('should use test configuration', () => {
    const state = AppState.getInstance();
    expect(state.env).toBe('test');
    expect(state.get('features.test')).toBe(true);
  });
});
```

## Best Practices

### Context

1. **Immutable Resources:** Make context properties readonly
   ```typescript
   class AppContext extends Context {
     constructor(
       public readonly db: Database,  // readonly
       public readonly config: Config // readonly
     ) {
       super();
     }
   }
   ```

2. **Type Safety:** Always cast context in routes
   ```typescript
   const ctx = this.context as AppContext;
   const data = await ctx.database.query();
   ```

3. **Lifecycle Management:** Use initialize/dispose for setup/cleanup
   ```typescript
   protected async initialize() {
     await this.database.connect();
   }
   
   protected async dispose() {
     await this.database.disconnect();
   }
   ```

4. **Validation:** Implement validate() to catch configuration errors early
   ```typescript
   protected validate(): boolean {
     return this.config.apiUrl !== '' && this.database !== null;
   }
   ```

### AppState

1. **Namespace Keys:** Use dot notation for organization
   ```typescript
   state.set('database.url', url);
   state.set('database.pool', 10);
   state.set('features.newFeature', true);
   ```

2. **Singleton Pattern:** Always use getInstance()
   ```typescript
   // Good
   const state = AppState.getInstance();
   
   // Bad - trying to use new (won't work)
   const state = new AppState();
   ```

3. **Configuration Loading:** Load all config at startup
   ```typescript
   function loadConfig() {
     const state = AppState.getInstance({
       env: process.env.NODE_ENV
     });
     
     // Load all configuration
     state.set('config', loadConfigFile());
   }
   ```

4. **Testing:** Clear state between tests
   ```typescript
   afterEach(() => {
     AppState.getInstance().clear();
   });
   ```

## Related Documentation

- [Router](./router.md) - Context integration with routing
- [Server](./server.md) - Server setup
- [Logger](./logger.md) - Logging configuration
