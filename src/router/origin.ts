/**
 * Cross-origin helpers shared by `Router.nodeJSRequest` and
 * `Local.EventFunctionProxy`. Internal: not exported from the package entry.
 *
 * Both transports decide "is this request same-origin" and "could a browser
 * have sent this body cross-site without a preflight" — keeping one copy means
 * a fix to either rule reaches both.
 */
import type { IncomingHttpHeaders } from 'http';

/**
 * MIME essences a browser may send cross-site without a CORS preflight (the
 * Fetch standard's CORS-safelisted request-header rule for `Content-Type`):
 * what an HTML form or a `no-cors` fetch can send.
 */
export const CORS_SAFELISTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

/**
 * Whether a request `Content-Type` is one a cross-site page can send without
 * a preflight, compared on its MIME essence (`text/plain;application/json` is
 * `text/plain`). Only a single string header can come from a browser (Node and
 * API Gateway both deliver `content-type` as one string), so an array or a
 * missing header is reported as not safelisted.
 *
 * SECURITY: the router never JSON-parses a body declared with one of these
 * essences. Its JSON check is a substring match, so `text/plain;application/json`
 * used to be parsed, handing a route a parsed object from a forged,
 * cookie-carrying cross-site request.
 */
export function isCorsSafelistedContentType(contentType: string | string[] | undefined): boolean {
  if (typeof contentType !== 'string') return false;
  const essence = contentType.split(';', 1)[0].trim().toLowerCase();
  return CORS_SAFELISTED_CONTENT_TYPES.has(essence);
}

/**
 * Browsers send `Origin` on same-origin POSTs too, so an allowlist that lacks
 * the site's own origin must not refuse its own pages. A request is
 * same-origin when the browser says so (`Sec-Fetch-Site`, which page script
 * cannot set) or when the Origin's host:port equals the Host header. A
 * cross-site page cannot make the two match: its visitor's browser sends the
 * target's Host and the page's own Origin.
 *
 * Fails closed: when the browser sent `Sec-Fetch-Site` with any other value
 * (`same-site`, `cross-site`, `none`), its verdict stands even if the Host
 * happens to match; an Origin that does not parse (including `null`) never
 * matches, and neither does a request without a Host.
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders, origin: string): boolean {
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite !== undefined) return fetchSite === 'same-origin';
  const host = headers.host;
  if (typeof host !== 'string' || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
