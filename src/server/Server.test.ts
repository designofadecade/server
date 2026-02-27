import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Server from './Server.ts';
import Http from 'http';

vi.mock('http');

describe('Server', () => {
  let server: Server;
  let mockHttpServer: any;
  let mockRequestHandler: any;

  beforeEach(() => {
    mockHttpServer = {
      listen: vi.fn((port, host, callback) => {
        callback();
      }),
      on: vi.fn(),
      close: vi.fn((callback) => {
        if (callback) callback();
      }),
    };

    Http.createServer.mockReturnValue(mockHttpServer);

    mockRequestHandler = vi.fn((req, res) => {
      res.end('OK');
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (server) {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      server.close().catch(() => {});
    }
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create a Server instance with default options', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);
      expect(Http.createServer).toHaveBeenCalledWith(mockRequestHandler);
      expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));

      consoleSpy.mockRestore();
    });

    it('should create a Server instance with custom port', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 8080 }, mockRequestHandler);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(8080, '0.0.0.0', expect.any(Function));

      consoleSpy.mockRestore();
    });

    it('should create a Server instance with custom host', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ host: 'localhost' }, mockRequestHandler);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));

      consoleSpy.mockRestore();
    });

    it('should create a Server instance with custom port and host', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 8080, host: 'localhost' }, mockRequestHandler);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(8080, 'localhost', expect.any(Function));

      consoleSpy.mockRestore();
    });

    it('should throw error for invalid port (too low)', () => {
      expect(() => {
        server = new Server({ port: 0 }, mockRequestHandler);
      }).toThrow('Port 0 is invalid. Must be between 1 and 65535.');
    });

    it('should throw error for invalid port (too high)', () => {
      expect(() => {
        server = new Server({ port: 65536 }, mockRequestHandler);
      }).toThrow('Port 65536 is invalid. Must be between 1 and 65535.');
    });

    it('should throw error for invalid port (negative)', () => {
      expect(() => {
        server = new Server({ port: -1 }, mockRequestHandler);
      }).toThrow('Port -1 is invalid. Must be between 1 and 65535.');
    });

    it('should throw error for invalid port (NaN)', () => {
      expect(() => {
        server = new Server({ port: 'invalid' }, mockRequestHandler);
      }).toThrow('Must be between 1 and 65535.');
    });

    it('should throw error if request handler is not a function', () => {
      expect(() => {
        server = new Server({}, 'not a function');
      }).toThrow('Request handler must be a function');
    });

    it('should throw error if request handler is null', () => {
      expect(() => {
        server = new Server({}, null);
      }).toThrow('Request handler must be a function');
    });

    it('should throw error if request handler is undefined', () => {
      expect(() => {
        server = new Server({});
      }).toThrow('Request handler must be a function');
    });

    it('should log success message when server starts', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 3000, host: '0.0.0.0' }, mockRequestHandler);

      // Check that console.log was called with JSON containing the message
      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logCall);
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('HTTP Server listening');
      expect(parsed.host).toBe('0.0.0.0');
      expect(parsed.port).toBe(3000);

      consoleSpy.mockRestore();
    });

    it('should register error handler for EADDRINUSE', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      expect(mockHttpServer.on).toHaveBeenCalledWith('error', expect.any(Function));

      consoleSpy.mockRestore();
    });

    it('should handle EADDRINUSE error', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      // Get the error handler
      const errorHandler = mockHttpServer.on.mock.calls.find((call) => call[0] === 'error')[1];

      // Simulate EADDRINUSE error
      errorHandler({ code: 'EADDRINUSE' });

      // Should log error with JSON format
      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'ERROR' && parsed.message === 'Port is already in use';
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should handle generic errors', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      const errorHandler = mockHttpServer.on.mock.calls.find((call) => call[0] === 'error')[1];

      errorHandler(new Error('Generic error'));

      // Should log error with JSON format
      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'ERROR' && parsed.message === 'HTTP Server error';
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('server getter', () => {
    it('should return the HTTP server instance', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      expect(server.server).toBe(mockHttpServer);

      consoleSpy.mockRestore();
    });
  });

  describe('close', () => {
    it('should close the server successfully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      await server.close();

      expect(mockHttpServer.close).toHaveBeenCalled();
      // Check that console.log was called with JSON containing the message
      const logCall = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'INFO' && parsed.message === 'HTTP Server closed';
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should handle close errors', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockHttpServer.close = vi.fn((callback) => {
        callback(new Error('Close error'));
      });

      Http.createServer.mockReturnValue(mockHttpServer);

      server = new Server({}, mockRequestHandler);

      await expect(server.close()).rejects.toThrow('Close error');

      // Check that console.log was called with JSON containing the error
      const logCall = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'ERROR' && parsed.message === 'Error closing HTTP Server';
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should resolve immediately if server is null', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      // Manually set server to null (simulate server not started)
      const originalServer = server.server;
      Object.defineProperty(server, 'server', {
        get: () => null,
        configurable: true,
      });

      await server.close();

      // Restore
      Object.defineProperty(server, 'server', {
        get: () => originalServer,
        configurable: true,
      });

      consoleSpy.mockRestore();
    });

    it('should be callable multiple times', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockHttpServer.close = vi.fn((callback) => {
        if (callback) callback();
      });

      server = new Server({}, mockRequestHandler);

      await server.close();
      await server.close();

      expect(mockHttpServer.close).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });

  describe('Request Handling', () => {
    it('should handle incoming requests with the provided handler', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const customHandler = vi.fn((req, res) => {
        res.statusCode = 200;
        res.end('Custom response');
      });

      server = new Server({}, customHandler);

      expect(Http.createServer).toHaveBeenCalledWith(customHandler);

      consoleSpy.mockRestore();
    });

    it('should pass requests to the handler', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({}, mockRequestHandler);

      // Get the handler that was passed to createServer
      const handler = Http.createServer.mock.calls[0][0];

      expect(handler).toBe(mockRequestHandler);

      consoleSpy.mockRestore();
    });
  });

  describe('Port Range Validation', () => {
    it('should accept minimum valid port (1)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 1 }, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);

      consoleSpy.mockRestore();
    });

    it('should accept maximum valid port (65535)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 65535 }, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);

      consoleSpy.mockRestore();
    });

    it('should accept standard HTTP port (80)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 80 }, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);

      consoleSpy.mockRestore();
    });

    it('should accept standard HTTPS port (443)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 443 }, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);

      consoleSpy.mockRestore();
    });

    it('should accept common development port (8080)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      server = new Server({ port: 8080 }, mockRequestHandler);

      expect(server).toBeInstanceOf(Server);

      consoleSpy.mockRestore();
    });
  });
});
