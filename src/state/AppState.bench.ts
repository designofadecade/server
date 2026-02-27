import { bench, describe } from 'vitest';
import AppState from './AppState.js';

describe('AppState Performance', () => {
  bench('get operation - 1000 times', () => {
    const state = AppState.getInstance();
    state.set('counter', 0);
    for (let i = 0; i < 1000; i++) {
      state.get('counter');
    }
  });

  bench('set operation - 1000 times', () => {
    const state = AppState.getInstance();
    for (let i = 0; i < 1000; i++) {
      state.set('counter', i);
    }
  });

  bench('has operation - 1000 times', () => {
    const state = AppState.getInstance();
    state.set('value', 42);

    for (let i = 0; i < 1000; i++) {
      state.has('value');
    }
  });

  bench('set/get 1000 keys', () => {
    const state = AppState.getInstance();

    for (let i = 0; i < 1000; i++) {
      state.set(`key${i}`, i);
    }

    for (let i = 0; i < 1000; i++) {
      state.get(`key${i}`);
    }
  });

  bench('update nested state - 100 levels', () => {
    const state = AppState.getInstance();
    const nested: Record<string, unknown> = {};
    let current: Record<string, unknown> = nested;

    for (let i = 0; i < 100; i++) {
      current[`level${i}`] = { value: i };
      current = current[`level${i}`] as Record<string, unknown>;
    }

    state.set('nested', nested);
  });

  bench('clear state - 1000 keys', () => {
    const state = AppState.getInstance();

    for (let i = 0; i < 1000; i++) {
      state.set(`key${i}`, i);
    }

    state.clear();
  });
});
