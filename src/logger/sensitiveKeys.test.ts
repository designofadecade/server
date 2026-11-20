import { describe, it, expect } from 'vitest';
import { SENSITIVE_KEYS, isSensitiveKey } from './sensitiveKeys.ts';

/**
 * This list is the floor of every redaction in the package: `Logger` applies it
 * to every context, and `logRequest` applies it even to fields a caller has
 * allowlisted. A key silently dropping out of it, or matching becoming
 * case-sensitive, would put secrets in logs, so both are pinned here.
 */
describe('sensitiveKeys', () => {
  it('matches every listed key exactly', () => {
    for (const key of SENSITIVE_KEYS) expect(isSensitiveKey(key), key).toBe(true);
  });

  it('keeps the keys that guard credentials, sessions and card data', () => {
    for (const key of [
      'password',
      'token',
      'secret',
      'authorization',
      'cookie',
      'session',
      'apikey',
      'api_key',
      'cardnumber',
      'cvv',
      'ssn',
      'privatekey',
    ]) {
      expect(SENSITIVE_KEYS, key).toContain(key);
    }
  });

  it('matches regardless of case', () => {
    expect(isSensitiveKey('PASSWORD')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('CardNumber')).toBe(true);
  });

  it('matches a sensitive word anywhere in a longer key', () => {
    expect(isSensitiveKey('userPassword')).toBe(true);
    expect(isSensitiveKey('x-api_key')).toBe(true);
    expect(isSensitiveKey('refresh_token_hash')).toBe(true);
    expect(isSensitiveKey('sessionCookie')).toBe(true);
    expect(isSensitiveKey('oauthState')).toBe(true); // contains "auth"
  });

  it('does not match ordinary field names', () => {
    for (const key of ['id', 'email', 'name', 'orderId', 'sku', 'qty', 'page', 'status', '']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('is a frozen-shape list of lower-case strings', () => {
    for (const key of SENSITIVE_KEYS) expect(key).toBe(key.toLowerCase());
    expect(new Set(SENSITIVE_KEYS).size).toBe(SENSITIVE_KEYS.length);
  });
});
