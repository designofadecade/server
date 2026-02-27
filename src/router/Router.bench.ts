import { bench, describe } from 'vitest';
import Router from './Router.js';
import Routes from './Routes.js';
import Context from '../context/Context.js';

class TestRoutes extends Routes {
  constructor(router: Router, context?: Context) {
    super(router, context);
    this.addRoute('/api/users', 'GET', async () => ({ status: 200, body: 'OK' }));
  }
}

class ParamRoutes extends Routes {
  constructor(router: Router, context?: Context) {
    super(router, context);
    this.addRoute('/api/users/:id', 'GET', async () => ({ status: 200, body: 'OK' }));
  }
}

class ComplexRoutes extends Routes {
  constructor(router: Router, context?: Context) {
    super(router, context);
    this.addRoute('/api/:resource/:id/comments/:commentId', 'GET', async () => ({
      status: 200,
      body: 'OK',
    }));
  }
}

describe('Router Performance', () => {
  bench('lambda event - simple route', async () => {
    const router = new Router({ initRoutes: [TestRoutes] });

    await router.lambdaEvent({
      requestContext: {
        http: {
          method: 'GET',
          path: '/api/users',
        },
      },
      headers: {},
    });
  });

  bench('lambda event - route with params', async () => {
    const router = new Router({ initRoutes: [ParamRoutes] });

    await router.lambdaEvent({
      requestContext: {
        http: {
          method: 'GET',
          path: '/api/users/123',
        },
      },
      headers: {},
    });
  });

  bench('lambda event - complex pattern', async () => {
    const router = new Router({ initRoutes: [ComplexRoutes] });

    await router.lambdaEvent({
      requestContext: {
        http: {
          method: 'GET',
          path: '/api/posts/456/comments/789',
        },
      },
      headers: {},
    });
  });

  bench('route registration - 100 routes', () => {
    class ManyRoutes extends Routes {
      constructor(router: Router, context?: Context) {
        super(router, context);
        for (let i = 0; i < 100; i++) {
          this.addRoute(`/api/route${i}`, 'GET', async () => ({ status: 200, body: 'OK' }));
        }
      }
    }

    new Router({ initRoutes: [ManyRoutes] });
  });

  bench('lambda event with middleware', async () => {
    const router = new Router({
      initRoutes: [TestRoutes],
      middleware: [async () => {}, async () => {}, async () => {}, async () => {}, async () => {}],
    });

    await router.lambdaEvent({
      requestContext: {
        http: {
          method: 'GET',
          path: '/api/users',
        },
      },
      headers: {},
    });
  });
});
