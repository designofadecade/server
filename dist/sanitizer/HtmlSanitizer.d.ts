/**
 * HTML Sanitization Utility
 *
 * Production-grade HTML sanitization to prevent XSS attacks and ensure safe HTML rendering.
 *
 * Security Features:
 * - XSS Prevention: Blocks dangerous protocols (javascript:, data:, vbscript:, etc.)
 * - DoS Protection: Enforces maximum input size limits
 * - Script/Style Removal: Completely removes script and style tags with content
 * - HTML Comment Stripping: Removes comments that could hide malicious content
 * - URL Validation: Validates and sanitizes URLs in anchor tags
 * - Entity Decoding: Safely decodes HTML entities with range validation
 * - Attribute Escaping: Prevents attribute injection attacks
 *
 * @module HtmlSanitizer
 * @version 2.0.0
 */
/**
 * Result type for sanitization methods
 */
export interface SanitizationResult {
    readonly sanitized: string;
    readonly warnings?: string[];
}
/**
 * HTML Sanitization utility class with static methods for secure HTML processing
 *
 * @class HtmlSanitizer
 */
export default class HtmlSanitizer {
    /**
     * Cleans HTML by allowing only specified tags and removing all others.
     *
     * Features:
     * - Strips disallowed tags while preserving text content
     * - Validates and sanitizes URLs in anchor tags
     * - Removes HTML comments, script, and style tags
     * - Enforces DoS protection with size limits
     * - Validates allowed tags is a valid array
     *
     * @param html - The HTML string to clean
     * @param allowedTags - Array of allowed tag names (case-insensitive)
     * @returns Sanitized HTML string with only allowed tags
     *
     * @example
     * // Allow only paragraph and bold tags
     * HtmlSanitizer.clean('<p>Hello <b>World</b></p><script>alert("xss")</script>', ['p', 'b']);
     * // Returns: '<p>Hello <b>World</b></p>'
     *
     * @example
     * // Sanitize anchor tags with URL validation
     * HtmlSanitizer.clean('<a href="https://example.com">Safe</a><a href="javascript:alert(1)">Unsafe</a>', ['a']);
     * // Returns: '<a href="https://example.com">Safe</a><a>Unsafe</a>'
     *
     * @example
     * // Allow common formatting tags
     * HtmlSanitizer.clean(userInput, ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li']);
     */
    static clean(html: string, allowedTags: string[]): string;
    /**
     * Sanitizes basic HTML content by allowing only b, i, u, and a tags.
     * Common use case for simple user-generated content.
     *
     * @param html - The HTML string to sanitize
     * @returns Sanitized HTML string with basic formatting
     *
     * @example
     * HtmlSanitizer.sanitizeBasicHtml('<b>Bold</b> and <i>italic</i> text');
     * // Returns: '<b>Bold</b> and <i>italic</i> text'
     */
    static sanitizeBasicHtml(html: string): string;
    /**
     * Replaces or adds attributes to specific HTML tags.
     * Useful for adding email-specific attributes like target="_blank" to links.
     *
     * @param html - The HTML string to process
     * @param tagName - The tag name to target (e.g., 'a')
     * @param attributes - Object with attribute key-value pairs to add/replace
     * @returns HTML with updated tag attributes
     *
     * @example
     * HtmlSanitizer.replaceTagAttributes('<a href="/link">Click</a>', 'a', {
     *   target: '_blank',
     *   style: 'color: blue;'
     * });
     * // Returns: '<a href="/link" target="_blank" style="color: blue;">Click</a>'
     */
    static replaceTagAttributes(html: string, tagName: string, attributes: Record<string, string>): string;
    /**
     * Strips all HTML tags from content, leaving only plain text.
     * Removes comments, scripts, styles, and decodes HTML entities.
     *
     * @param html - The HTML string to strip
     * @returns Plain text without any HTML tags
     *
     * @example
     * HtmlSanitizer.stripAllTags('<p>Hello <b>World</b></p>');
     * // Returns: 'Hello World'
     *
     * @example
     * HtmlSanitizer.stripAllTags('<script>alert(1)</script>Safe text');
     * // Returns: 'Safe text'
     */
    static stripAllTags(html: string): string;
    /**
     * Alias for stripAllTags() - strips all HTML tags from content.
     * Provided for convenience and backwards compatibility.
     *
     * @param html - The HTML string to strip
     * @returns Plain text without HTML tags
     * @see stripAllTags
     *
     * @example
     * HtmlSanitizer.stripAll('<div>Content</div>');
     * // Returns: 'Content'
     */
    static stripAll(html: string): string;
    /**
     * Sanitizes text for safe use in HTML attributes.
     * Escapes characters that could break out of attribute context or inject code.
     *
     * Escapes: &, ", ', <, >, newlines, carriage returns
     *
     * @param text - The text to sanitize
     * @returns HTML-safe text for use in attributes
     *
     * @example
     * HtmlSanitizer.sanitizeForAttribute('value with "quotes"');
     * // Returns: 'value with &quot;quotes&quot;'
     *
     * @example
     * const value = HtmlSanitizer.sanitizeForAttribute(userInput);
     * // Safe in: <div data-value="${value}">...</div>
     */
    static sanitizeForAttribute(text: string): string;
    /**
     * Sanitizes text for safe display in HTML content.
     * Escapes HTML special characters to prevent XSS attacks.
     *
     * Escapes: &, <, >, ", '
     *
     * @param text - The text to sanitize
     * @returns HTML-safe text that can be inserted into HTML content
     *
     * @example
     * HtmlSanitizer.sanitizeForHtml('<script>alert("xss")</script>');
     * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
     *
     * @example
     * const safeText = HtmlSanitizer.sanitizeForHtml(userInput);
     * // Safe in: <p>${safeText}</p>
     */
    static sanitizeForHtml(text: string): string;
    /**
     * Validates if a URL is safe for use in links.
     * Blocks dangerous protocols and validates against common XSS vectors.
     *
     * Blocked protocols: javascript:, vbscript:, data:, file:, about:, blob:
     * Allowed protocols: https://, http://, mailto:, tel:, sms:, relative paths
     *
     * @param url - The URL to validate
     * @returns True if the URL is considered safe, false otherwise
     *
     * @example
     * HtmlSanitizer.isValidUrl('https://example.com');
     * // Returns: true
     *
     * @example
     * HtmlSanitizer.isValidUrl('javascript:alert(1)');
     * // Returns: false
     *
     * @example
     * HtmlSanitizer.isValidUrl('/relative/path');
     * // Returns: true
     */
    static isValidUrl(url: string): boolean;
    /**
     * Validates if an email address is properly formatted.
     * Performs comprehensive email validation following RFC 5321/5322 standards.
     *
     * Validation Rules:
     * - Maximum length: 254 characters (RFC 5321)
     * - Local part (before @): 1-64 characters, allows a-z, 0-9, . _ + % -
     * - Local part cannot start/end with dot or contain consecutive dots
     * - Domain part (after @): 1-255 characters, requires valid TLD
     * - Domain labels: 1-63 characters each, allows a-z, 0-9, hyphen (not at start/end)
     * - Must contain exactly one @ symbol
     * - Case-insensitive validation
     *
     * Security Features:
     * - DoS protection with length limits
     * - Rejects malformed patterns that could be used for injection
     * - Validates against common email spoofing patterns
     *
     * Note: This performs format validation only. For production use, consider:
     * - DNS MX record verification
     * - Email verification (send confirmation email)
     * - Third-party email validation services
     * - Disposable email detection
     *
     * @param email - The email address to validate
     * @returns True if email format is valid, false otherwise
     *
     * @example
     * HtmlSanitizer.isValidEmail('user@example.com');
     * // Returns: true
     *
     * @example
     * HtmlSanitizer.isValidEmail('user+tag@subdomain.example.co.uk');
     * // Returns: true
     *
     * @example
     * HtmlSanitizer.isValidEmail('invalid.email');
     * // Returns: false
     *
     * @example
     * HtmlSanitizer.isValidEmail('user..name@example.com');
     * // Returns: false (consecutive dots)
     */
    static isValidEmail(email: string): boolean;
    /**
     * Decodes common HTML entities to their character equivalents.
     * Safely handles both named entities and numeric character references.
     *
     * Features:
     * - Decodes common named entities (&amp;, &lt;, &nbsp;, etc.)
     * - Decodes numeric entities (&#65; and &#x41; both -> 'A')
     * - Validates character codes are in valid Unicode range
     * - Excludes control characters (except tab, newline, CR)
     *
     * @param text - Text containing HTML entities
     * @returns Text with entities decoded to characters
     *
     * @example
     * HtmlSanitizer.decodeHtmlEntities('&lt;p&gt;Hello &amp; goodbye&lt;/p&gt;');
     * // Returns: '<p>Hello & goodbye</p>'
     *
     * @example
     * HtmlSanitizer.decodeHtmlEntities('&#65;&#66;&#67;'); // ABC
     * HtmlSanitizer.decodeHtmlEntities('&#x41;&#x42;&#x43;'); // ABC
     */
    static decodeHtmlEntities(text: string): string;
}
/**
 * USAGE GUIDELINES
 *
 * 1. USER-GENERATED CONTENT
 *    Always sanitize user input before storing or displaying:
 *    ```typescript
 *    // For rich text with limited formatting
 *    const sanitized = HtmlSanitizer.clean(userInput, ['p', 'br', 'strong', 'em', 'a']);
 *
 *    // For plain text display
 *    const plainText = HtmlSanitizer.stripAll(userInput);
 *    ```
 *
 * 2. ATTRIBUTE VALUES
 *    Always escape text used in HTML attributes:
 *    ```typescript
 *    const safe = HtmlSanitizer.sanitizeForAttribute(userInput);
 *    html = `<div data-value="${safe}">...</div>`;
 *    ```
 *
 * 3. HTML CONTENT
 *    Escape text to be displayed as-is in HTML:
 *    ```typescript
 *    const safe = HtmlSanitizer.sanitizeForHtml(userInput);
 *    html = `<p>${safe}</p>`;
 *    ```
 *
 * 4. ALLOWED TAGS
 *    Choose the minimum set of tags needed:
 *    - Basic formatting: ['b', 'i', 'u', 'br']
 *    - Rich text: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li']
 *    - Extended: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3']
 *
 * 5. URL VALIDATION
 *    URLs are automatically validated in anchor tags:
 *    - Allowed: https://, http://, mailto:, tel:, sms:, relative paths
 *    - Blocked: javascript:, data:, vbscript:, file:, blob:, about:
 *
 * 6. PERFORMANCE
 *    - Input size limited to 1MB (DoS protection)
 *    - Use stripAll() for better performance when HTML not needed
 *    - Cache sanitized content when possible
 *
 * SECURITY NOTES
 *
 * - XSS Prevention: All dangerous protocols and scripts are blocked
 * - DoS Protection: Input size limits prevent resource exhaustion
 * - Context-Aware: Different methods for different contexts (attributes vs content)
 * - Defense in Depth: Multiple layers of validation and sanitization
 * - Logging: Security events are logged to console for monitoring
 *
 * LIMITATIONS
 *
 * - Does not validate HTML structure (unclosed tags, nesting rules)
 * - Does not support CSS sanitization
 * - Does not support SVG sanitization
 * - Maximum input size: 1MB
 * - Maximum URL length: 2048 characters
 *
 * @see https://owasp.org/www-community/attacks/xss/
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
 */
//# sourceMappingURL=HtmlSanitizer.d.ts.map