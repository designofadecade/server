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

    describe('Never-allowed dangerous tags (best practice)', () => {
      it('should block script tags even if in allowed list', () => {
        const html = '<p>Safe</p><script>alert(1)</script>';
        // User mistakenly tries to allow script tags
        const result = HtmlSanitizer.clean(html, ['p', 'script']);

        expect(result).not.toContain('<script>');
        expect(result).not.toContain('alert');
        expect(result).toContain('<p>');
        expect(result).toContain('Safe');
      });

      it('should block iframe tags even if in allowed list', () => {
        const html = '<p>Text</p><iframe src="evil.com"></iframe>';
        const result = HtmlSanitizer.clean(html, ['p', 'iframe']);

        expect(result).not.toContain('iframe');
        expect(result).toContain('Text');
      });

      it('should block object and embed tags', () => {
        const html = '<p>Safe</p><object data="file.swf"></object><embed src="file.swf">';
        const result = HtmlSanitizer.clean(html, ['p', 'object', 'embed']);

        expect(result).not.toContain('object');
        expect(result).not.toContain('embed');
        expect(result).toContain('Safe');
      });

      it('should block form-related tags', () => {
        const html =
          '<p>Text</p><form action="/evil"><input type="text"><button>Click</button></form>';
        const result = HtmlSanitizer.clean(html, ['p', 'form', 'input', 'button']);

        expect(result).not.toContain('form');
        expect(result).not.toContain('input');
        expect(result).not.toContain('button');
        expect(result).toContain('Text');
      });

      it('should block base and link tags', () => {
        const html =
          '<base href="http://evil.com"><link rel="stylesheet" href="evil.css"><p>Text</p>';
        const result = HtmlSanitizer.clean(html, ['p', 'base', 'link']);

        expect(result).not.toContain('base');
        expect(result).not.toContain('link');
        expect(result).toContain('Text');
      });

      it('should block meta tags', () => {
        const html = '<meta http-equiv="refresh" content="0;url=http://evil.com"><p>Text</p>';
        const result = HtmlSanitizer.clean(html, ['p', 'meta']);

        expect(result).not.toContain('meta');
        expect(result).toContain('Text');
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

      it('should remove HTML-encoded script tags (XSS prevention)', () => {
        const html =
          '&lt;script&gt;alert(2)&lt;/script&gt;<strong>Test</strong> all tag should pass properly';
        const result = HtmlSanitizer.clean(html, ['strong', 'em', 'u', 's', 'a']);

        // The encoded script tag should be completely removed after decoding
        expect(result).not.toContain('script');
        expect(result).not.toContain('alert');
        expect(result).not.toContain('&lt;script&gt;');
        expect(result).not.toContain('<script>');
        expect(result).toContain('<strong>');
        expect(result).toContain('Test');
        expect(result).toContain('properly');
      });

      it('should handle mixed encoded and unencoded dangerous content', () => {
        const html = '&lt;script&gt;alert(1)&lt;/script&gt;<p>Safe</p><script>alert(2)</script>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('alert');
        expect(result).toContain('Safe');
      });

      it('should remove style tags and their content', () => {
        const html = '<p>Text</p><style>.red{color:red}</style>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('style');
        expect(result).not.toContain('color:red');
      });

      it('should remove HTML-encoded style tags', () => {
        const html = '&lt;style&gt;.red{color:red}&lt;/style&gt;<p>Text</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('style');
        expect(result).not.toContain('color:red');
        expect(result).toContain('Text');
      });

      it('should remove HTML comments', () => {
        const html = '<p>Text</p><!-- This is a comment --><p>More</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('<!--');
        expect(result).not.toContain('comment');
        expect(result).toContain('Text');
        expect(result).toContain('More');
      });

      it('should handle multiple levels of entity encoding (nested encoding attack)', () => {
        // &amp;lt; becomes &lt; which becomes <
        const html = '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;<p>Safe</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('alert');
        expect(result).not.toContain('&lt;');
        expect(result).not.toContain('<script>');
        expect(result).toContain('Safe');
      });

      it('should handle triple-encoded entities', () => {
        // Three levels of encoding
        const html = '&amp;amp;lt;script&amp;amp;gt;bad()&amp;amp;lt;/script&amp;amp;gt;';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('bad');
      });

      it('should remove null bytes (string termination attack)', () => {
        const html = '<p>Safe</p>\x00<script>alert(1)</script>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('\x00');
        expect(result).not.toContain('script');
        expect(result).toContain('Safe');
      });
    });

    describe('Enhanced anchor tag security (best practice)', () => {
      it('should add target="_blank" and rel="noopener noreferrer" to external links', () => {
        const html = '<a href="https://external.com">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('target="_blank"');
        expect(result).toContain('rel="noopener noreferrer"');
        expect(result).toContain('href="https://external.com"');
      });

      it('should add security attributes to http links', () => {
        const html = '<a href="http://external.com">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).toContain('target="_blank"');
        expect(result).toContain('rel="noopener noreferrer"');
      });

      it('should NOT add target/rel to relative links', () => {
        const html = '<a href="/internal/page">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('target=');
        expect(result).not.toContain('rel=');
        expect(result).toContain('href="/internal/page"');
      });

      it('should NOT add target/rel to anchor links', () => {
        const html = '<a href="#section">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('target=');
        expect(result).not.toContain('rel=');
      });

      it('should NOT add target/rel to mailto links', () => {
        const html = '<a href="mailto:test@example.com">Email</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('target=');
        expect(result).not.toContain('rel=');
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

    describe('Attribute preservation (allowedAttributes parameter)', () => {
      it('should preserve allowed attributes on tags', () => {
        const html = '<span class="legal-tag" data-uuid="123">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['class', 'data-uuid'],
        });

        expect(result).toContain('class="legal-tag"');
        expect(result).toContain('data-uuid="123"');
        expect(result).toContain('>Text</span>');
      });

      it('should remove attributes not in allowedAttributes', () => {
        const html = '<span class="legal-tag" data-uuid="123" title="info">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['class', 'data-uuid'],
        });

        expect(result).toContain('class="legal-tag"');
        expect(result).toContain('data-uuid="123"');
        expect(result).not.toContain('title=');
      });

      it('should remove event handlers even if in allowedAttributes', () => {
        const html = '<span class="legal-tag" onclick="alert(1)">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['class', 'onclick'],
        });

        expect(result).toContain('class="legal-tag"');
        expect(result).not.toContain('onclick');
        expect(result).not.toContain('alert');
      });

      it('should sanitize attribute values to prevent injection', () => {
        const html = '<span data-value="test&quot; onload=&quot;bad()">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['data-value'],
        });

        expect(result).toContain('data-value=');
        expect(result).not.toContain('onload');
        expect(result).not.toContain('bad()');
      });

      it('should maintain backward compatibility when allowedAttributes is not provided', () => {
        const html = '<span class="test" data-uuid="123">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span']);

        expect(result).not.toContain('class=');
        expect(result).not.toContain('data-uuid=');
        expect(result).toBe('<span>Text</span>');
      });

      it('should handle multiple tags with different allowed attributes', () => {
        const html =
          '<span class="legal" data-uuid="123">Legal</span><a href="/link" target="_blank">Link</a>';
        const result = HtmlSanitizer.clean(html, ['span', 'a'], {
          span: ['class', 'data-uuid'],
          a: ['href', 'target'],
        });

        expect(result).toContain('class="legal"');
        expect(result).toContain('data-uuid="123"');
        expect(result).toContain('href="/link"');
        expect(result).toContain('target="_blank"');
      });

      it('should validate href attributes even when in allowedAttributes', () => {
        const html = '<a href="javascript:alert(1)">Bad</a><a href="https://safe.com">Good</a>';
        const result = HtmlSanitizer.clean(html, ['a'], {
          a: ['href'],
        });

        expect(result).not.toContain('javascript:');
        expect(result).toContain('href="https://safe.com"');
      });

      it('should add security attributes to external anchor links with allowedAttributes', () => {
        const html = '<a href="https://external.com">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a'], {
          a: ['href'],
        });

        expect(result).toContain('href="https://external.com"');
        expect(result).toContain('target="_blank"');
        expect(result).toContain('rel="noopener noreferrer"');
      });

      it('should preserve custom target and rel if specified in allowedAttributes', () => {
        const html = '<a href="https://external.com" target="_self" rel="alternate">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a'], {
          a: ['href', 'target', 'rel'],
        });

        expect(result).toContain('href="https://external.com"');
        expect(result).toContain('target="_self"');
        expect(result).toContain('rel="alternate"');
      });

      it('should handle self-closing tags with attributes', () => {
        const html = '<br class="clearfix"/><hr class="divider"/>';
        const result = HtmlSanitizer.clean(html, ['br', 'hr'], {
          br: ['class'],
          hr: ['class'],
        });

        expect(result).toContain('<br class="clearfix" />');
        expect(result).toContain('<hr class="divider" />');
      });

      it('should ignore allowedAttributes for tags not in allowedTags', () => {
        const html = '<span class="test">Visible</span><div class="hidden">Hidden</div>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['class'],
          div: ['class'],
        });

        expect(result).toContain('class="test"');
        expect(result).not.toContain('<div');
        expect(result).toContain('Hidden');
      });

      it('should handle empty allowedAttributes object', () => {
        const html = '<span class="test">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {});

        expect(result).not.toContain('class=');
        expect(result).toBe('<span>Text</span>');
      });

      it('should handle invalid allowedAttributes parameter', () => {
        const html = '<span class="test">Text</span>';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = HtmlSanitizer.clean(html, ['span'], 'invalid' as any);

        expect(result).not.toContain('class=');
        expect(result).toBe('<span>Text</span>');
      });
    });

    describe('Style attribute sanitization', () => {
      it('should preserve safe color styles', () => {
        const html = '<span style="color: red;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('style="color: red"');
      });

      it('should preserve hex color styles', () => {
        const html = '<span style="color: #ff0000;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('style="color: #ff0000"');
      });

      it('should preserve rgb color styles', () => {
        const html = '<span style="color: rgb(255, 0, 0);">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('style="color: rgb(255, 0, 0)"');
      });

      it('should remove dangerous CSS properties', () => {
        const html = '<span style="color: red; behavior: url(xss.htc);">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('color: red');
        expect(result).not.toContain('behavior');
        expect(result).not.toContain('url(');
      });

      it('should block javascript in style', () => {
        const html = '<span style="color: javascript:alert(1);">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).not.toContain('javascript:');
        expect(result).toBe('<span>Text</span>');
      });

      it('should block expressions in style', () => {
        const html = '<span style="width: expression(alert(1));">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).not.toContain('expression');
        expect(result).toBe('<span>Text</span>');
      });

      it('should block -moz-binding', () => {
        const html = '<span style="-moz-binding: url(xss.xml);">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).not.toContain('moz-binding');
        expect(result).toBe('<span>Text</span>');
      });

      it('should only allow color-related properties', () => {
        const html = '<span style="color: red; width: 100px; position: absolute;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('color: red');
        expect(result).not.toContain('width');
        expect(result).not.toContain('position');
      });

      it('should allow background-color', () => {
        const html = '<span style="background-color: blue;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('background-color: blue');
      });

      it('should handle multiple color properties', () => {
        const html = '<span style="color: red; background-color: #ffffff;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toContain('color: red');
        expect(result).toContain('background-color: #ffffff');
      });

      it('should reject invalid color values', () => {
        const html = '<span style="color: notacolor;">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toBe('<span>Text</span>');
      });

      it('should handle empty style attribute', () => {
        const html = '<span style="">Text</span>';
        const result = HtmlSanitizer.clean(html, ['span'], {
          span: ['style'],
        });

        expect(result).toBe('<span>Text</span>');
      });
    });

    describe('isValidColorValue()', () => {
      it('should validate hex colors', () => {
        expect(HtmlSanitizer.isValidColorValue('#fff')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('#ffffff')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('#FF0000')).toBe(true);
      });

      it('should validate rgb colors', () => {
        expect(HtmlSanitizer.isValidColorValue('rgb(255, 0, 0)')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('RGB(255, 0, 0)')).toBe(true);
      });

      it('should validate rgba colors', () => {
        expect(HtmlSanitizer.isValidColorValue('rgba(255, 0, 0, 0.5)')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('rgba(255, 0, 0, 1)')).toBe(true);
      });

      it('should validate named colors', () => {
        expect(HtmlSanitizer.isValidColorValue('red')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('blue')).toBe(true);
        expect(HtmlSanitizer.isValidColorValue('transparent')).toBe(true);
      });

      it('should reject invalid colors', () => {
        expect(HtmlSanitizer.isValidColorValue('notacolor')).toBe(false);
        expect(HtmlSanitizer.isValidColorValue('javascript:alert(1)')).toBe(false);
        expect(HtmlSanitizer.isValidColorValue('')).toBe(false);
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

    describe('Additional XSS attack vectors (deployment security check)', () => {
      it('should remove onclick event handlers from all tags', () => {
        const html = '<img src="x" onclick="alert(1)"><div onclick="bad()">Text</div>';
        const result = HtmlSanitizer.clean(html, ['img', 'div']);

        expect(result).not.toContain('onclick');
        expect(result).not.toContain('alert');
        expect(result).not.toContain('bad()');
      });

      it('should remove onerror event handlers', () => {
        const html = '<img src="invalid" onerror="alert(1)">';
        const result = HtmlSanitizer.clean(html, ['img']);

        expect(result).not.toContain('onerror');
        expect(result).not.toContain('alert');
      });

      it('should remove onload event handlers', () => {
        const html = '<body onload="alert(1)">Content</body>';
        const result = HtmlSanitizer.clean(html, ['body']);

        expect(result).not.toContain('onload');
        expect(result).not.toContain('alert');
      });

      it('should remove onmouseover and other event handlers', () => {
        const html = '<div onmouseover="alert(1)" onmouseout="bad()">Hover</div>';
        const result = HtmlSanitizer.clean(html, ['div']);

        expect(result).not.toContain('onmouseover');
        expect(result).not.toContain('onmouseout');
        expect(result).not.toContain('alert');
        expect(result).toContain('Hover');
      });

      it('should handle encoded javascript protocol', () => {
        const html = '<a href="jav&#x09;ascript:alert(1)">Link</a>';
        const result = HtmlSanitizer.clean(html, ['a']);

        expect(result).not.toContain('javascript');
        expect(result).not.toContain('alert');
      });

      it('should remove svg script tags', () => {
        const html = '<svg><script>alert(1)</script></svg>';
        const result = HtmlSanitizer.clean(html, ['svg']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('alert');
      });

      it('should handle style with @import', () => {
        const html = '<style>@import url("http://evil.com/steal.css");</style>';
        const result = HtmlSanitizer.clean(html, ['style', 'p']);

        expect(result).not.toContain('style');
        expect(result).not.toContain('@import');
        expect(result).not.toContain('evil.com');
      });

      it('should handle complex mixed attack', () => {
        const html =
          '&lt;script&gt;bad1()&lt;/script&gt;<script>bad2()</script><p onclick="bad3()">Safe</p>';
        const result = HtmlSanitizer.clean(html, ['p']);

        expect(result).not.toContain('script');
        expect(result).not.toContain('onclick');
        expect(result).not.toContain('bad1');
        expect(result).not.toContain('bad2');
        expect(result).not.toContain('bad3');
        expect(result).toContain('Safe');
      });
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
