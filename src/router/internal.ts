/**
 * Package-internal hooks. This module is not in the package's `exports` map,
 * so applications cannot import it.
 */

/**
 * `nodeJSRequest` option key: when `true`, the body resolves as the raw bytes
 * (a `Buffer`, or `null` when empty) instead of being decoded and
 * JSON-parsed. `Local.EventFunctionProxy` uses it to hand the wrapped handler
 * the body exactly as API Gateway would.
 */
export const RAW_BODY: unique symbol = Symbol('Router.rawBody');
