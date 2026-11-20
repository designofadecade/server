import { describe, it, expect } from 'vitest';
import { checkRequestPath, parseRequestTarget } from './requestTarget.ts';

/**
 * The router used to take `new URL(req.url, base).pathname` as the request
 * path. URL resolution rewrites `//x/admin` to `/admin` and removes dot
 * segments, so the router could serve a path a proxy in front never judged.
 * The target is now split verbatim; anything resolution would have changed is
 * refused.
 */
describe('parseRequestTarget', () => {
  describe('refuses targets URL resolution would rewrite', () => {
    it.each([
      ['//x/admin', 'leading-double-slash'],
      ['//admin', 'leading-double-slash'],
      ['/\\x/admin', 'leading-double-slash'],
      ['/pub\\..\\admin', 'backslash'],
      ['/a\\b', 'backslash'],
      ['/pub/../admin', 'dot-segment'],
      ['/pub/%2e%2e/admin', 'dot-segment'],
      ['/pub/%2E%2e/admin', 'dot-segment'],
      ['/pub/%2E./admin', 'dot-segment'],
      ['/pub/.%2e/admin', 'dot-segment'],
      ['/./admin', 'dot-segment'],
      ['/%2e/admin', 'dot-segment'],
      ['/admin/.', 'dot-segment'],
      ['/admin/..', 'dot-segment'],
      ['/admin/..?x=1', 'dot-segment'],
      ['http://x/admin', 'not-origin-form'],
      ['https://x/admin', 'not-origin-form'],
      ['*', 'not-origin-form'],
      ['admin', 'not-origin-form'],
      ['', 'missing'],
      ['/a%00b', 'encoded-nul'],
      ['/a?x=%00', 'encoded-nul'],
      ['/a\u0000b', 'control-character'],
      ['/a\tb', 'control-character'],
      ['/a\u007fb', 'control-character'],
      ['/a?x=\n', 'control-character'],
      ['/admin#x', 'fragment'],
      ['/a?x=1#y', 'fragment'],
    ])('%j -> %s', (target, reason) => {
      expect(parseRequestTarget(target)).toEqual({ refused: reason });
    });

    it('refuses a missing target', () => {
      expect(parseRequestTarget(undefined)).toEqual({ refused: 'missing' });
    });
  });

  describe('keeps every accepted target exactly as URL parsing gave it', () => {
    // Old behaviour, for comparison: path and query from URL resolution.
    const viaUrl = (target: string) => {
      const url = new URL(target, 'http://localhost');
      return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
    };

    it.each([
      '/',
      '/admin',
      '/admin/',
      '/users/42/',
      '/files/a%20b',
      '/files/a b',
      '/files/caf%C3%A9',
      '/files/café',
      '/a"b<c>d^e`f{g}h|i',
      '/a//b',
      '/a/...',
      '/a/.b/c.',
      '/a/%2e%2e%2e',
      '/a/%2fb',
      '/a/%5c',
      '/a;b=c',
      '/search?q=a?b',
      '/search?q=1&q=2&q=3',
      '/search?a=1&b=&c',
      '/search?q=a+b%20c',
      '/search?q=%E2%9C%93&x=%',
      '/search?',
      '/search?&&',
      '/q?redirect=/x/../y',
    ])('%j', (target) => {
      expect(parseRequestTarget(target)).toEqual(viaUrl(target));
    });

    it('encodes a lone surrogate as URL parsing does', () => {
      expect(parseRequestTarget('/a\ud800')).toEqual(viaUrl('/a\ud800'));
    });
  });
});

describe('checkRequestPath', () => {
  it('accepts a decoded # (an Event Function path may carry %23 decoded)', () => {
    expect(checkRequestPath('/tags/#hash')).toBeNull();
    expect(checkRequestPath('/files/a b')).toBeNull();
  });

  it('refuses the same structural rewrites as for a Node target', () => {
    expect(checkRequestPath('//x/admin')).toBe('leading-double-slash');
    expect(checkRequestPath('/pub/../admin')).toBe('dot-segment');
    expect(checkRequestPath('/a\u0000')).toBe('control-character');
    expect(checkRequestPath(undefined)).toBe('missing');
  });

  it('runs in linear time on many segments', () => {
    const started = performance.now();
    expect(checkRequestPath('/a' + '/.x'.repeat(200_000))).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
