import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AppState from './AppState.ts';

describe('AppState', () => {
    let instance: AppState;

    beforeEach(() => {
        // Clear the singleton instance before each test by accessing private static property
        // @ts-expect-error - Accessing private static for testing purposes
        AppState.instance = undefined;
    });

    afterEach(() => {
        // Clean up singleton instance after each test
        // @ts-expect-error - Accessing private static for testing purposes
        AppState.instance = undefined;
    });

    describe('Constructor', () => {
        it('should create an instance with default values', () => {
            instance = AppState.getInstance();

            expect(instance.env).toBe('development');
            expect(instance.rootPath).toBe('/');
        });

        it('should create an instance with custom env', () => {
            instance = AppState.getInstance({ env: 'production' });

            expect(instance.env).toBe('production');
        });

        it('should create an instance with custom rootPath', () => {
            instance = AppState.getInstance({ rootPath: '/api/v1' });

            expect(instance.rootPath).toBe('/api/v1');
        });

        it('should create an instance with custom env and rootPath', () => {
            instance = AppState.getInstance({
                env: 'staging',
                rootPath: '/app'
            });

            expect(instance.env).toBe('staging');
            expect(instance.rootPath).toBe('/app');
        });

        it('should return the same singleton instance', () => {
            const instance1 = AppState.getInstance({ env: 'production' });
            const instance2 = AppState.getInstance({ env: 'development' });

            expect(instance1).toBe(instance2);
            expect(instance2.env).toBe('production'); // First instance config is preserved
        });

        it('should handle empty configuration object', () => {
            instance = AppState.getInstance({});

            expect(instance.env).toBe('development');
            expect(instance.rootPath).toBe('/');
        });
    });

    describe('get()', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should return undefined for non-existent key', () => {
            expect(instance.get('nonExistent')).toBeUndefined();
        });

        it('should return the value for an existing key', () => {
            instance.set('testKey', 'testValue');
            expect(instance.get('testKey')).toBe('testValue');
        });

        it('should return different values for different keys', () => {
            instance.set('key1', 'value1');
            instance.set('key2', 'value2');

            expect(instance.get('key1')).toBe('value1');
            expect(instance.get('key2')).toBe('value2');
        });
    });

    describe('set()', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should set a string value', () => {
            instance.set('stringKey', 'stringValue');
            expect(instance.get('stringKey')).toBe('stringValue');
        });

        it('should set a number value', () => {
            instance.set('numberKey', 42);
            expect(instance.get('numberKey')).toBe(42);
        });

        it('should set an object value', () => {
            const obj = { name: 'test', value: 123 };
            instance.set('objectKey', obj);
            expect(instance.get('objectKey')).toEqual(obj);
        });

        it('should set an array value', () => {
            const arr = [1, 2, 3];
            instance.set('arrayKey', arr);
            expect(instance.get('arrayKey')).toEqual(arr);
        });

        it('should set null value', () => {
            instance.set('nullKey', null);
            expect(instance.get('nullKey')).toBeNull();
        });

        it('should set undefined value', () => {
            instance.set('undefinedKey', undefined);
            expect(instance.get('undefinedKey')).toBeUndefined();
        });

        it('should overwrite existing value', () => {
            instance.set('key', 'value1');
            instance.set('key', 'value2');
            expect(instance.get('key')).toBe('value2');
        });

        it('should return this for method chaining', () => {
            const result = instance.set('key', 'value');
            expect(result).toBe(instance);
        });

        it('should allow method chaining', () => {
            instance
                .set('key1', 'value1')
                .set('key2', 'value2')
                .set('key3', 'value3');

            expect(instance.get('key1')).toBe('value1');
            expect(instance.get('key2')).toBe('value2');
            expect(instance.get('key3')).toBe('value3');
        });
    });

    describe('has()', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should return false for non-existent key', () => {
            expect(instance.has('nonExistent')).toBe(false);
        });

        it('should return true for existing key', () => {
            instance.set('existingKey', 'value');
            expect(instance.has('existingKey')).toBe(true);
        });

        it('should return true for key with null value', () => {
            instance.set('nullKey', null);
            expect(instance.has('nullKey')).toBe(true);
        });

        it('should return true for key with undefined value', () => {
            instance.set('undefinedKey', undefined);
            expect(instance.has('undefinedKey')).toBe(true);
        });

        it('should return false after key is removed', () => {
            instance.set('key', 'value');
            instance.remove('key');
            expect(instance.has('key')).toBe(false);
        });
    });

    describe('remove()', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should remove an existing key', () => {
            instance.set('key', 'value');
            instance.remove('key');

            expect(instance.has('key')).toBe(false);
            expect(instance.get('key')).toBeUndefined();
        });

        it('should not throw error when removing non-existent key', () => {
            expect(() => instance.remove('nonExistent')).not.toThrow();
        });

        it('should return this for method chaining', () => {
            instance.set('key', 'value');
            const result = instance.remove('key');
            expect(result).toBe(instance);
        });

        it('should allow method chaining', () => {
            instance
                .set('key1', 'value1')
                .set('key2', 'value2')
                .set('key3', 'value3')
                .remove('key2')
                .remove('key3');

            expect(instance.has('key1')).toBe(true);
            expect(instance.has('key2')).toBe(false);
            expect(instance.has('key3')).toBe(false);
        });
    });

    describe('clear()', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should clear all state', () => {
            instance.set('key1', 'value1');
            instance.set('key2', 'value2');
            instance.set('key3', 'value3');

            instance.clear();

            expect(instance.has('key1')).toBe(false);
            expect(instance.has('key2')).toBe(false);
            expect(instance.has('key3')).toBe(false);
        });

        it('should not affect env and rootPath', () => {
            // Create a fresh instance with custom config
            // @ts-expect-error - Accessing private static for testing purposes
            AppState.instance = undefined;
            instance = AppState.getInstance({ env: 'production', rootPath: '/api' });
            instance.set('key', 'value');

            instance.clear();

            expect(instance.env).toBe('production');
            expect(instance.rootPath).toBe('/api');
        });

        it('should return this for method chaining', () => {
            const result = instance.clear();
            expect(result).toBe(instance);
        });

        it('should allow setting values after clear', () => {
            instance.set('key1', 'value1');
            instance.clear();
            instance.set('key2', 'value2');

            expect(instance.has('key1')).toBe(false);
            expect(instance.has('key2')).toBe(true);
            expect(instance.get('key2')).toBe('value2');
        });

        it('should work on empty state', () => {
            expect(() => instance.clear()).not.toThrow();
        });
    });

    describe('Singleton Behavior', () => {
        it('should maintain state across different references', () => {
            const instance1 = AppState.getInstance();
            instance1.set('sharedKey', 'sharedValue');

            const instance2 = AppState.getInstance();
            expect(instance2.get('sharedKey')).toBe('sharedValue');
        });

        it('should clear state for all references', () => {
            const instance1 = AppState.getInstance();
            instance1.set('key', 'value');

            const instance2 = AppState.getInstance();
            instance2.clear();

            expect(instance1.has('key')).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            instance = AppState.getInstance();
        });

        it('should handle keys with special characters', () => {
            const specialKey = 'key-with.special:characters';
            instance.set(specialKey, 'value');
            expect(instance.get(specialKey)).toBe('value');
        });

        it('should handle empty string as key', () => {
            instance.set('', 'emptyKeyValue');
            expect(instance.get('')).toBe('emptyKeyValue');
        });

        it('should handle numeric strings as keys', () => {
            instance.set('123', 'numericKey');
            expect(instance.get('123')).toBe('numericKey');
        });

        it('should handle storing functions', () => {
            const fn = () => 'test';
            instance.set('functionKey', fn);
            expect(instance.get('functionKey')).toBe(fn);
            expect(instance.get('functionKey')()).toBe('test');
        });

        it('should handle boolean values', () => {
            instance.set('trueKey', true);
            instance.set('falseKey', false);

            expect(instance.get('trueKey')).toBe(true);
            expect(instance.get('falseKey')).toBe(false);
        });

        it('should distinguish between 0 and false', () => {
            instance.set('zero', 0);
            instance.set('false', false);

            expect(instance.get('zero')).toBe(0);
            expect(instance.get('false')).toBe(false);
            expect(instance.get('zero')).not.toBe(instance.get('false'));
        });
    });
});
