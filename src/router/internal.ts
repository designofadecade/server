import type { IncomingMessage, ServerResponse } from 'node:http';

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

/**
 * Connections that were answered 413 and are being closed. Node keeps parsing
 * what arrives on them, so a request pipelined behind the refused body would
 * otherwise still reach a handler — on a connection already told
 * `Connection: close`. Shared by the router and `Server`'s `checkContinue`
 * refusal, so either refusal stops the other from serving the next request.
 */
const refusedConnections = new WeakSet<object>();

/** Most of a refused upload read (and discarded) so the 413 can land. */
const MAX_DRAIN_BYTES = 4 * 1024 * 1024;
/** How long a refused upload's connection may linger before it is cut. */
const REFUSED_UPLOAD_LINGER_MS = 2000;

/**
 * Whether `socket` carries a refused upload: any further request on it must
 * not be served. Callers should `req.resume()` such a request and return.
 */
export function isRefusedConnection(socket: object | null | undefined): boolean {
  return socket !== null && socket !== undefined && refusedConnections.has(socket);
}

/** The JSON body of every `413 PAYLOAD_TOO_LARGE` answer. */
export function payloadTooLargeBody(): string {
  return JSON.stringify({
    success: false,
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
  });
}

/**
 * Answers 413 and closes the connection without letting a reset wipe the
 * answer. Logging is the caller's job, so each path keeps its own log code.
 *
 * Destroying the socket while unread upload bytes sit in the kernel's
 * receive buffer makes it send RST, and a client still uploading (Node's
 * `http.request`, `fetch`, curl) then reports ECONNRESET instead of the 413.
 * So the response goes out with `Connection: close`, the rest of the upload
 * is read and discarded — at most `MAX_DRAIN_BYTES`, then the connection is
 * cut — and the socket is destroyed after `REFUSED_UPLOAD_LINGER_MS` if the
 * client has not closed it by then (also the fallback when the response
 * never finishes because the client reads nothing). The socket is marked
 * refused first, so a request pipelined behind the body is never served.
 */
export function answerPayloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
  const socket = req.socket;
  if (socket) refusedConnections.add(socket);
  const cut = () => {
    if (socket && !socket.destroyed) socket.destroy();
  };
  const linger = setTimeout(cut, REFUSED_UPLOAD_LINGER_MS);
  linger.unref?.();
  socket?.once?.('close', () => clearTimeout(linger));

  // Lingering close. With `Connection: close`, Node ends the response with
  // `socket.destroySoon()`, which destroys the socket as soon as the FIN is
  // flushed — while the client may still be uploading, so the next bytes
  // to arrive draw a reset that can wipe the unread 413 from the client's
  // receive buffer. Half-close instead; the drain, the byte cap and the
  // timer below decide when the socket is actually destroyed.
  let closeWhenFlushed = cut;
  if (socket && typeof socket.destroySoon === 'function') {
    const destroySoon = socket.destroySoon;
    closeWhenFlushed = () => destroySoon.call(socket);
    socket.destroySoon = function lingeringClose(this: typeof socket) {
      if (this.writable) this.end();
    };
  }

  let drained = 0;
  req.on?.('error', () => {});
  req.on?.('data', (chunk: Buffer | string) => {
    drained += chunk.length;
    if (drained > MAX_DRAIN_BYTES) cut();
  });
  // The whole upload has arrived: nothing is left to draw a reset, so the
  // connection can go once the answer is out.
  req.on?.('end', () => {
    if (res.writableFinished) closeWhenFlushed();
    else res.once?.('finish', closeWhenFlushed);
  });
  req.resume?.();

  res.statusCode = 413;
  res.setHeader('Content-Type', 'application/json');
  // The connection cannot be reused for another request: say so.
  res.setHeader('Connection', 'close');
  res.end(payloadTooLargeBody());
}
