import { describe, it, expect } from 'vitest';
import Context from './Context.js';

describe('Context', () => {
  describe('Constructor', () => {
    it('should throw error when instantiated directly', () => {
      expect(() => {
        // @ts-expect-error - Testing direct instantiation
        new Context();
      }).toThrow('Cannot construct Context instances directly. Context must be extended.');
    });

    it('should not throw when extended', () => {
      class AppContext extends Context {
        constructor(public name: string) {
          super();
        }
      }

      expect(() => {
        new AppContext('test');
      }).not.toThrow();
    });
  });

  describe('Extended class', () => {
    class TestContext extends Context {
      public database: string;
      public config: Record<string, unknown>;

      constructor(database: string, config: Record<string, unknown>) {
        super();
        this.database = database;
        this.config = config;
      }
    }

    it('should create instance of extended class', () => {
      const context = new TestContext('db-connection', { env: 'test' });
      expect(context).toBeInstanceOf(Context);
      expect(context).toBeInstanceOf(TestContext);
    });

    it('should access extended class properties', () => {
      const context = new TestContext('db-connection', { env: 'test' });
      expect(context.database).toBe('db-connection');
      expect(context.config).toEqual({ env: 'test' });
    });
  });

  describe('Protected methods', () => {
    class CustomContext extends Context {
      private isValid = true;
      private initialized = false;
      private disposed = false;

      constructor() {
        super();
      }

      public async init(): Promise<void> {
        await this.initialize();
        this.initialized = true;
      }

      public async cleanup(): Promise<void> {
        await this.dispose();
        this.disposed = true;
      }

      public checkValid(): boolean {
        return this.validate();
      }

      public get state() {
        return {
          initialized: this.initialized,
          disposed: this.disposed,
        };
      }

      protected validate(): boolean {
        return this.isValid;
      }

      protected async initialize(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      protected async dispose(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    it('should call validate method', () => {
      const context = new CustomContext();
      expect(context.checkValid()).toBe(true);
    });

    it('should call initialize method', async () => {
      const context = new CustomContext();
      await context.init();
      expect(context.state.initialized).toBe(true);
    });

    it('should call dispose method', async () => {
      const context = new CustomContext();
      await context.cleanup();
      expect(context.state.disposed).toBe(true);
    });
  });
});
