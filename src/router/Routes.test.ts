import { describe, it, expect, beforeEach, vi } from 'vitest';
import Routes from './Routes.ts';

describe('Routes', () => {
    let mockRouter;
    let routes;

    beforeEach(() => {
        mockRouter = {};
        vi.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a Routes instance', () => {
            routes = new Routes(mockRouter);
            expect(routes).toBeInstanceOf(Routes);
        });

        it('should initialize with empty routerRoutes', () => {
            routes = new Routes(mockRouter);
            expect(routes.routerRoutes).toEqual([]);
        });

        it('should register nested route classes', () => {
            class ChildRoute extends Routes {
                constructor(router) {
                    super(router);
                    this.addRoute('/child', 'GET', () => { });
                }
            }

            class ParentRoute extends Routes {
                static register = [ChildRoute];
            }

            const parentRoutes = new ParentRoute(mockRouter);
            expect(parentRoutes.routerRoutes.length).toBeGreaterThan(0);
        });
    });

    describe('Static Properties', () => {
        it('should have basePath as empty string by default', () => {
            expect(Routes.basePath).toBe('');
        });

        it('should have empty register array by default', () => {
            expect(Routes.register).toEqual([]);
        });

        it('should allow custom basePath in subclass', () => {
            class CustomRoutes extends Routes {
                static basePath = '/api/v1';
            }

            expect(CustomRoutes.basePath).toBe('/api/v1');
        });
    });

    describe('addRoute()', () => {
        beforeEach(() => {
            routes = new Routes(mockRouter);
        });

        it('should add a GET route', () => {
            const handler = vi.fn();
            routes.addRoute('/test', 'GET', handler);

            const routerRoutes = routes.routerRoutes;
            expect(routerRoutes).toHaveLength(1);
            expect(routerRoutes[0].path).toBe('/test');
            expect(routerRoutes[0].methods).toEqual(['GET']);
            expect(routerRoutes[0].handler).toBe(handler);
        });

        it('should add a POST route', () => {
            const handler = vi.fn();
            routes.addRoute('/create', 'POST', handler);

            const routerRoutes = routes.routerRoutes;
            expect(routerRoutes[0].methods).toEqual(['POST']);
        });

        it('should add routes with multiple HTTP methods', () => {
            const handler = vi.fn();
            routes.addRoute('/resource', ['GET', 'POST'], handler);

            const routerRoutes = routes.routerRoutes;
            expect(routerRoutes[0].methods).toEqual(['GET', 'POST']);
        });

        it('should normalize path with basePath', () => {
            class ApiRoutes extends Routes {
                static basePath = '/api';
            }

            const apiRoutes = new ApiRoutes(mockRouter);
            apiRoutes.addRoute('/users', 'GET', vi.fn());

            expect(apiRoutes.routerRoutes[0].path).toBe('/api/users');
        });

        it('should normalize multiple consecutive slashes', () => {
            class ApiRoutes extends Routes {
                static basePath = '/api/';
            }

            const apiRoutes = new ApiRoutes(mockRouter);
            apiRoutes.addRoute('/users', 'GET', vi.fn());

            expect(apiRoutes.routerRoutes[0].path).toBe('/api/users');
        });

        it('should create URLPattern for the route', () => {
            const handler = vi.fn();
            routes.addRoute('/test/:id', 'GET', handler);

            const routerRoutes = routes.routerRoutes;
            expect(routerRoutes[0].pattern).toBeInstanceOf(URLPattern);
        });

        it('should throw error if path is not a string', () => {
            expect(() => {
                routes.addRoute(123, 'GET', vi.fn());
            }).toThrow('Path must be a string');
        });

        it('should throw error if handler is not a function', () => {
            expect(() => {
                routes.addRoute('/test', 'GET', 'not a function');
            }).toThrow('Handler must be a function');
        });

        it('should throw error for invalid HTTP method', () => {
            expect(() => {
                routes.addRoute('/test', 'INVALID', vi.fn());
            }).toThrow('Invalid HTTP methods: INVALID');
        });

        it('should throw error for multiple invalid HTTP methods', () => {
            expect(() => {
                routes.addRoute('/test', ['GET', 'INVALID', 'BAD'], vi.fn());
            }).toThrow('Invalid HTTP methods: INVALID, BAD');
        });

        it('should accept all valid HTTP methods', () => {
            const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

            validMethods.forEach(method => {
                const testRoutes = new Routes(mockRouter);
                expect(() => {
                    testRoutes.addRoute('/test', method, vi.fn());
                }).not.toThrow();
            });
        });

        it('should handle root path', () => {
            routes.addRoute('/', 'GET', vi.fn());
            expect(routes.routerRoutes[0].path).toBe('/');
        });

        it('should handle empty basePath correctly', () => {
            routes.addRoute('/test', 'GET', vi.fn());
            expect(routes.routerRoutes[0].path).toBe('/test');
        });

        it('should allow adding multiple routes', () => {
            routes.addRoute('/route1', 'GET', vi.fn());
            routes.addRoute('/route2', 'POST', vi.fn());
            routes.addRoute('/route3', 'PUT', vi.fn());

            expect(routes.routerRoutes).toHaveLength(3);
        });
    });

    describe('routerRoutes getter', () => {
        beforeEach(() => {
            routes = new Routes(mockRouter);
        });

        it('should return empty array initially', () => {
            expect(routes.routerRoutes).toEqual([]);
        });

        it('should return array of added routes', () => {
            routes.addRoute('/route1', 'GET', vi.fn());
            routes.addRoute('/route2', 'POST', vi.fn());

            const routerRoutes = routes.routerRoutes;
            expect(routerRoutes).toHaveLength(2);
        });

        it('should return route objects with correct structure', () => {
            const handler = vi.fn();
            routes.addRoute('/test', 'GET', handler);

            const route = routes.routerRoutes[0];
            expect(route).toHaveProperty('path');
            expect(route).toHaveProperty('methods');
            expect(route).toHaveProperty('pattern');
            expect(route).toHaveProperty('handler');
        });
    });

    describe('Nested Routes', () => {
        it('should register routes from nested route classes', () => {
            class UserRoutes extends Routes {
                constructor(router) {
                    super(router);
                    this.addRoute('/list', 'GET', vi.fn());
                    this.addRoute('/create', 'POST', vi.fn());
                }
            }

            class ApiRoutes extends Routes {
                static register = [UserRoutes];
            }

            const apiRoutes = new ApiRoutes(mockRouter);
            expect(apiRoutes.routerRoutes.length).toBe(2);
        });

        it('should register routes from multiple nested route classes', () => {
            class UserRoutes extends Routes {
                constructor(router) {
                    super(router);
                    this.addRoute('/users', 'GET', vi.fn());
                }
            }

            class PostRoutes extends Routes {
                constructor(router) {
                    super(router);
                    this.addRoute('/posts', 'GET', vi.fn());
                }
            }

            class ApiRoutes extends Routes {
                static register = [UserRoutes, PostRoutes];
            }

            const apiRoutes = new ApiRoutes(mockRouter);
            expect(apiRoutes.routerRoutes.length).toBe(2);
        });

        it('should combine nested routes with parent routes', () => {
            class ChildRoutes extends Routes {
                constructor(router) {
                    super(router);
                    this.addRoute('/child', 'GET', vi.fn());
                }
            }

            class ParentRoutes extends Routes {
                static register = [ChildRoutes];

                constructor(router) {
                    super(router);
                    this.addRoute('/parent', 'GET', vi.fn());
                }
            }

            const parentRoutes = new ParentRoutes(mockRouter);
            expect(parentRoutes.routerRoutes.length).toBe(2);
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            routes = new Routes(mockRouter);
        });

        it('should handle path with route parameters', () => {
            routes.addRoute('/users/:id', 'GET', vi.fn());
            expect(routes.routerRoutes[0].path).toBe('/users/:id');
        });

        it('should handle path with multiple parameters', () => {
            routes.addRoute('/users/:userId/posts/:postId', 'GET', vi.fn());
            expect(routes.routerRoutes[0].path).toBe('/users/:userId/posts/:postId');
        });

        it('should handle basePath with trailing slash', () => {
            class TrailingSlashRoutes extends Routes {
                static basePath = '/api/';
            }

            const trailingRoutes = new TrailingSlashRoutes(mockRouter);
            trailingRoutes.addRoute('/test', 'GET', vi.fn());

            expect(trailingRoutes.routerRoutes[0].path).toBe('/api/test');
        });

        it('should handle path with leading double slash', () => {
            routes.addRoute('//test', 'GET', vi.fn());
            expect(routes.routerRoutes[0].path).toBe('/test');
        });

        it('should normalize complex path combinations', () => {
            class ComplexRoutes extends Routes {
                static basePath = '/api//v1/';
            }

            const complexRoutes = new ComplexRoutes(mockRouter);
            complexRoutes.addRoute('//users/', 'GET', vi.fn());

            expect(complexRoutes.routerRoutes[0].path).toBe('/api/v1/users/');
        });
    });
});
