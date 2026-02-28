/**
 * Production hardening tests for Logger
 * Tests edge cases, security, and CloudWatch-specific scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from './Logger';

describe('Logger - Production Hardening', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = originalEnv;
  });

  describe('Circular Reference Handling', () => {
    it('should handle circular references without crashing', () => {
      const logger = new Logger();
      const circular: any = { name: 'test' };
      circular.self = circular;

      expect(() => {
        logger.info('Circular test', { data: circular });
      }).not.toThrow();

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.data.self).toBe('[CIRCULAR]');
    });

    it('should handle deeply nested circular references', () => {
      const logger = new Logger();
      const obj1: any = { name: 'obj1' };
      const obj2: any = { name: 'obj2', ref: obj1 };
      obj1.ref = obj2;

      expect(() => {
        logger.info('Deep circular test', { data: obj1 });
      }).not.toThrow();
    });
  });

  describe('BigInt Handling', () => {
    it('should serialize BigInt values without crashing', () => {
      const logger = new Logger();
      const bigIntValue = BigInt('9007199254740991');

      expect(() => {
        logger.info('BigInt test', { amount: bigIntValue });
      }).not.toThrow();

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.amount).toBe('9007199254740991n');
    });
  });

  describe('Symbol Handling', () => {
    it('should handle Symbol values without crashing', () => {
      const logger = new Logger();
      const sym = Symbol('test');

      expect(() => {
        logger.info('Symbol test', { id: sym });
      }).not.toThrow();

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.id).toBe('Symbol(test)');
    });
  });

  describe('Function Handling', () => {
    it('should handle function values without crashing', () => {
      const logger = new Logger();
      const fn = () => 'test';

      expect(() => {
        logger.info('Function test', { callback: fn });
      }).not.toThrow();

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.callback).toBe('[Function]');
    });
  });

  describe('Max Depth Protection', () => {
    it('should prevent infinite recursion with deeply nested objects', () => {
      const logger = new Logger();
      let deep: any = { value: 1 };
      for (let i = 0; i < 20; i++) {
        deep = { nested: deep };
      }

      expect(() => {
        logger.info('Deep nesting test', { data: deep });
      }).not.toThrow();

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      // Should have [MAX_DEPTH] somewhere in the structure
      expect(JSON.stringify(logOutput)).toContain('[MAX_DEPTH]');
    });
  });

  describe('CloudWatch Size Limits', () => {
    it('should truncate logs exceeding 256KB', () => {
      const logger = new Logger();
      // Create a large object
      const largeData = 'x'.repeat(300000);

      logger.info('Large log test', { data: largeData });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const logSize = JSON.stringify(logOutput).length;

      expect(logSize).toBeLessThan(256000);
      expect(logOutput._truncated).toBe(true);
    });

    it('should include original size in truncated logs', () => {
      const logger = new Logger();
      const largeData = 'x'.repeat(300000);

      logger.info('Size tracking test', { data: largeData });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput._originalSize).toBeGreaterThan(256000);
    });
  });

  describe('Sensitive Data Redaction - Extended', () => {
    it('should redact various password field variations', () => {
      const logger = new Logger();

      logger.info('Password variations', {
        password: 'secret123',
        passwd: 'secret456',
        pwd: 'secret789',
        user_password: 'secret000',
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('[REDACTED]');
      expect(logOutput.passwd).toBe('[REDACTED]');
      expect(logOutput.pwd).toBe('[REDACTED]');
      expect(logOutput.user_password).toBe('[REDACTED]');
    });

    it('should redact various token field variations', () => {
      const logger = new Logger();

      logger.info('Token variations', {
        token: 'abc123',
        accessToken: 'def456',
        refreshToken: 'ghi789',
        bearerToken: 'jkl000',
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.token).toBe('[REDACTED]');
      expect(logOutput.accessToken).toBe('[REDACTED]');
      expect(logOutput.refreshToken).toBe('[REDACTED]');
      expect(logOutput.bearerToken).toBe('[REDACTED]');
    });

    it('should redact API keys', () => {
      const logger = new Logger();

      logger.info('API key variations', {
        apiKey: 'key123',
        api_key: 'key456',
        apikey: 'key789',
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.apiKey).toBe('[REDACTED]');
      expect(logOutput.api_key).toBe('[REDACTED]');
      expect(logOutput.apikey).toBe('[REDACTED]');
    });

    it('should redact credit card information', () => {
      const logger = new Logger();

      logger.info('Credit card test', {
        creditCard: '4111111111111111',
        cardNumber: '5555555555554444',
        cvv: '123',
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.creditCard).toBe('[REDACTED]');
      expect(logOutput.cardNumber).toBe('[REDACTED]');
      expect(logOutput.cvv).toBe('[REDACTED]');
    });

    it('should redact nested sensitive data', () => {
      const logger = new Logger();

      logger.info('Nested sensitive data', {
        user: {
          name: 'John',
          password: 'secret123',
          profile: {
            apiKey: 'key456',
          },
        },
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.user.name).toBe('John');
      expect(logOutput.user.password).toBe('[REDACTED]');
      expect(logOutput.user.profile.apiKey).toBe('[REDACTED]');
    });

    it('should redact sensitive data in arrays', () => {
      const logger = new Logger();

      logger.info('Array with sensitive data', {
        users: [
          { username: 'user1', password: 'pass1' },
          { username: 'user2', password: 'pass2' },
        ],
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.users[0].username).toBe('user1');
      expect(logOutput.users[0].password).toBe('[REDACTED]');
      expect(logOutput.users[1].password).toBe('[REDACTED]');
    });
  });

  describe('Error Handling - Robust Fallbacks', () => {
    it('should handle non-serializable errors gracefully', () => {
      const logger = new Logger();
      const weirdObject: any = {};
      Object.defineProperty(weirdObject, 'prop', {
        get() {
          throw new Error('Cannot access');
        },
      });

      expect(() => {
        logger.info('Weird object test', { data: weirdObject });
      }).not.toThrow();
    });

    it('should provide fallback when serialization completely fails', () => {
      const logger = new Logger();
      // This should trigger the fallback mechanism
      const problematic = {
        get dangerous() {
          throw new Error('Getter throws');
        },
      };

      expect(() => {
        logger.error('Problematic object', { data: problematic });
      }).not.toThrow();

      // Should have logged something
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('AWS Lambda Context - Production Values', () => {
    it('should include all AWS Lambda environment variables when present', () => {
      process.env.AWS_REQUEST_ID = 'req-12345';
      process.env._X_AMZN_TRACE_ID = 'Root=1-67891234-abcdef';
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      process.env.AWS_LAMBDA_FUNCTION_VERSION = '$LATEST';
      process.env.ENVIRONMENT = 'production';

      const logger = new Logger();
      logger.info('AWS context test');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.requestId).toBe('req-12345');
      expect(logOutput.traceId).toBe('Root=1-67891234-abcdef');
      expect(logOutput.functionName).toBe('my-function');
      expect(logOutput.functionVersion).toBe('$LATEST');
      expect(logOutput.environment).toBe('production');
    });

    it('should track cold starts correctly', () => {
      const logger = new Logger();

      logger.info('First invocation');
      logger.info('Second invocation');

      const firstLog = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const secondLog = JSON.parse(consoleLogSpy.mock.calls[1][0]);

      expect(firstLog.coldStart).toBe(true);
      expect(secondLog.coldStart).toBeUndefined();
    });
  });

  describe('Performance Tracking', () => {
    it('should track operation duration correctly', () => {
      const logger = new Logger();

      logger.performance('testOperation', 1234, {
        source: 'TestService.run',
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toContain('testOperation');
      expect(logOutput.duration).toBe(1234);
      expect(logOutput.source).toBe('TestService.run');
    });

    it('should track duration with timer helper', async () => {
      const logger = new Logger();
      const timer = logger.startTimer();

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));

      timer.end('asyncOperation', { source: 'Test' });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.duration).toBeGreaterThan(0);
      expect(logOutput.message).toContain('asyncOperation');
    });
  });
});
