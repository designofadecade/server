import { describe, it, expect, beforeEach, vi } from 'vitest';
import Events from './Events.ts';

describe('Events', () => {
    let mockManager: any;
    let events: Events;

    beforeEach(() => {
        mockManager = {
            someProperty: 'test'
        };
        vi.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create an Events instance', () => {
            events = new Events(mockManager);
            expect(events).toBeInstanceOf(Events);
        });

        it('should store the manager reference', () => {
            events = new Events(mockManager);
            expect(events.manager).toBe(mockManager);
        });

        it('should initialize with empty managerEvents', () => {
            events = new Events(mockManager);
            expect(events.managerEvents).toEqual([]);
        });

        it('should register nested event classes', () => {
            class ChildEvents extends Events {
                constructor(manager) {
                    super(manager);
                    this.addListener('test:event', () => { });
                }
            }

            class ParentEvents extends Events {
                static register = [ChildEvents];
            }

            const parentEvents = new ParentEvents(mockManager);
            expect(parentEvents.managerEvents.length).toBeGreaterThan(0);
        });

        it('should register multiple nested event classes', () => {
            class ChildEvents1 extends Events {
                constructor(manager) {
                    super(manager);
                    this.addListener('event1', () => { });
                }
            }

            class ChildEvents2 extends Events {
                constructor(manager) {
                    super(manager);
                    this.addListener('event2', () => { });
                }
            }

            class ParentEvents extends Events {
                static register = [ChildEvents1, ChildEvents2];
            }

            const parentEvents = new ParentEvents(mockManager);
            expect(parentEvents.managerEvents.length).toBe(2);
        });
    });

    describe('Static Properties', () => {
        it('should have empty register array by default', () => {
            expect(Events.register).toEqual([]);
        });

        it('should allow custom register in subclass', () => {
            class CustomEvents extends Events {
                static register = [Events];
            }

            expect(CustomEvents.register).toEqual([Events]);
        });
    });

    describe('manager getter', () => {
        it('should return the manager instance', () => {
            events = new Events(mockManager);
            expect(events.manager).toBe(mockManager);
        });
    });

    describe('managerEvents getter', () => {
        it('should return empty array initially', () => {
            events = new Events(mockManager);
            expect(events.managerEvents).toEqual([]);
        });

        it('should return registered events', () => {
            events = new Events(mockManager);
            const handler = () => { };
            events.addListener('test:event', handler);

            expect(events.managerEvents).toHaveLength(1);
            expect(events.managerEvents[0]).toEqual({
                type: 'test:event',
                handler
            });
        });
    });

    describe('addListener', () => {
        beforeEach(() => {
            events = new Events(mockManager);
        });

        it('should add a valid event listener', () => {
            const handler = vi.fn();
            events.addListener('test:event', handler);

            expect(events.managerEvents).toHaveLength(1);
            expect(events.managerEvents[0]).toEqual({
                type: 'test:event',
                handler
            });
        });

        it('should add multiple event listeners', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            events.addListener('event1', handler1);
            events.addListener('event2', handler2);

            expect(events.managerEvents).toHaveLength(2);
            expect(events.managerEvents[0].type).toBe('event1');
            expect(events.managerEvents[1].type).toBe('event2');
        });

        it('should throw error if type is not a string', () => {
            expect(() => {
                events.addListener(123, () => { });
            }).toThrow('Event type must be a non-empty string');
        });

        it('should throw error if type is empty string', () => {
            expect(() => {
                events.addListener('', () => { });
            }).toThrow('Event type must be a non-empty string');
        });

        it('should throw error if type is whitespace only', () => {
            expect(() => {
                events.addListener('   ', () => { });
            }).toThrow('Event type must be a non-empty string');
        });

        it('should throw error if handler is not a function', () => {
            expect(() => {
                events.addListener('test:event', 'not a function');
            }).toThrow('Handler must be a function');
        });

        it('should throw error if handler is null', () => {
            expect(() => {
                events.addListener('test:event', null);
            }).toThrow('Handler must be a function');
        });

        it('should throw error if handler is undefined', () => {
            expect(() => {
                events.addListener('test:event', undefined);
            }).toThrow('Handler must be a function');
        });

        it('should accept arrow functions', () => {
            const handler = () => { };
            events.addListener('test:event', handler);

            expect(events.managerEvents[0].handler).toBe(handler);
        });

        it('should accept async functions', () => {
            const handler = async () => { };
            events.addListener('test:event', handler);

            expect(events.managerEvents[0].handler).toBe(handler);
        });
    });
});
