/**
 * Object keys whose values are never logged. A key matches when its
 * lower-cased name contains any of these, so `userPassword` and `X-Api-Key`
 * style names are caught too.
 *
 * Shared by `Logger` (which redacts every context it writes) and
 * `logRequest` (which applies it to bodies before they reach the logger, so a
 * body field allowlist can never let one through).
 *
 * @module sensitiveKeys
 */
export const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'apikey',
  'api_key',
  'secret',
  'secretkey',
  'clientsecret',
  'authorization',
  'auth',
  'cookie',
  'session',
  'sessionid',
  'creditcard',
  'cardnumber',
  'cvv',
  'ccv',
  'ssn',
  'socialsecurity',
  'privatekey',
  'private_key',
];

/** Whether a value stored under `key` must be redacted from logs. */
export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive));
}
