/**
 * OpenAPI/Swagger Documentation Generator
 *
 * This utility helps generate OpenAPI 3.0 documentation for your API routes.
 *
 * Installation:
 * ```bash
 * npm install --save-dev swagger-jsdoc swagger-ui-dist
 * ```
 *
 * Usage:
 * ```typescript
 * import { OpenApiGenerator } from '@designofadecade/server';
 *
 * const generator = new OpenApiGenerator({
 *   title: 'My API',
 *   version: '1.0.0',
 *   description: 'My API description'
 * });
 *
 * // Add route documentation
 * generator.addRoute({
 *   path: '/api/users',
 *   method: 'GET',
 *   summary: 'Get all users',
 *   responses: {
 *     200: { description: 'Success', schema: { type: 'array' } }
 *   }
 * });
 *
 * // Generate OpenAPI spec
 * const spec = generator.generate();
 * ```
 */

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  contact?: {
    name?: string;
    email?: string;
    url?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema: {
    type: string;
    [key: string]: unknown;
  };
}

export interface OpenApiResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: unknown;
    };
  };
}

export interface OpenApiRouteConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content: {
      [mediaType: string]: {
        schema: unknown;
      };
    };
  };
  responses: {
    [statusCode: string]: OpenApiResponse;
  };
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiConfig {
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: Array<{
    name: string;
    description?: string;
  }>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

export class OpenApiGenerator {
  private config: OpenApiConfig;
  private routes: OpenApiRouteConfig[] = [];

  constructor(config: OpenApiConfig) {
    this.config = config;
  }

  /**
   * Add a route to the OpenAPI documentation
   */
  addRoute(route: OpenApiRouteConfig): void {
    this.routes.push(route);
  }

  /**
   * Add multiple routes at once
   */
  addRoutes(routes: OpenApiRouteConfig[]): void {
    this.routes.push(...routes);
  }

  /**
   * Generate the complete OpenAPI specification
   */
  generate(): object {
    const paths: Record<string, unknown> = {};

    // Group routes by path
    for (const route of this.routes) {
      if (!paths[route.path]) {
        paths[route.path] = {};
      }

      const pathItem = paths[route.path] as Record<string, unknown>;
      const method = route.method.toLowerCase();

      pathItem[method] = {
        summary: route.summary,
        description: route.description,
        operationId: route.operationId,
        tags: route.tags,
        parameters: route.parameters,
        requestBody: route.requestBody,
        responses: route.responses,
        security: route.security,
      };
    }

    return {
      openapi: '3.0.0',
      info: this.config.info,
      servers: this.config.servers || [],
      tags: this.config.tags || [],
      paths,
      components: this.config.components || {},
    };
  }

  /**
   * Generate OpenAPI spec as JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.generate(), null, 2);
  }

  /**
   * Generate OpenAPI spec as YAML string (basic implementation)
   */
  toYAML(): string {
    const spec = this.generate();
    // Basic YAML conversion - for production use a proper YAML library
    return this.objectToYaml(spec, 0);
  }

  private objectToYaml(obj: unknown, indent: number): string {
    const spaces = '  '.repeat(indent);
    let yaml = '';

    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        for (const item of obj) {
          yaml += `${spaces}- ${this.objectToYaml(item, indent + 1)}\n`;
        }
      } else {
        for (const [key, value] of Object.entries(obj)) {
          if (value === undefined) continue;

          if (typeof value === 'object' && value !== null) {
            yaml += `${spaces}${key}:\n`;
            yaml += this.objectToYaml(value, indent + 1);
          } else if (typeof value === 'string') {
            yaml += `${spaces}${key}: "${value}"\n`;
          } else {
            yaml += `${spaces}${key}: ${value}\n`;
          }
        }
      }
    } else {
      yaml = String(obj);
    }

    return yaml;
  }
}

/**
 * Helper function to create Swagger UI HTML page
 */
export function generateSwaggerUI(specUrl: string | object): string {
  const specConfig =
    typeof specUrl === 'string' ? `url: "${specUrl}"` : `spec: ${JSON.stringify(specUrl)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.10.0/swagger-ui.css">
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.10.0/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.10.0/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                ${specConfig},
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                layout: "StandaloneLayout"
            });
        };
    </script>
</body>
</html>`;
}
