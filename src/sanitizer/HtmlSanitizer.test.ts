import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import HtmlSanitizer from './HtmlSanitizer.ts';

describe('HtmlSanitizer', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('clean()', () => {
    describe('Basic tag filtering', () => {
      it('should keep allowed tags', () => {
        const html = '<p>Hello <b>World</b></p>';
        const result = HtmlSanitizer.clean(html, ['p', 'b']);

        expect(result).toContain('<p>');
        expect(result).toContain('<b>');
        expect(result).toContain('</p>');
        expect(result).toContain('</b>');
      });

      it('should remove disallowed tags while preserving text', () => {
        const html = '<p>Hello <script>alert("xss")</script> World</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).toContain('Hello');
        expect(result).toContain('World');
        expect(result).not.toContain('<script>');
      });

      it('should handle mixed allowed and disallowed tags', () => {
        const html = '<div><p>Safe</p><script>bad()</script><b>Bold</b></div>';
        const result = HtmlSanitizer.clean(html, ['p', 'b']);

        expect(result).toContain('<p>');
        expect(result).toContain('<b>');
        expect(result).not.toContain('<div>');
        expect(result).not.toContain('<script>');
      });

      it('should be case-insensitive for allowed tags', () => {
        const html = '<P>Text</P>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).toContain('<p>');
      });

      it('should handle self-closing tags', () => {
        const html = 'Line 1<br/>Line 2<hr/>Line 3';
        const result = HtmlSanitizer.clean(html, ['br', 'hr']);

        expect(result).toContain('<br />');
        expect(result).toContain('<hr />');
      });
    });

    describe('Dangerous content removal', () => {
      it('should remove script tags and their content', () => {
        const html = '<p>Safe</p><script>alert("xss")</script><p>Also safe</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('alert');
        expect(result).toContain('Safe');
        expect(result).toContain('Also safe');
      });

      it('should remove style tags and their content', () => {
        const html = '<p>Text</p><style>.red{color:red}</style>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('style');
        expect(result).not.toContain('color:red');
      });

      it('should remove HTML comments', () => {
        const html = '<p>Text</p><!-- This is a comment --><p>More</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('<!--');
        expect(result).not.toContain('comment');
        expect(result).toContain('Text');
        expect(result).toContain('More');
      });
    });

    describe('URL validation in anchor tags', () => {
      it('should keep safe https URLs', () => {
        const html = '<a href="https://example.com">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('href="https://example.com"');
      });

      it('should keep safe http URLs', () => {
        const html = '<a href="http://example.com">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('href="http://example.com"');
      });

      it('should keep relative URLs', () => {
        const html = '<a href="/path/to/page">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('href="/path/to/page"');
      });

      it('should remove javascript: protocol', () => {
        const html = '<a href="javascript:alert(1)">Bad Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('javascript:');
        expect(result).toContain('<a>');
      });

      it('should remove data: protocol', () => {
        const html = '<a href="data:text/html,<script>alert(1)</script>">Bad</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('data:');
      });

      it('should keep mailto: URLs', () => {
        const html = '<a href="mailto:test@example.com">Email</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('mailto:test@example.com');
      });

      it('should keep tel: URLs', () => {
        const html = '<a href="tel:+1234567890">Call</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('tel:+1234567890');
      });
    });

    describe('Input validation', () => {
      it('should return empty string for null input', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(null as any, ['p']);
        expect(result).toBe('');
      });

      it('should return empty string for undefined input', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(undefined as any, ['p']);
        expect(result).toBe('');
      });

      it('should return empty string for non-string input', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(123 as any, ['p']);
        expect(result).toBe('');
      });

      it('should strip all tags if allowedTags is empty array', () => {
        const html = '<p>Text</p>';
        const result = HtmlSanitizer.clean(html, []);

        expect(result).not.toContain('<p>');
        expect(result).toContain('Text');
      });

      it('should strip all tags if allowedTags is not an array', () => {
        const html = '<p>Text</p>';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(html, 'p' as any);

        expect(result).not.toContain('<p>');
      });

      it('should filter out invalid tag names', () => {
        const html = '<p>Text</p><div>More</div>';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(html, ['p', '123invalid', '', null as any]);

        expect(result).toContain('<p>');
        expect(result).not.toContain('<div>');
      });
    });
  });

  describe('sanitizeBasicHtml()', () => {
    it('should allow basic formatting tags', () => {
      const html = '<b>Bold</b> <i>Italic</i> <u>Underline</u>';
      const result = HtmlSanitizer.sanitizeBasicHtml(html);

      expect(result).toContain('<b>');
      expect(result).toContain('<i>');
      expect(result).toContain('<u>');
    });

    it('should allow anchor tags', () => {
      const html = '<a href="https://example.com">Link</a>';
      const result = HtmlSanitizer.sanitizeBasicHtml(html);

      expect(result).toContain('<a');
      expect(result).toContain('href');
    });

    it('should remove other tags', () => {
      const html = '<div><b>Bold</b><script>bad()</script></div>';
      const result = HtmlSanitizer.sanitizeBasicHtml(html);

      expect(result).not.toContain('<div>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('<b>');
    });
  });

  describe('stripAllTags()', () => {
    it('should remove all HTML tags', () => {
      const html = '<p><b>Bold</b> and <i>italic</i> text</p>';
      const result = HtmlSanitizer.stripAllTags(html);

      expect(result).toBe('Bold and italic text');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('should decode HTML entities', () => {
      const html = '<p>&lt;b&gt;Not bold&lt;/b&gt;</p>';
      const result = HtmlSanitizer.stripAllTags(html);

      expect(result).toBe('<b>Not bold</b>');
    });

    it('should remove script tags and content', () => {
      const html = 'Safe text<script>alert("xss")</script>More safe';
      const result = HtmlSanitizer.stripAllTags(html);

      expect(result).toBe('Safe textMore safe');
      expect(result).not.toContain('script');
      expect(result).not.toContain('alert');
    });

    it('should normalize whitespace', () => {
      const html = '<p>Too     many    spaces</p>';
      const result = HtmlSanitizer.stripAllTags(html);

      expect(result).toBe('Too many spaces');
    });

    it('should handle empty input', () => {
      expect(HtmlSanitizer.stripAllTags('')).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(HtmlSanitizer.stripAllTags(null as any)).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(HtmlSanitizer.stripAllTags(undefined as any)).toBe('');
    });
  });

  describe('stripAll()', () => {
    it('should be an alias for stripAllTags', () => {
      const html = '<p>Text</p>';
      const result1 = HtmlSanitizer.stripAll(html);
      const result2 = HtmlSanitizer.stripAllTags(html);

      expect(result1).toBe(result2);
    });
  });

  describe('sanitizeForAttribute()', () => {
    it('should escape HTML special characters', () => {
      const text = 'Value with "quotes" & <tags>';
      const result = HtmlSanitizer.sanitizeForAttribute(text);

      expect(result).toContain('&quot;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    it('should escape single quotes', () => {
      const text = "Value with 'single quotes'";
      const result = HtmlSanitizer.sanitizeForAttribute(text);

      expect(result).toContain('&#39;');
    });

    it('should escape newlines and carriage returns', () => {
      const text = 'Line 1\nLine 2\rLine 3';
      const result = HtmlSanitizer.sanitizeForAttribute(text);

      expect(result).toContain('&#10;');
      expect(result).toContain('&#13;');
    });

    it('should escape ampersand first to avoid double-escaping', () => {
      const text = '&quot;';
      const result = HtmlSanitizer.sanitizeForAttribute(text);

      // Should become &amp;quot; not &amp;amp;quot;
      expect(result).toBe('&amp;quot;');
    });

    it('should handle empty strings', () => {
      expect(HtmlSanitizer.sanitizeForAttribute('')).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(HtmlSanitizer.sanitizeForAttribute(null as any)).toBe('');
    });
  });

  describe('sanitizeForHtml()', () => {
    it('should escape HTML special characters', () => {
      const text = '<script>alert("xss")</script>';
      const result = HtmlSanitizer.sanitizeForHtml(text);

      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape ampersands', () => {
      const text = 'AT&T & co.';
      const result = HtmlSanitizer.sanitizeForHtml(text);

      expect(result).toContain('&amp;');
    });

    it('should escape quotes', () => {
      const text = 'Say "hello" to \'everyone\'';
      const result = HtmlSanitizer.sanitizeForHtml(text);

      expect(result).toContain('&quot;');
      expect(result).toContain('&#39;');
    });

    it('should handle empty input', () => {
      expect(HtmlSanitizer.sanitizeForHtml('')).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(HtmlSanitizer.sanitizeForHtml(null as any)).toBe('');
    });
  });

  describe('isValidUrl()', () => {
    describe('Safe URLs', () => {
      it('should accept https URLs', () => {
        expect(HtmlSanitizer.isValidUrl('https://example.com')).toBe(true);
      });

      it('should accept http URLs', () => {
        expect(HtmlSanitizer.isValidUrl('http://example.com')).toBe(true);
      });

      it('should accept mailto URLs', () => {
        expect(HtmlSanitizer.isValidUrl('mailto:test@example.com')).toBe(true);
      });

      it('should accept tel URLs', () => {
        expect(HtmlSanitizer.isValidUrl('tel:+1234567890')).toBe(true);
      });

      it('should accept relative paths', () => {
        expect(HtmlSanitizer.isValidUrl('/path/to/page')).toBe(true);
        expect(HtmlSanitizer.isValidUrl('../relative/path')).toBe(true);
        expect(HtmlSanitizer.isValidUrl('./path')).toBe(true);
      });

      it('should accept anchor links', () => {
        expect(HtmlSanitizer.isValidUrl('#section')).toBe(true);
      });
    });

    describe('Dangerous URLs', () => {
      it('should reject javascript: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('javascript:alert(1)')).toBe(false);
        expect(HtmlSanitizer.isValidUrl('JAVASCRIPT:alert(1)')).toBe(false);
      });

      it('should reject data: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      });

      it('should reject vbscript: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('vbscript:msgbox(1)')).toBe(false);
      });

      it('should reject file: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('file:///etc/passwd')).toBe(false);
      });

      it('should reject blob: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('blob:https://example.com')).toBe(false);
      });

      it('should reject about: protocol', () => {
        expect(HtmlSanitizer.isValidUrl('about:blank')).toBe(false);
      });

      it('should reject encoded dangerous protocols', () => {
        expect(HtmlSanitizer.isValidUrl('java%73cript:alert(1)')).toBe(false);
      });
    });

    describe('Invalid input', () => {
      it('should reject empty strings', () => {
        expect(HtmlSanitizer.isValidUrl('')).toBe(false);
        expect(HtmlSanitizer.isValidUrl('   ')).toBe(false);
      });

      it('should reject null/undefined', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(HtmlSanitizer.isValidUrl(null as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(HtmlSanitizer.isValidUrl(undefined as any)).toBe(false);
      });

      it('should reject URLs that are too long', () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(3000);
        expect(HtmlSanitizer.isValidUrl(longUrl)).toBe(false);
      });
    });
  });

  describe('isValidEmail()', () => {
    describe('Valid emails', () => {
      it('should accept simple email', () => {
        expect(HtmlSanitizer.isValidEmail('user@example.com')).toBe(true);
      });

      it('should accept email with subdomain', () => {
        expect(HtmlSanitizer.isValidEmail('user@mail.example.com')).toBe(true);
      });

      it('should accept email with plus sign', () => {
        expect(HtmlSanitizer.isValidEmail('user+tag@example.com')).toBe(true);
      });

      it('should accept email with dots in local part', () => {
        expect(HtmlSanitizer.isValidEmail('first.last@example.com')).toBe(true);
      });

      it('should accept email with numbers', () => {
        expect(HtmlSanitizer.isValidEmail('user123@example456.com')).toBe(true);
      });

      it('should accept email with hyphen in domain', () => {
        expect(HtmlSanitizer.isValidEmail('user@my-domain.com')).toBe(true);
      });

      it('should accept email with underscore in local part', () => {
        expect(HtmlSanitizer.isValidEmail('user_name@example.com')).toBe(true);
      });

      it('should accept international TLDs', () => {
        expect(HtmlSanitizer.isValidEmail('user@example.co.uk')).toBe(true);
        expect(HtmlSanitizer.isValidEmail('user@example.org')).toBe(true);
      });
    });

    describe('Invalid emails', () => {
      it('should reject email without @', () => {
        expect(HtmlSanitizer.isValidEmail('userexample.com')).toBe(false);
      });

      it('should reject email with multiple @', () => {
        expect(HtmlSanitizer.isValidEmail('user@@example.com')).toBe(false);
        expect(HtmlSanitizer.isValidEmail('user@mail@example.com')).toBe(false);
      });

      it('should reject email without domain', () => {
        expect(HtmlSanitizer.isValidEmail('user@')).toBe(false);
      });

      it('should reject email without local part', () => {
        expect(HtmlSanitizer.isValidEmail('@example.com')).toBe(false);
      });

      it('should reject email without TLD', () => {
        expect(HtmlSanitizer.isValidEmail('user@example')).toBe(false);
      });

      it('should reject email with consecutive dots', () => {
        expect(HtmlSanitizer.isValidEmail('user..name@example.com')).toBe(false);
        expect(HtmlSanitizer.isValidEmail('user@example..com')).toBe(false);
      });

      it('should reject email starting with dot', () => {
        expect(HtmlSanitizer.isValidEmail('.user@example.com')).toBe(false);
      });

      it('should reject email ending with dot', () => {
        expect(HtmlSanitizer.isValidEmail('user.@example.com')).toBe(false);
      });

      it('should reject email with spaces', () => {
        expect(HtmlSanitizer.isValidEmail('user name@example.com')).toBe(false);
      });

      it('should reject email with invalid characters', () => {
        expect(HtmlSanitizer.isValidEmail('user#name@example.com')).toBe(false);
        expect(HtmlSanitizer.isValidEmail('user$name@example.com')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(HtmlSanitizer.isValidEmail('')).toBe(false);
        expect(HtmlSanitizer.isValidEmail('   ')).toBe(false);
      });

      it('should reject null/undefined', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(HtmlSanitizer.isValidEmail(null as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(HtmlSanitizer.isValidEmail(undefined as any)).toBe(false);
      });

      it('should reject TLD with numbers', () => {
        expect(HtmlSanitizer.isValidEmail('user@example.c0m')).toBe(false);
      });

      it('should reject too-short TLD', () => {
        expect(HtmlSanitizer.isValidEmail('user@example.c')).toBe(false);
      });
    });
  });

  describe('decodeHtmlEntities()', () => {
    it('should decode common named entities', () => {
      const text = '&lt;p&gt;Hello &amp; goodbye&lt;/p&gt;';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('<p>Hello & goodbye</p>');
    });

    it('should decode quote entities', () => {
      const text = '&quot;Hello&quot; and &#39;goodbye&#39;';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('"Hello" and \'goodbye\'');
    });

    it('should decode nbsp', () => {
      const text = 'Word&nbsp;Space';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('Word Space');
    });

    it('should decode special symbols', () => {
      const text = '&copy; 2024 &reg; &trade;';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('© 2024 ® ™');
    });

    it('should decode decimal numeric entities', () => {
      const text = '&#65;&#66;&#67;';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('ABC');
    });

    it('should decode hexadecimal numeric entities', () => {
      const text = '&#x41;&#x42;&#x43;';
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('ABC');
    });

    it('should not decode invalid numeric codes', () => {
      const text = '&#999999999;'; // Out of Unicode range
      const result = HtmlSanitizer.decodeHtmlEntities(text);

      expect(result).toBe('&#999999999;'); // Should remain unchanged
    });

    it('should handle empty input', () => {
      expect(HtmlSanitizer.decodeHtmlEntities('')).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(HtmlSanitizer.decodeHtmlEntities(null as any)).toBe('');
    });
  });

  describe('replaceTagAttributes()', () => {
    it('should add attributes to tags', () => {
      const html = '<a href="/link">Click</a>';
      const result = HtmlSanitizer.replaceTagAttributes(html, 'a', {
        target: '_blank',
        rel: 'noopener',
      });

      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener"');
    });

    it('should preserve existing href attribute', () => {
      const html = '<a href="/original">Click</a>';
      const result = HtmlSanitizer.replaceTagAttributes(html, 'a', {
        target: '_blank',
      });

      expect(result).toContain('href="/original"');
      expect(result).toContain('target="_blank"');
    });

    it('should handle empty attributes object', () => {
      const html = '<a href="/link">Click</a>';
      const result = HtmlSanitizer.replaceTagAttributes(html, 'a', {});

      expect(result).toContain('href="/link"');
    });

    it('should return empty for null html', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = HtmlSanitizer.replaceTagAttributes(null as any, 'a', { target: '_blank' });
      expect(result).toBe('');
    });

    it('should return html unchanged for null tagName', () => {
      const html = '<a href="/link">Click</a>';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = HtmlSanitizer.replaceTagAttributes(html, null as any, { target: '_blank' });

      expect(result).toBe(html);
    });
  });

  describe('DoS protection', () => {
    it('should truncate large input in clean()', () => {
      const consoleErrorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const largeHtml = '<p>' + 'a'.repeat(2 * 1024 * 1024) + '</p>';
      HtmlSanitizer.clean(largeHtml, ['p']);

      // Check that console.log was called with JSON containing the error
      const logCall = consoleErrorSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'ERROR' && parsed.message.includes('exceeds maximum size');
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();

      consoleErrorSpy.mockRestore();
    });

    it('should truncate large input in stripAllTags()', () => {
      const consoleErrorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const largeHtml = 'a'.repeat(2 * 1024 * 1024);
      HtmlSanitizer.stripAllTags(largeHtml);

      // Check that console.log was called with JSON containing the error
      const logCall = consoleErrorSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.level === 'ERROR' && parsed.message.includes('stripAllTags');
        } catch {
          return false;
        }
      });
      expect(logCall).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });
});
