import { describe, it, expect } from 'vitest';
import * as pkg from './index.ts';

/**
 * Smoke test for the package entry point.
 *
 * Every consumer reaches the library through this barrel, so a broken or
 * renamed export here breaks them regardless of how well the module behind it
 * is tested. It was the only source file with no test of its own.
 */

const EXPECTED_EXPORTS = [
  'Server',
  'Router',
  'Routes',
  'StaticFileHandler',
  'Context',
  'WebSocketServer',
  'WebSocketMessageFormatter',
  'AppState',
  'Events',
  'EventsManager',
  'HtmlSanitizer',
  'HtmlRenderer',
  'Local',
  'ApiClient',
  'RouteError',
  'Slack',
  'OpenApiGenerator',
] as const;

describe('package entry point', () => {
  it.each(EXPECTED_EXPORTS)('should export %s as a constructable class', (name) => {
    expect(pkg[name]).toBeDefined();
    expect(typeof pkg[name]).toBe('function');
  });

  it('should export the logger instance', () => {
    expect(pkg.logger).toBeDefined();
    expect(typeof pkg.logger.info).toBe('function');
    expect(typeof pkg.logger.error).toBe('function');
  });

  it('should export generateSwaggerUI as a function', () => {
    expect(typeof pkg.generateSwaggerUI).toBe('function');
  });

  it('should expose the grouped Utils namespace', () => {
    expect(pkg.Utils).toEqual({
      HtmlSanitizer: pkg.HtmlSanitizer,
      HtmlRenderer: pkg.HtmlRenderer,
      Local: pkg.Local,
      ApiClient: pkg.ApiClient,
    });
  });

  it('should export RequestLogger middleware', () => {
    // Re-exported with `export *`, so a rename upstream would silently drop it.
    expect(Object.keys(pkg).some((key) => key.toLowerCase().includes('requestlogger'))).toBe(true);
  });

  it('should not accidentally export undefined bindings', () => {
    const undefinedExports = Object.entries(pkg)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);

    expect(undefinedExports).toEqual([]);
  });
});
