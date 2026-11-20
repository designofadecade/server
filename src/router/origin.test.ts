import { describe, it, expect } from 'vitest';
import { isCorsSafelistedContentType, isSameOriginRequest } from './origin.ts';

/** One copy of the cross-origin rules, shared by Router and Local. */
describe('isCorsSafelistedContentType', () => {
  it.each([
    'text/plain',
    'TEXT/PLAIN; charset=utf-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    // The essence decides, not a substring: this is text/plain.
    'text/plain;application/json',
  ])('treats %s as safelisted', (value) => {
    expect(isCorsSafelistedContentType(value)).toBe(true);
  });

  it.each([undefined, '', 'application/json', 'application/json; charset=utf-8', ['text/plain']])(
    'does not treat %s as safelisted',
    (value) => {
      expect(isCorsSafelistedContentType(value as string | string[] | undefined)).toBe(false);
    }
  );
});

describe('isSameOriginRequest', () => {
  it('trusts Sec-Fetch-Site when present, whatever the Host says', () => {
    expect(
      isSameOriginRequest(
        { host: 'other:1', 'sec-fetch-site': 'same-origin' },
        'https://app.example'
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        { host: 'app.example', 'sec-fetch-site': 'cross-site' },
        'https://app.example'
      )
    ).toBe(false);
    expect(
      isSameOriginRequest(
        { host: 'app.example', 'sec-fetch-site': 'same-site' },
        'https://app.example'
      )
    ).toBe(false);
  });

  it('otherwise compares the Origin host:port with Host, case-insensitively', () => {
    expect(isSameOriginRequest({ host: 'App.Example:8443' }, 'https://app.example:8443')).toBe(
      true
    );
    expect(isSameOriginRequest({ host: 'app.example:8443' }, 'https://app.example:9443')).toBe(
      false
    );
  });

  it('fails closed on a missing Host or an unparseable Origin', () => {
    expect(isSameOriginRequest({}, 'https://app.example')).toBe(false);
    expect(isSameOriginRequest({ host: 'app.example' }, 'null')).toBe(false);
    expect(isSameOriginRequest({ host: 'app.example' }, 'not a url')).toBe(false);
  });
});
