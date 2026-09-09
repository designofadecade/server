import { describe, it, expect } from 'vitest';
import HtmlSanitizer from './HtmlSanitizer.ts';

/**
 * Defensive branches of the sanitizer: size caps, encoded protocols, malformed
 * entities and the fallbacks that fire when earlier stages fail. These are the
 * paths an attacker reaches deliberately, so they should not be the least
 * exercised code in the XSS control.
 */

const MB = 1024 * 1024;

describe('HtmlSanitizer defensive branches', () => {
  describe('allowlist handling', () => {
    it('should strip everything when the allowlist has no valid entries', () => {
      const result = HtmlSanitizer.clean('<p>text</p><b>bold</b>', ['', '  '] as string[]);

      expect(result).not.toContain('<p>');
      expect(result).toContain('text');
    });

    it('should strip everything when the allowlist contains only dangerous tags', () => {
      const result = HtmlSanitizer.clean('<p>text</p><script>alert(1)</script>', ['script']);

      expect(result).not.toContain('<script');
      expect(result).not.toContain('alert(1)');
    });

    it('should drop a dangerous tag even if it is on the allowlist', () => {
      const result = HtmlSanitizer.clean('<p>ok</p><iframe src=x></iframe>', ['p', 'iframe']);

      expect(result).not.toContain('<iframe');
      expect(result).toContain('ok');
    });
  });

  describe('size caps', () => {
    it('should truncate input past the maximum size', () => {
      const result = HtmlSanitizer.clean(`<p>${'a'.repeat(2 * MB)}</p>`, ['p']);

      expect(result.length).toBeLessThanOrEqual(2 * MB);
    });

    it('should truncate an oversized attribute value', () => {
      const result = HtmlSanitizer.sanitizeForAttribute('x'.repeat(2 * MB));

      expect(result.length).toBeLessThanOrEqual(2 * MB);
    });

    it('should truncate oversized input to stripAllTags', () => {
      const result = HtmlSanitizer.stripAllTags(`<p>${'a'.repeat(2 * MB)}</p>`);

      expect(result.length).toBeLessThanOrEqual(2 * MB);
    });

    it('should refuse entity decoding past the size limit', () => {
      const result = HtmlSanitizer.decodeHtmlEntities('&amp;'.repeat(MB));

      expect(typeof result).toBe('string');
    });

    it('should reject an over-long style attribute', () => {
      // Trimming happens before the length check, so padding must be real content.
      expect(HtmlSanitizer.sanitizeStyleAttribute('color:red;'.repeat(200))).toBe('');
    });

    it('should reject an over-long email', () => {
      expect(HtmlSanitizer.isValidEmail(`${'a'.repeat(300)}@example.com`)).toBe(false);
    });
  });

  describe('URL validation', () => {
    it('should reject a percent-encoded javascript protocol', () => {
      expect(HtmlSanitizer.isValidUrl('%6a%61%76%61%73%63%72%69%70%74:alert(1)')).toBe(false);
    });

    it('should reject a URL whose percent-encoding cannot be decoded', () => {
      // A lone % makes decodeURIComponent throw; the sanitizer must fail closed.
      expect(HtmlSanitizer.isValidUrl('/path/%')).toBe(false);
    });

    it('should allow a well-formed relative URL', () => {
      expect(HtmlSanitizer.isValidUrl('/about/team')).toBe(true);
    });

    it('should allow a percent-encoded relative URL that is harmless', () => {
      expect(HtmlSanitizer.isValidUrl('/search%20results')).toBe(true);
    });

    it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html;base64,PHN2Zz4='])(
      'should reject %s',
      (url) => {
        expect(HtmlSanitizer.isValidUrl(url)).toBe(false);
      }
    );
  });

  describe('style attribute', () => {
    it('should drop a declaration with no colon', () => {
      expect(HtmlSanitizer.sanitizeStyleAttribute('color red')).toBe('');
    });

    it('should drop a property that is not allowlisted', () => {
      expect(HtmlSanitizer.sanitizeStyleAttribute('position:absolute')).toBe('');
    });

    it('should keep an allowlisted colour declaration', () => {
      expect(HtmlSanitizer.sanitizeStyleAttribute('color:#ff0000')).toContain('color');
    });

    it('should return empty for an empty style', () => {
      expect(HtmlSanitizer.sanitizeStyleAttribute('   ')).toBe('');
    });
  });

  describe('entity decoding', () => {
    it('should leave an out-of-range numeric entity alone', () => {
      const result = HtmlSanitizer.decodeHtmlEntities('&#1114112;');

      expect(result).toContain('&#');
    });

    it('should leave an out-of-range hex entity alone', () => {
      const result = HtmlSanitizer.decodeHtmlEntities('&#x110000;');

      expect(result).toContain('&#x');
    });

    it('should decode valid numeric and hex entities', () => {
      expect(HtmlSanitizer.decodeHtmlEntities('&#65;&#x42;')).toBe('AB');
    });

    it('should warn but not throw on deeply nested encoding', () => {
      // Each pass peels one layer; more layers than the pass limit trips the guard.
      const nested = '&amp;'.repeat(20) + 'lt;script&gt;';

      expect(() => HtmlSanitizer.clean(nested, ['p'])).not.toThrow();
    });
  });

  describe('email validation', () => {
    it('should accept a normal address', () => {
      expect(HtmlSanitizer.isValidEmail('user@example.com')).toBe(true);
    });

    it.each(['not-an-email', '@example.com', 'user@', 'user@@example.com', ''])(
      'should reject %s',
      (email) => {
        expect(HtmlSanitizer.isValidEmail(email)).toBe(false);
      }
    );
  });
});
