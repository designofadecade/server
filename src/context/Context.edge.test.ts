import { describe, it, expect } from 'vitest';
import Context from './Context.ts';

/**
 * Context is abstract and its optional lifecycle hooks are protected, so the
 * existing tests never invoked them. They are part of the documented extension
 * contract, so a subclass relying on the defaults should be covered.
 */

class TestContext extends Context {
  constructor(public readonly name = 'test') {
    super();
  }

  // Surface the protected hooks so their default implementations can be asserted.
  callValidate(): boolean {
    return this.validate();
  }

  callInitialize(): Promise<void> {
    return this.initialize();
  }

  callDispose(): Promise<void> {
    return this.dispose();
  }
}

class OverridingContext extends Context {
  public disposed = false;
  public initialized = false;

  constructor() {
    super();
  }

  protected validate(): boolean {
    return false;
  }

  protected async initialize(): Promise<void> {
    this.initialized = true;
  }

  protected async dispose(): Promise<void> {
    this.disposed = true;
  }

  run(): { valid: boolean } {
    return { valid: this.validate() };
  }

  async lifecycle(): Promise<void> {
    await this.initialize();
    await this.dispose();
  }
}

describe('Context lifecycle hooks', () => {
  it('should refuse direct construction of the abstract class', () => {
    // `new.target` guard: subclasses are fine, Context itself is not.
    expect(() => new (Context as unknown as new () => Context)()).toThrow(
      'Context must be extended'
    );
  });

  it('should allow construction through a subclass', () => {
    expect(new TestContext()).toBeInstanceOf(Context);
  });

  it('should validate as true by default', () => {
    expect(new TestContext().callValidate()).toBe(true);
  });

  it('should resolve the default initialize hook', async () => {
    await expect(new TestContext().callInitialize()).resolves.toBeUndefined();
  });

  it('should resolve the default dispose hook', async () => {
    await expect(new TestContext().callDispose()).resolves.toBeUndefined();
  });

  it('should let a subclass override the hooks', async () => {
    const context = new OverridingContext();

    expect(context.run()).toEqual({ valid: false });

    await context.lifecycle();
    expect(context.initialized).toBe(true);
    expect(context.disposed).toBe(true);
  });
});
