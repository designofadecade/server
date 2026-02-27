# OpenAPI/Swagger Documentation

This directory contains utilities for generating OpenAPI 3.0 documentation for your API.

## Quick Start

### 1. Install Dependencies (Optional)

For advanced features, you may want to install additional packages:

```bash
npm install --save-dev swagger-jsdoc swagger-ui-dist
```

### 2. Basic Usage

```typescript
import { OpenApiGenerator, generateSwaggerUI } from '@designofadecade/server';
import Router from '@designofadecade/server';

// Create OpenAPI generator
const apiDocs = new OpenApiGenerator({
    info: {
        title: 'My API',
        version: '1.0.0',
        description: 'API documentation for my application',
        contact: {
            name: 'API Support',
            email: 'support@example.com'
        }
    },
    servers: [
        { url: 'http://localhost:3000', description: 'Development' },
        { url: 'https://api.example.com', description: 'Production' }
    ],
    tags: [
        { name: 'users', description: 'User management' },
        { name: 'posts', description: 'Post management' }
    ]
});

// Document your routes
apiDocs.addRoute({
    path: '/api/users',
    method: 'GET',
    summary: 'Get all users',
    description: 'Retrieves a list of all users in the system',
    tags: ['users'],
    parameters: [
        {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: 'Page number'
        }
    ],
    responses: {
        '200': {
            description: 'Successful response',
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' }
                    }
                }
            }
        }
    }
});

apiDocs.addRoute({
    path: '/api/users/:id',
    method: 'GET',
    summary: 'Get user by ID',
    tags: ['users'],
    parameters: [
        {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'User ID'
        }
    ],
    responses: {
        '200': {
            description: 'Successful response',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/User' }
                }
            }
        },
        '404': {
            description: 'User not found'
        }
    }
});

// Add schemas
apiDocs.config.components = {
    schemas: {
        User: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string', format: 'email' }
            }
        }
    }
};
```

### 3. Serve Documentation

```typescript
// Add documentation endpoints to your router
const router = new Router();

// Serve OpenAPI spec as JSON
router.get('/api/docs/openapi.json', async () => {
    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: apiDocs.toJSON()
    };
});

// Serve Swagger UI
router.get('/api/docs', async () => {
    const html = generateSwaggerUI('/api/docs/openapi.json');
    return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: html
    };
});
```

### 4. Access Documentation

Open your browser and navigate to:
- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs/openapi.json`

## Advanced Features

### Authentication

```typescript
apiDocs.config.components = {
    securitySchemes: {
        bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
        }
    }
};

apiDocs.addRoute({
    path: '/api/protected',
    method: 'GET',
    summary: 'Protected endpoint',
    security: [{ bearerAuth: [] }],
    responses: {
        '200': { description: 'Success' },
        '401': { description: 'Unauthorized' }
    }
});
```

### Request Body

```typescript
apiDocs.addRoute({
    path: '/api/users',
    method: 'POST',
    summary: 'Create new user',
    tags: ['users'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                        name: { type: 'string' },
                        email: { type: 'string', format: 'email' }
                    }
                }
            }
        }
    },
    responses: {
        '201': {
            description: 'User created',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/User' }
                }
            }
        }
    }
});
```

## Best Practices

1. **Document all public endpoints** - Users need to know what's available
2. **Use meaningful descriptions** - Explain what each endpoint does
3. **Define schemas** - Reuse common data structures
4. **Include examples** - Show request/response examples
5. **Document error responses** - Help users handle errors properly
6. **Use tags** - Organize endpoints into logical groups
7. **Version your API** - Keep track of changes

## Export Options

```typescript
// JSON
const json = apiDocs.toJSON();

// YAML
const yaml = apiDocs.toYAML();

// JavaScript object
const spec = apiDocs.generate();
```

## Integration with CI/CD

You can generate documentation as part of your build process:

```typescript
// scripts/generate-docs.ts
import { OpenApiGenerator } from '@designofadecade/server';
import { writeFileSync } from 'fs';

const generator = new OpenApiGenerator({...});
// Add routes...

writeFileSync('docs/openapi.json', generator.toJSON());
writeFileSync('docs/openapi.yaml', generator.toYAML());
```

Add to package.json:
```json
{
  "scripts": {
    "docs:generate": "tsx scripts/generate-docs.ts"
  }
}
```
