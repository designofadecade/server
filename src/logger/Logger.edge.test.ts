import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from './Logger.ts';

/**
 * Covers the paths the logger only takes when something has already gone wrong:
 * exotic value types, deeply nested or circular context, and payloads past the
 * CloudWatch 256KB limit. These are precisely the cases you depend on during an
 * incident, so a logger that throws here would blind you exactly when it matters.
 */

const captureLog = (fn: () => void): Record<string, unknown>[] => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  fn();
  const entries = spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call[0] as string);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
  spy.mockRestore();
  return entries;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Logger edge cases', () => {
  describe('exotic value types', () => {
    it('should serialize a BigInt without throwing', () => {
      // JSON.stringify throws on BigInt by default.
      const entries = captureLog(() => new Logger().info('bigint', { amount: 42n }));

      expect(entries[0].amount).toBe('42n');
    });

    it('should serialize a Symbol', () => {
      const entries = captureLog(() => new Logger().info('symbol', { key: Symbol('secret-ish') }));

      expect(String(entries[0].key)).toContain('Symbol');
    });

    it('should replace a function rather than dropping the entry', () => {
      const entries = captureLog(() => new Logger().info('function', { cb: () => 'x' }));

      expect(entries[0].cb).toBe('[Function]');
    });

    it('should pass primitives through unchanged', () => {
      const entries = captureLog(() =>
        new Logger().info('primitives', { n: 1, s: 'two', b: true, nil: null })
      );

      expect(entries[0]).toMatchObject({ n: 1, s: 'two', b: true, nil: null });
    });
  });

  describe('hostile shapes', () => {
    it('should not hang on a circular reference', () => {
      const circular: Record<string, unknown> = { name: 'loop' };
      circular.self = circular;

      const entries = captureLog(() => new Logger().info('circular', { circular }));

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('circular');
    });

    it('should stop recursing past the depth limit', () => {
      // Build a chain deeper than the 10-level guard.
      let deep: Record<string, unknown> = { bottom: true };
      for (let i = 0; i < 20; i += 1) deep = { [`level${i}`]: deep };

      const entries = captureLog(() => new Logger().info('deep', { deep }));

      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).toContain('MAX_DEPTH');
    });
  });

  describe('oversized payloads', () => {
    it('should truncate a log past the CloudWatch size limit', () => {
      const entries = captureLog(() => new Logger().info('big', { blob: 'x'.repeat(300_000) }));

      expect(entries).toHaveLength(1);
      expect(entries[0]._truncated).toBe(true);
      expect(JSON.stringify(entries[0]).length).toBeLessThan(300_000);
    });

    it('should fall back to a minimal entry when truncation is not enough', () => {
      // A huge message survives the first truncation pass, forcing the
      // last-resort branch.
      const entries = captureLog(() =>
        new Logger().error('y'.repeat(400_000), { blob: 'x'.repeat(400_000) })
      );

      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0]).length).toBeLessThan(400_000);
    });

    it('should strip the error stack when shrinking a large entry', () => {
      const error = new Error('boom');
      error.stack = 'z'.repeat(300_000);

      const entries = captureLog(() => new Logger().error('with stack', { error }));

      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toContain('z'.repeat(1000));
    });
  });

  describe('performance helpers', () => {
    it('should log a duration through performance()', () => {
      const entries = captureLog(() =>
        new Logger().performance('db:query', 125, { source: 'Test' })
      );

      expect(entries[0]).toMatchObject({ duration: 125, source: 'Test' });
      expect(entries[0].message).toContain('db:query');
    });

    it('should measure elapsed time with startTimer()', () => {
      const logger = new Logger();
      const entries = captureLog(() => {
        const timer = logger.startTimer();
        timer.end('slow:op', { source: 'Test' });
      });

      expect(entries[0].message).toContain('slow:op');
      expect(typeof entries[0].duration).toBe('number');
      expect(entries[0].duration as number).toBeGreaterThanOrEqual(0);
    });
  });
});
