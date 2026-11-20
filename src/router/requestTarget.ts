/**
 * Request-target checks shared by `Router.nodeJSRequest` and
 * `Router.eventFunction`.
 *
 * SECURITY: the router must dispatch on the same path a proxy, CDN or WAF in
 * front of it judged. Resolving the target as a URL (`new URL(req.url, base)`)
 * does not: `//x/admin` reads as an authority and becomes `/admin`, `/\x/admin`
 * likewise, and dot segments (`/pub/../admin`, `/pub/%2e%2e/admin`) are
 * removed. A rule in front that guards `/admin` never saw `/admin`. So the
 * path is taken verbatim, and any target such a resolution would have changed
 * is refused rather than silently rewritten.
 */

/** Why a request target was refused. Fixed strings, safe to log. */
export type RequestTargetRefusal =
  | 'missing'
  | 'not-origin-form'
  | 'leading-double-slash'
  | 'backslash'
  | 'dot-segment'
  | 'control-character'
  | 'encoded-nul'
  | 'fragment';

/** The path and query of an accepted origin-form request target. */
export interface ParsedRequestTarget {
  path: string;
  query: Record<string, string>;
}

/**
 * C0 controls and DEL. Space is not among them: an Event Function path can
 * carry a decoded space, and the Node path encodes one as `%20` (as URL
 * parsing always did).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Checks a request path (no query). `null` when it is acceptable, otherwise
 * the reason it is refused:
 *
 * - it must start with exactly one `/` (`//host/...` and `/\host/...` are
 *   read as an authority by URL parsers);
 * - no backslash anywhere (URL parsers treat it as `/` for http);
 * - no `.` or `..` segment, raw or percent-encoded (`%2e`, any case);
 * - no control character and no `%00`.
 *
 * `#` is not checked here: an Event Function path may carry a decoded `%23`.
 * `parseRequestTarget` refuses it in a Node request target.
 */
export function checkRequestPath(path: unknown): RequestTargetRefusal | null {
  if (typeof path !== 'string' || path.length === 0) return 'missing';
  if (path.charCodeAt(0) !== 47 /* '/' */) return 'not-origin-form';
  if (path.length > 1 && (path[1] === '/' || path[1] === '\\')) return 'leading-double-slash';
  if (path.includes('\\')) return 'backslash';
  if (CONTROL_CHARACTER.test(path)) return 'control-character';
  if (/%00/.test(path)) return 'encoded-nul';
  for (const segment of path.split('/')) {
    // Cheap pre-check: only segments of 1-6 characters can spell `.`/`..`.
    if (segment.length === 0 || segment.length > 6) continue;
    const decoded = segment.replace(/%2e/gi, '.');
    if (decoded === '.' || decoded === '..') return 'dot-segment';
  }
  return null;
}

/**
 * Characters URL parsing percent-encodes in a path (the WHATWG path
 * percent-encode set, less those `checkRequestPath` refuses or the split on
 * `?` removes). Encoding exactly these keeps `request.path` byte-identical to
 * what `new URL(...).pathname` produced for every target still accepted, so
 * routes, params and logs see the same string as before.
 */
const PATH_ENCODE = /[ "<>^`{}]|[\u0080-\u{10ffff}]/gu;

function encodePathCharacter(character: string): string {
  try {
    return encodeURIComponent(character);
  } catch {
    // A lone surrogate cannot be UTF-8 encoded; URL parsing writes U+FFFD.
    return '%EF%BF%BD';
  }
}

/**
 * Splits a Node request target (`req.url`) into path and query without URL
 * resolution, or returns why it is refused. Only origin-form is accepted:
 * absolute-form (`http://host/path`) and asterisk-form (`*`) are refused, as
 * is anything `checkRequestPath` refuses, a `#` (a fragment), and a control
 * character, `%00` or `#` in the query.
 */
export function parseRequestTarget(
  target: unknown
): ParsedRequestTarget | { refused: RequestTargetRefusal } {
  if (typeof target !== 'string' || target.length === 0) return { refused: 'missing' };
  const queryStart = target.indexOf('?');
  const rawPath = queryStart === -1 ? target : target.slice(0, queryStart);
  const rawQuery = queryStart === -1 ? '' : target.slice(queryStart + 1);

  const refused = checkRequestPath(rawPath);
  if (refused) return { refused };
  // A fragment is never part of a request target; URL parsing dropped it.
  if (rawPath.includes('#')) return { refused: 'fragment' };
  if (CONTROL_CHARACTER.test(rawQuery)) return { refused: 'control-character' };
  if (/%00/.test(rawQuery)) return { refused: 'encoded-nul' };
  if (rawQuery.includes('#')) return { refused: 'fragment' };

  return {
    path: rawPath.replace(PATH_ENCODE, encodePathCharacter),
    // URLSearchParams decodes exactly as `URL.searchParams` did: URL parsing
    // only percent-encodes characters, which this decodes back. The `?` is
    // put back because URLSearchParams strips one leading `?`, and without
    // it `/x??a=1` would give `{ a: '1' }` instead of `{ '?a': '1' }`. A `?`
    // inside a value stays part of the value; for a repeated name the last
    // value wins, as `Object.fromEntries` always gave.
    query: Object.fromEntries(new URLSearchParams('?' + rawQuery)),
  };
}
