import { describe, it, expect } from 'vitest';
import { OpenApiGenerator, generateSwaggerUI } from './OpenApiGenerator.js';

describe('OpenApiGenerator', () => {
  it('should create a basic OpenAPI spec', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
        description: 'A test API',
      },
    });

    const spec = generator.generate() as any;

    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('should add routes to the spec', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    generator.addRoute({
      path: '/api/users',
      method: 'GET',
      summary: 'Get all users',
      responses: {
        '200': {
          description: 'Success',
        },
      },
    });

    const spec = generator.generate() as any;

    expect(spec.paths['/api/users']).toBeDefined();
    expect(spec.paths['/api/users'].get).toBeDefined();
    expect(spec.paths['/api/users'].get.summary).toBe('Get all users');
  });

  it('should add multiple routes at once', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    generator.addRoutes([
      {
        path: '/api/users',
        method: 'GET',
        summary: 'Get all users',
        responses: { '200': { description: 'Success' } },
      },
      {
        path: '/api/users/:id',
        method: 'GET',
        summary: 'Get user by ID',
        responses: { '200': { description: 'Success' } },
      },
    ]);

    const spec = generator.generate() as any;

    expect(spec.paths['/api/users']).toBeDefined();
    expect(spec.paths['/api/users/:id']).toBeDefined();
  });

  it('should handle route with parameters', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    generator.addRoute({
      path: '/api/users/:id',
      method: 'GET',
      summary: 'Get user by ID',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'Success',
        },
      },
    });

    const spec = generator.generate() as any;

    expect(spec.paths['/api/users/:id'].get.parameters).toHaveLength(1);
    expect(spec.paths['/api/users/:id'].get.parameters[0].name).toBe('id');
  });

  it('should handle request body', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    generator.addRoute({
      path: '/api/users',
      method: 'POST',
      summary: 'Create user',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Created',
        },
      },
    });

    const spec = generator.generate() as any;

    expect(spec.paths['/api/users'].post.requestBody).toBeDefined();
    expect(spec.paths['/api/users'].post.requestBody.required).toBe(true);
  });

  it('should export to JSON', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    generator.addRoute({
      path: '/api/test',
      method: 'GET',
      summary: 'Test endpoint',
      responses: {
        '200': {
          description: 'Success',
        },
      },
    });

    const json = generator.toJSON();
    const parsed = JSON.parse(json);

    expect(parsed.openapi).toBe('3.0.0');
    expect(parsed.paths['/api/test']).toBeDefined();
  });

  it('should export to YAML', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    });

    const yaml = generator.toYAML();

    expect(yaml).toContain('openapi:');
    expect(yaml).toContain('info:');
    expect(yaml).toContain('title: "Test API"');
  });

  it('should include components', () => {
    const generator = new OpenApiGenerator({
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    });

    const spec = generator.generate() as any;

    expect(spec.components.schemas.User).toBeDefined();
  });
});

describe('generateSwaggerUI', () => {
  it('should generate HTML with spec URL', () => {
    const html = generateSwaggerUI('/api/docs/openapi.json');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('swagger-ui');
    expect(html).toContain('url: "/api/docs/openapi.json"');
  });

  it('should generate HTML with inline spec', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
    };

    const html = generateSwaggerUI(spec);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('spec:');
    expect(html).toContain('Test');
  });
});
