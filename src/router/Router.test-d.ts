import { describe, it, assertType, expectTypeOf } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import Router from './Router.js';
import Routes from './Routes.js';
import Local from '../local/Local.js';
import Context from '../context/Context.js';
import type { LambdaHttpEvent, LambdaHttpResponse, ContextLike } from '../index.js';
import type { LambdaEvent, LambdaResponse } from '../local/Local.js';

/**
 * The canonical way to write a Lambda is to type the handler with the official
 * `@types/aws-lambda` event. `router.lambdaEvent(event)` has to accept that type
 * directly — needing an `as any` at the boundary is the defect.
 */
describe('Router.lambdaEvent input type', () => {
  it('accepts an APIGatewayProxyEventV2 without a cast', () => {
    const router = new Router({});
    const handler = async (event: APIGatewayProxyEventV2) => router.lambdaEvent(event);
    expectTypeOf(handler).toBeFunction();
  });

  it('models queryStringParameters the way API Gateway actually sends them', () => {
    // API Gateway omits absent values, so a lookup must be `string | undefined`
    // rather than the `Record<string, string>` this used to claim.
    expectTypeOf<NonNullable<LambdaHttpEvent['queryStringParameters']>>().toEqualTypeOf<
      Record<string, string | undefined>
    >();
  });

  it('exports the event and response types so consumers can name them', () => {
    expectTypeOf<LambdaHttpEvent>().toHaveProperty('requestContext');
    expectTypeOf<LambdaHttpResponse>().toHaveProperty('statusCode');
  });
});

/**
 * `Local.LambdaProxyRouter` wraps a real Lambda handler, so the event it
 * synthesises must satisfy the handler's declared parameter type. Constructor
 * and function parameters are checked contravariantly, so `LambdaEvent` has to
 * be assignable *to* `APIGatewayProxyEventV2`, not merely resemble it.
 */
describe('Local.LambdaProxyRouter handler type', () => {
  it('accepts a handler typed with the official AWS event', () => {
    const wrapped = Local.LambdaProxyRouter(async (_event: APIGatewayProxyEventV2) => ({
      statusCode: 200,
      body: '{}',
    }));
    expectTypeOf(wrapped).toHaveProperty('request');
  });

  it('accepts a Router lambdaEvent handler', () => {
    const router = new Router({});
    const wrapped = Local.LambdaProxyRouter((event) => router.lambdaEvent(event));
    expectTypeOf(wrapped).toHaveProperty('request');
  });

  it('synthesises an event assignable to the AWS type', () => {
    assertType<APIGatewayProxyEventV2>({} as LambdaEvent);
  });

  it('carries cookies in API Gateway v2 wire format', () => {
    expectTypeOf<NonNullable<LambdaEvent['cookies']>>().toEqualTypeOf<string[]>();
  });

  it('exports its event and response types', () => {
    expectTypeOf<LambdaResponse>().toHaveProperty('statusCode');
  });
});

/**
 * The router never calls `validate`/`initialize`/`dispose` — it only stores the
 * context and hands it to route classes. Requiring the *class* therefore buys
 * nothing and makes every consumer test that stubs a context resort to a cast.
 */
describe('context typing', () => {
  interface AppContext extends ContextLike {
    db: { query(sql: string): Promise<unknown> };
    config: { assetsBucket: string };
  }

  it('lets a plain object stand in for a context in tests', () => {
    const fake: AppContext = {
      db: { query: async () => [] },
      config: { assetsBucket: 'x' },
    };
    assertType<ContextLike>(fake);
  });

  it('still accepts the abstract class as a context', () => {
    class RealContext extends Context {
      constructor(public db: string) {
        super();
      }
    }
    assertType<ContextLike>(new RealContext('x'));
  });

  it('accepts a structural context in RouterOptions', () => {
    const fake: AppContext = {
      db: { query: async () => [] },
      config: { assetsBucket: 'x' },
    };
    expectTypeOf(new Router({ context: fake })).toEqualTypeOf<Router>();
  });

  /**
   * The documented pattern — a route class whose constructor narrows `context`
   * to the application's own type — has to compile. Constructor parameters are
   * contravariant, so a `context?: Context` parameter in the `initRoutes` type
   * rejected every narrowed subclass.
   */
  it('accepts a route class that narrows the context type', () => {
    interface AppCtx extends ContextLike {
      db: string;
    }
    class UserRoutes extends Routes {
      constructor(router: Router, context?: AppCtx) {
        super(router, context);
      }
    }
    class PlainRoutes extends Routes {
      constructor(router: Router) {
        super(router);
      }
    }
    expectTypeOf(new Router({ initRoutes: [UserRoutes, PlainRoutes] })).toEqualTypeOf<Router>();
  });

  it('accepts a narrowed route class in the static register list', () => {
    interface AppCtx extends ContextLike {
      db: string;
    }
    class ChildRoutes extends Routes {
      constructor(router: Router, context?: AppCtx) {
        super(router, context);
      }
    }
    class ParentRoutes extends Routes {
      static override register = [ChildRoutes];
    }
    expectTypeOf(ParentRoutes.register).toBeArray();
  });
});
