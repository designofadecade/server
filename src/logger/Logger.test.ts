import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, LogLevel, Logger } from './Logger.ts';

describe('Logger', () => {
    let originalLogLevel: string | undefined;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        originalLogLevel = process.env.LOG_LEVEL;
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        if (originalLogLevel === undefined) {
            delete process.env.LOG_LEVEL;
        } else {
            process.env.LOG_LEVEL = originalLogLevel;
        }
        consoleLogSpy.mockRestore();
    });

    describe('Constructor', () => {
        it('should default to INFO level when LOG_LEVEL is not set', () => {
            delete process.env.LOG_LEVEL;
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.INFO);
            expect(testLogger.getLevelString()).toBe('INFO');
        });

        it('should use LOG_LEVEL from environment - ERROR', () => {
            process.env.LOG_LEVEL = 'ERROR';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.ERROR);
            expect(testLogger.getLevelString()).toBe('ERROR');
        });

        it('should use LOG_LEVEL from environment - WARN', () => {
            process.env.LOG_LEVEL = 'WARN';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.WARN);
            expect(testLogger.getLevelString()).toBe('WARN');
        });

        it('should use LOG_LEVEL from environment - INFO', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.INFO);
        });

        it('should use LOG_LEVEL from environment - DEBUG', () => {
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.DEBUG);
            expect(testLogger.getLevelString()).toBe('DEBUG');
        });

        it('should handle lowercase LOG_LEVEL', () => {
            process.env.LOG_LEVEL = 'debug';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.DEBUG);
        });

        it('should default to INFO for invalid LOG_LEVEL', () => {
            process.env.LOG_LEVEL = 'INVALID';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.INFO);
        });
    });

    describe('error()', () => {
        it('should log error message with timestamp and level', () => {
            process.env.LOG_LEVEL = 'ERROR';
            const testLogger = new Logger();

            testLogger.error('Test error');

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

            expect(logOutput.level).toBe('ERROR');
            expect(logOutput.message).toBe('Test error');
            expect(logOutput.timestamp).toBeDefined();
            expect(new Date(logOutput.timestamp).getTime()).toBeGreaterThan(0);
        });

        it('should include context in error log', () => {
            process.env.LOG_LEVEL = 'ERROR';
            const testLogger = new Logger();

            testLogger.error('Database error', { database: 'users', retry: 3 });

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.database).toBe('users');
            expect(logOutput.retry).toBe(3);
        });

        it('should always log error regardless of level', () => {
            const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

            levels.forEach(level => {
                consoleLogSpy.mockClear();
                process.env.LOG_LEVEL = level;
                const testLogger = new Logger();

                testLogger.error('Test error');

                expect(consoleLogSpy).toHaveBeenCalled();
            });
        });
    });

    describe('warn()', () => {
        it('should log warning message', () => {
            process.env.LOG_LEVEL = 'WARN';
            const testLogger = new Logger();

            testLogger.warn('Test warning');

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.level).toBe('WARN');
            expect(logOutput.message).toBe('Test warning');
        });

        it('should include context in warning log', () => {
            process.env.LOG_LEVEL = 'WARN';
            const testLogger = new Logger();

            testLogger.warn('Rate limit approaching', { current: 95, limit: 100 });

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.current).toBe(95);
            expect(logOutput.limit).toBe(100);
        });

        it('should not log warn when level is ERROR', () => {
            process.env.LOG_LEVEL = 'ERROR';
            const testLogger = new Logger();

            testLogger.warn('Test warning');

            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('should log warn when level is INFO or DEBUG', () => {
            ['WARN', 'INFO', 'DEBUG'].forEach(level => {
                consoleLogSpy.mockClear();
                process.env.LOG_LEVEL = level;
                const testLogger = new Logger();

                testLogger.warn('Test warning');

                expect(consoleLogSpy).toHaveBeenCalled();
            });
        });
    });

    describe('info()', () => {
        it('should log info message', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Test info');

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.level).toBe('INFO');
            expect(logOutput.message).toBe('Test info');
        });

        it('should include context in info log', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Request completed', { requestId: 'req-123', duration: 245 });

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.requestId).toBe('req-123');
            expect(logOutput.duration).toBe(245);
        });

        it('should not log info when level is ERROR or WARN', () => {
            ['ERROR', 'WARN'].forEach(level => {
                consoleLogSpy.mockClear();
                process.env.LOG_LEVEL = level;
                const testLogger = new Logger();

                testLogger.info('Test info');

                expect(consoleLogSpy).not.toHaveBeenCalled();
            });
        });

        it('should log info when level is INFO or DEBUG', () => {
            ['INFO', 'DEBUG'].forEach(level => {
                consoleLogSpy.mockClear();
                process.env.LOG_LEVEL = level;
                const testLogger = new Logger();

                testLogger.info('Test info');

                expect(consoleLogSpy).toHaveBeenCalled();
            });
        });
    });

    describe('debug()', () => {
        it('should log debug message', () => {
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            testLogger.debug('Test debug');

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.level).toBe('DEBUG');
            expect(logOutput.message).toBe('Test debug');
        });

        it('should include context in debug log', () => {
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            testLogger.debug('Cache lookup', { key: 'user:123', hit: true });

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(logOutput.key).toBe('user:123');
            expect(logOutput.hit).toBe(true);
        });

        it('should only log debug when level is DEBUG', () => {
            ['ERROR', 'WARN', 'INFO'].forEach(level => {
                consoleLogSpy.mockClear();
                process.env.LOG_LEVEL = level;
                const testLogger = new Logger();

                testLogger.debug('Test debug');

                expect(consoleLogSpy).not.toHaveBeenCalled();
            });

            consoleLogSpy.mockClear();
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            testLogger.debug('Test debug');

            expect(consoleLogSpy).toHaveBeenCalled();
        });
    });

    describe('Log filtering', () => {
        it('should filter logs based on level hierarchy', () => {
            process.env.LOG_LEVEL = 'WARN';
            const testLogger = new Logger();

            testLogger.error('Error message');
            testLogger.warn('Warn message');
            testLogger.info('Info message');
            testLogger.debug('Debug message');

            // Should only log error and warn
            expect(consoleLogSpy).toHaveBeenCalledTimes(2);

            const outputs = consoleLogSpy.mock.calls.map(call => JSON.parse(call[0] as string));
            expect(outputs[0].level).toBe('ERROR');
            expect(outputs[1].level).toBe('WARN');
        });

        it('should log all messages at DEBUG level', () => {
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            testLogger.error('Error');
            testLogger.warn('Warn');
            testLogger.info('Info');
            testLogger.debug('Debug');

            expect(consoleLogSpy).toHaveBeenCalledTimes(4);
        });

        it('should only log errors at ERROR level', () => {
            process.env.LOG_LEVEL = 'ERROR';
            const testLogger = new Logger();

            testLogger.error('Error');
            testLogger.warn('Warn');
            testLogger.info('Info');
            testLogger.debug('Debug');

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(output.level).toBe('ERROR');
        });
    });

    describe('JSON serialization', () => {
        it('should produce valid JSON output', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Test', { key: 'value' });

            const output = consoleLogSpy.mock.calls[0][0] as string;
            expect(() => JSON.parse(output)).not.toThrow();
        });

        it('should handle complex context objects', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            const context = {
                nested: { deep: { value: 123 } },
                array: [1, 2, 3],
                bool: true,
                num: 42,
                str: 'test'
            };

            testLogger.info('Complex context', context);

            const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(output.nested.deep.value).toBe(123);
            expect(output.array).toEqual([1, 2, 3]);
            expect(output.bool).toBe(true);
        });

        it('should fallback to plain log if JSON serialization fails', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            // Create circular reference that will fail JSON.stringify
            const circular: Record<string, unknown> = { a: 1 };
            circular.self = circular;

            testLogger.info('Test', circular);

            // Should still have logged (fallback)
            expect(consoleLogSpy).toHaveBeenCalled();
        });

        it('should include timestamp in ISO format', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Test');

            const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(output.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    describe('Singleton logger export', () => {
        it('should export a logger instance', () => {
            expect(logger).toBeDefined();
            expect(logger.error).toBeDefined();
            expect(logger.warn).toBeDefined();
            expect(logger.info).toBeDefined();
            expect(logger.debug).toBeDefined();
        });

        it('should be usable immediately', () => {
            logger.info('Test message');
            expect(consoleLogSpy).toHaveBeenCalled();
        });
    });

    describe('getLevel() and getLevelString()', () => {
        it('should return numeric level', () => {
            process.env.LOG_LEVEL = 'WARN';
            const testLogger = new Logger();

            expect(testLogger.getLevel()).toBe(LogLevel.WARN);
            expect(testLogger.getLevel()).toBe(1);
        });

        it('should return string level', () => {
            process.env.LOG_LEVEL = 'DEBUG';
            const testLogger = new Logger();

            expect(testLogger.getLevelString()).toBe('DEBUG');
        });

        it('should match level values', () => {
            const levels: Array<[string, LogLevel]> = [
                ['ERROR', LogLevel.ERROR],
                ['WARN', LogLevel.WARN],
                ['INFO', LogLevel.INFO],
                ['DEBUG', LogLevel.DEBUG]
            ];

            levels.forEach(([levelString, levelNum]) => {
                process.env.LOG_LEVEL = levelString;
                const testLogger = new Logger();

                expect(testLogger.getLevel()).toBe(levelNum);
                expect(testLogger.getLevelString()).toBe(levelString);
            });
        });
    });

    describe('Context without message', () => {
        it('should handle logging with only message and no context', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Just a message');

            const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(output.message).toBe('Just a message');
            expect(output.level).toBe('INFO');
            expect(output.timestamp).toBeDefined();
        });

        it('should handle empty context object', () => {
            process.env.LOG_LEVEL = 'INFO';
            const testLogger = new Logger();

            testLogger.info('Message', {});

            const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
            expect(output.message).toBe('Message');
            // Should not have extra properties beyond standard ones
            const keys = Object.keys(output);
            expect(keys).toContain('timestamp');
            expect(keys).toContain('level');
            expect(keys).toContain('message');
        });
    });
});
