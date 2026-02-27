import { bench, describe } from 'vitest';
import EventsManager from './EventsManager.js';
import Events from './Events.js';
describe('EventsManager Performance', () => {
    bench('broadcast - 100 subscribers', () => {
        const manager = new EventsManager();
        // Simulate 100 WebSocket clients
        const mockClients = new Set();
        for (let i = 0; i < 100; i++) {
            mockClients.add({
                send: () => { },
                readyState: 1,
            });
        }
        // @ts-expect-error - Accessing private field for benchmark
        if (manager['wsServer']) {
            // @ts-expect-error - Accessing private field
            manager['wsServer'].clients = mockClients;
        }
        manager.broadcast('test', { data: 'test' });
        manager.close();
    });
    bench('register event handlers - 100 handlers', () => {
        class TestEvents extends Events {
            constructor(manager) {
                super(manager);
                for (let i = 0; i < 100; i++) {
                    this.addListener(`event${i}`, async () => { });
                }
            }
        }
        const manager = new EventsManager({
            initEvents: [TestEvents],
        });
        manager.close();
    });
    bench('broadcast with large payload', () => {
        const manager = new EventsManager();
        const largePayload = { data: 'x'.repeat(10000) };
        const mockClients = new Set();
        for (let i = 0; i < 10; i++) {
            mockClients.add({
                send: () => { },
                readyState: 1,
            });
        }
        // @ts-expect-error - Accessing private field for benchmark
        if (manager['wsServer']) {
            // @ts-expect-error - Accessing private field
            manager['wsServer'].clients = mockClients;
        }
        manager.broadcast('test', largePayload);
        manager.close();
    });
    bench('multiple event types - 50 types', () => {
        class MultiEvents extends Events {
            constructor(manager) {
                super(manager);
                for (let i = 0; i < 50; i++) {
                    this.addListener(`event${i}`, async () => { });
                }
            }
        }
        const manager = new EventsManager({
            initEvents: [MultiEvents],
        });
        for (let i = 0; i < 50; i++) {
            manager.broadcast(`event${i}`, { data: i });
        }
        manager.close();
    });
    bench('event handler execution - 100 handlers', async () => {
        class CounterEvents extends Events {
            constructor(manager) {
                super(manager);
                for (let i = 0; i < 100; i++) {
                    this.addListener('increment', async () => {
                        // Handler logic for benchmark
                    });
                }
            }
        }
        const manager = new EventsManager({
            initEvents: [CounterEvents],
        });
        manager.broadcast('increment', {});
        manager.close();
    });
});
//# sourceMappingURL=Events.bench.js.map