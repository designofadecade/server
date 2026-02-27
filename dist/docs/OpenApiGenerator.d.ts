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
export declare class OpenApiGenerator {
  private config;
  private routes;
  constructor(config: OpenApiConfig);
  /**
   * Add a route to the OpenAPI documentation
   */
  addRoute(route: OpenApiRouteConfig): void;
  /**
   * Add multiple routes at once
   */
  addRoutes(routes: OpenApiRouteConfig[]): void;
  /**
   * Generate the complete OpenAPI specification
   */
  generate(): object;
  /**
   * Generate OpenAPI spec as JSON string
   */
  toJSON(): string;
  /**
   * Generate OpenAPI spec as YAML string (basic implementation)
   */
  toYAML(): string;
  private objectToYaml;
}
/**
 * Helper function to create Swagger UI HTML page
 */
export declare function generateSwaggerUI(specUrl: string | object): string;
//# sourceMappingURL=OpenApiGenerator.d.ts.map
