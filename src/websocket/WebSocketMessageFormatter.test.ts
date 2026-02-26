import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import WebSocketMessageFormatter from './WebSocketMessageFormatter.ts';

describe('WebSocketMessageFormatter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('parse', () => {
        it('should parse valid JSON message with id, type, and payload', () => {
            const message = JSON.stringify({
                id: 'test-id-123',
                type: 'user:update',
                payload: { userId: 1, name: 'John' }
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                id: 'test-id-123',
                type: 'user:update',
                payload: { userId: 1, name: 'John' }
            });
        });

        it('should parse valid message without id', () => {
            const message = JSON.stringify({
                type: 'ping',
                payload: {}
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                type: 'ping',
                payload: {}
            });
            expect(result.id).toBeUndefined();
        });

        it('should parse message with null payload', () => {
            const message = JSON.stringify({
                type: 'disconnect',
                payload: null
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                type: 'disconnect',
                payload: null
            });
        });

        it('should parse message with array payload', () => {
            const message = JSON.stringify({
                type: 'bulk:update',
                payload: [1, 2, 3, 4]
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                type: 'bulk:update',
                payload: [1, 2, 3, 4]
            });
        });

        it('should parse message with string payload', () => {
            const message = JSON.stringify({
                type: 'message',
                payload: 'Hello, World!'
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                type: 'message',
                payload: 'Hello, World!'
            });
        });

        it('should return null for invalid JSON', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const result = WebSocketMessageFormatter.parse('not valid json');

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should return null for empty string', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const result = WebSocketMessageFormatter.parse('');

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith('Received invalid message data:', '');

            consoleSpy.mockRestore();
        });

        it('should return null for null input', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const result = WebSocketMessageFormatter.parse(null);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should return null for undefined input', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const result = WebSocketMessageFormatter.parse(undefined);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should return null for non-string input', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const result = WebSocketMessageFormatter.parse(123);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should return null for message without type', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const message = JSON.stringify({
                id: 'test-id',
                payload: { data: 'test' }
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith("Parsed message lacks required 'type' or 'payload' fields.");

            consoleSpy.mockRestore();
        });

        it('should return null for message without payload', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const message = JSON.stringify({
                id: 'test-id',
                type: 'test'
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith("Parsed message lacks required 'type' or 'payload' fields.");

            consoleSpy.mockRestore();
        });

        it('should return null for message with non-string type', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const message = JSON.stringify({
                type: 123,
                payload: { data: 'test' }
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should parse message with nested object payload', () => {
            const message = JSON.stringify({
                type: 'complex',
                payload: {
                    user: {
                        id: 1,
                        profile: {
                            name: 'John',
                            settings: { theme: 'dark' }
                        }
                    }
                }
            });

            const result = WebSocketMessageFormatter.parse(message);

            expect(result).toEqual({
                type: 'complex',
                payload: {
                    user: {
                        id: 1,
                        profile: {
                            name: 'John',
                            settings: { theme: 'dark' }
                        }
                    }
                }
            });
        });
    });

    describe('format', () => {
        it('should format message with type and payload', () => {
            const result = WebSocketMessageFormatter.format('test:event', { data: 'test' });

            const parsed = JSON.parse(result);
            expect(parsed).toHaveProperty('id');
            expect(parsed.type).toBe('test:event');
            expect(parsed.payload).toEqual({ data: 'test' });
            expect(typeof parsed.id).toBe('string');
        });

        it('should generate unique IDs for each message', () => {
            const result1 = WebSocketMessageFormatter.format('test', { data: 1 });
            const result2 = WebSocketMessageFormatter.format('test', { data: 2 });

            const parsed1 = JSON.parse(result1);
            const parsed2 = JSON.parse(result2);

            expect(parsed1.id).not.toBe(parsed2.id);
        });

        it('should throw error if type is not a string', () => {
            expect(() => {
                WebSocketMessageFormatter.format(123, { data: 'test' });
            }).toThrow('Message type must be a string');
        });

        it('should throw error if type is null', () => {
            expect(() => {
                WebSocketMessageFormatter.format(null, { data: 'test' });
            }).toThrow('Message type must be a string');
        });

        it('should throw error if type is undefined', () => {
            expect(() => {
                WebSocketMessageFormatter.format(undefined, { data: 'test' });
            }).toThrow('Message type must be a string');
        });

        it('should format message with null payload', () => {
            const result = WebSocketMessageFormatter.format('test', null);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toBeNull();
        });

        it('should format message with array payload', () => {
            const result = WebSocketMessageFormatter.format('list', [1, 2, 3]);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toEqual([1, 2, 3]);
        });

        it('should format message with string payload', () => {
            const result = WebSocketMessageFormatter.format('text', 'Hello');

            const parsed = JSON.parse(result);
            expect(parsed.payload).toBe('Hello');
        });

        it('should format message with number payload', () => {
            const result = WebSocketMessageFormatter.format('count', 42);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toBe(42);
        });

        it('should format message with boolean payload', () => {
            const result = WebSocketMessageFormatter.format('flag', true);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toBe(true);
        });

        it('should format message with nested object payload', () => {
            const payload = {
                user: {
                    id: 1,
                    profile: {
                        name: 'John',
                        settings: { theme: 'dark' }
                    }
                }
            };

            const result = WebSocketMessageFormatter.format('user:update', payload);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toEqual(payload);
        });

        it('should handle serialization errors', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            // Create circular reference
            const circular = { a: 1 };
            circular.self = circular;

            const result = WebSocketMessageFormatter.format('circular', circular);

            const parsed = JSON.parse(result);
            expect(parsed.type).toBe('error');
            expect(parsed.payload.message).toContain('Circular reference');

            consoleSpy.mockRestore();
        });

        it('should return error message for serialization failures', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            // Mock JSON.stringify to throw
            const originalStringify = JSON.stringify;
            JSON.stringify = vi.fn().mockImplementation((obj) => {
                if (obj && obj.type !== 'error') {
                    throw new Error('Serialization failed');
                }
                return originalStringify(obj);
            });

            const result = WebSocketMessageFormatter.format('test', { data: 'test' });

            const parsed = originalStringify ? JSON.parse(result) : null;
            expect(parsed.type).toBe('error');
            expect(parsed.payload.message).toBe('Serialization failed');

            JSON.stringify = originalStringify;
            consoleSpy.mockRestore();
        });

        it('should generate valid UUID for id field', () => {
            const result = WebSocketMessageFormatter.format('test', {});
            const parsed = JSON.parse(result);

            // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            expect(parsed.id).toMatch(uuidRegex);
        });

        it('should accept empty string as type', () => {
            expect(() => {
                WebSocketMessageFormatter.format('', {});
            }).not.toThrow();
        });

        it('should format message with special characters in type', () => {
            const result = WebSocketMessageFormatter.format('user:update:profile', { id: 1 });

            const parsed = JSON.parse(result);
            expect(parsed.type).toBe('user:update:profile');
        });

        it('should handle undefined payload', () => {
            const result = WebSocketMessageFormatter.format('test', undefined);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toBeUndefined();
        });

        it('should handle very large payloads', () => {
            const largePayload = {
                data: 'x'.repeat(10000)
            };

            const result = WebSocketMessageFormatter.format('large', largePayload);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toEqual(largePayload);
        });

        it('should handle payloads with special characters', () => {
            const payload = {
                text: 'Hello "World" with \'quotes\' and \n newlines \t tabs'
            };

            const result = WebSocketMessageFormatter.format('special', payload);

            const parsed = JSON.parse(result);
            expect(parsed.payload).toEqual(payload);
        });
    });

    describe('Integration tests', () => {
        it('should format and parse message', () => {
            const originalPayload = { userId: 123, action: 'login' };
            const formatted = WebSocketMessageFormatter.format('auth:login', originalPayload);
            const parsed = WebSocketMessageFormatter.parse(formatted);

            expect(parsed.type).toBe('auth:login');
            expect(parsed.payload).toEqual(originalPayload);
            expect(parsed.id).toBeDefined();
        });

        it('should handle round-trip with complex payload', () => {
            const originalPayload = {
                users: [
                    { id: 1, name: 'John', roles: ['admin', 'user'] },
                    { id: 2, name: 'Jane', roles: ['user'] }
                ],
                timestamp: '2024-01-01T00:00:00Z',
                metadata: {
                    version: '1.0',
                    source: 'api'
                }
            };

            const formatted = WebSocketMessageFormatter.format('data:sync', originalPayload);
            const parsed = WebSocketMessageFormatter.parse(formatted);

            expect(parsed.payload).toEqual(originalPayload);
        });
    });
});
