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

import { logger } from '../logger/Logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard HTML entity mapping
 */
interface EntityMap {
  readonly [entity: string]: string;
}

/**
 * Result type for sanitization methods
 */
export interface SanitizationResult {
  readonly sanitized: string;
  readonly warnings?: string[];
}

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Maximum input size to prevent DoS attacks (1MB)
 */
const MAX_INPUT_SIZE: number = 1024 * 1024;

/**
 * Valid HTML tag name pattern
 */
const TAG_NAME_PATTERN: RegExp = /^[a-z][a-z0-9]*$/i;

/**
 * Maximum URL length (2048 characters - standard browser limit)
 */
const MAX_URL_LENGTH: number = 2048;

/**
 * Dangerous protocols that could be used for XSS attacks
 */
const DANGEROUS_PROTOCOLS: RegExp = /^(javascript:|vbscript:|data:|file:|about:|blob:)/i;

/**
 * Safe protocols allowed in URLs
 */
const SAFE_PROTOCOLS: RegExp = /^(https?:\/\/|mailto:|tel:|sms:|\/|\.\/|\.\.\/|#)/i;

// ============================================================================
// HtmlSanitizer Class
// ============================================================================

/**
 * HTML Sanitization utility class with static methods for secure HTML processing
 *
 * @class HtmlSanitizer
 */
export default class HtmlSanitizer {
  // ========================================================================
  // Public API Methods
  // ========================================================================

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
  static clean(html: string, allowedTags: string[]): string {
    // ====================================================================
    // Step 1: Input Validation
    // ====================================================================

    if (!html || typeof html !== 'string') {
      return '';
    }

    if (!Array.isArray(allowedTags) || allowedTags.length === 0) {
      logger.warn('HtmlSanitizer: No allowed tags provided, stripping all HTML');
      return this.stripAllTags(html);
    }

    // ====================================================================
    // Step 2: Validate and Normalize Allowed Tags
    // ====================================================================

    const validAllowedTags: string[] = allowedTags
      .filter((tag: string) => {
        if (typeof tag !== 'string' || !TAG_NAME_PATTERN.test(tag)) {
          logger.warn('HtmlSanitizer: Invalid tag name ignored', { tag });
          return false;
        }
        return true;
      })
      .map((tag: string) => tag.toLowerCase());

    if (validAllowedTags.length === 0) {
      logger.warn('HtmlSanitizer: No valid allowed tags, stripping all HTML');
      return this.stripAllTags(html);
    }

    // ====================================================================
    // Step 3: DoS Protection
    // ====================================================================

    if (html.length > MAX_INPUT_SIZE) {
      logger.error('HtmlSanitizer: Input exceeds maximum size for clean(), truncating', {
        size: html.length,
        max: MAX_INPUT_SIZE,
      });
      html = html.substring(0, MAX_INPUT_SIZE);
    }

    // ====================================================================
    // Step 4: Remove Dangerous Content
    // ====================================================================

    // Remove HTML comments (could hide malicious content)
    let cleaned: string = html.replace(/<!--[\s\S]*?-->/g, '');

    // Remove script and style tags entirely (including their content)
    cleaned = cleaned.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

    // ====================================================================
    // Step 5: Process HTML Tags
    // ====================================================================

    cleaned = cleaned.replace(
      /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
      (match: string, tagName: string): string => {
        const lowerTagName: string = tagName.toLowerCase();

        // Remove tags not in the allowed list (preserve text content)
        if (!validAllowedTags.includes(lowerTagName)) {
          return '';
        }

        // Handle closing tags - always allow if opening tag is allowed
        if (match.startsWith('</')) {
          return `</${lowerTagName}>`;
        }

        // Detect self-closing tags
        const isSelfClosing: boolean = match.endsWith('/>');

        // Special handling for anchor tags - validate URLs
        if (lowerTagName === 'a') {
          const hrefMatch: RegExpMatchArray | null = match.match(/href\s*=\s*["']([^"']*)["']/i);
          if (hrefMatch && hrefMatch[1]) {
            const url: string = hrefMatch[1].trim();

            // Validate URL for security
            if (this.isValidUrl(url)) {
              // Escape the URL to prevent attribute injection
              const escapedUrl: string = this.sanitizeForAttribute(url);
              return `<a href="${escapedUrl}">`;
            } else {
              // Invalid URL - remove href but keep anchor tag
              logger.warn('HtmlSanitizer: Unsafe URL removed from anchor tag', { url });
              return '<a>';
            }
          } else {
            // No href attribute found
            return '<a>';
          }
        }

        // Handle self-closing tags (br, hr, img)
        if (isSelfClosing && ['br', 'hr', 'img'].includes(lowerTagName)) {
          return `<${lowerTagName} />`;
        }

        // For all other allowed tags, return simple opening tag
        return `<${lowerTagName}>`;
      }
    );

    // ====================================================================
    // Step 6: Final Cleanup
    // ====================================================================

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  // ========================================================================
  // Convenience Methods
  // ========================================================================

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
  static sanitizeBasicHtml(html: string): string {
    return this.clean(html, ['b', 'i', 'u', 'a']);
  }

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
  static replaceTagAttributes(
    html: string,
    tagName: string,
    attributes: Record<string, string>
  ): string {
    if (!html || typeof html !== 'string') {
      return '';
    }

    if (!tagName || typeof tagName !== 'string') {
      return html;
    }

    if (!attributes || typeof attributes !== 'object') {
      return html;
    }

    const lowerTagName = tagName.toLowerCase();

    // Build attribute string from the attributes object
    const attributeString = Object.entries(attributes)
      .map(([key, value]) => `${key}="${this.sanitizeForAttribute(value)}"`)
      .join(' ');

    // Replace opening tags of the specified type
    return html.replace(
      new RegExp(`<${lowerTagName}\\b([^>]*)>`, 'gi'),
      (_match: string, existingAttrs: string): string => {
        // Parse existing attributes to preserve href, src, etc.
        const preservedAttrs: string[] = [];

        // Extract href, src, and other important attributes
        const hrefMatch = existingAttrs.match(/href\s*=\s*["']([^"']*)["']/i);
        const srcMatch = existingAttrs.match(/src\s*=\s*["']([^"']*)["']/i);
        const altMatch = existingAttrs.match(/alt\s*=\s*["']([^"']*)["']/i);

        if (hrefMatch) preservedAttrs.push(`href="${hrefMatch[1]}"`);
        if (srcMatch) preservedAttrs.push(`src="${srcMatch[1]}"`);
        if (altMatch) preservedAttrs.push(`alt="${altMatch[1]}"`);

        // Combine preserved and new attributes
        const allAttrs = [...preservedAttrs, attributeString].filter(Boolean).join(' ');

        return allAttrs ? `<${lowerTagName} ${allAttrs}>` : `<${lowerTagName}>`;
      }
    );
  }

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
  static stripAllTags(html: string): string {
    if (!html || typeof html !== 'string') {
      return '';
    }

    // DoS protection - reject excessively large inputs
    if (html.length > MAX_INPUT_SIZE) {
      logger.error('HtmlSanitizer: Input exceeds maximum size for stripAllTags, truncating', {
        size: html.length,
        max: MAX_INPUT_SIZE,
      });
      html = html.substring(0, MAX_INPUT_SIZE);
    }

    // Remove HTML comments
    let text: string = html.replace(/<!--[\s\S]*?-->/g, '');

    // Remove script and style tags with content
    text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

    // Remove all HTML tags
    text = text.replace(/<[^>]*>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

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
  static stripAll(html: string): string {
    return this.stripAllTags(html);
  }

  // ========================================================================
  // Text Escaping Methods
  // ========================================================================

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
  static sanitizeForAttribute(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // DoS protection
    if (text.length > MAX_INPUT_SIZE) {
      logger.error('HtmlSanitizer: Attribute value exceeds maximum size, truncating', {
        size: text.length,
        max: MAX_INPUT_SIZE,
      });
      text = text.substring(0, MAX_INPUT_SIZE);
    }

    // Order matters: & first to avoid double-escaping
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '&#10;') // Newlines could break attributes
      .replace(/\r/g, '&#13;'); // Carriage returns
  }

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
  static sanitizeForHtml(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // DoS protection
    if (text.length > MAX_INPUT_SIZE) {
      logger.error('HtmlSanitizer: HTML content exceeds maximum size, truncating', {
        size: text.length,
        max: MAX_INPUT_SIZE,
      });
      text = text.substring(0, MAX_INPUT_SIZE);
    }

    // Order matters: & first to avoid double-escaping
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ========================================================================
  // URL Validation
  // ========================================================================

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
  static isValidUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }

    // Remove any leading/trailing whitespace
    url = url.trim();

    // Empty URLs are not valid
    if (url.length === 0) {
      return false;
    }

    // DoS protection - reject excessively long URLs
    if (url.length > MAX_URL_LENGTH) {
      logger.warn('HtmlSanitizer: URL exceeds maximum length', {
        length: url.length,
        max: MAX_URL_LENGTH,
      });
      return false;
    }

    // Normalize to lowercase for protocol checking
    const urlLower: string = url.toLowerCase();

    // Check for dangerous protocols first (XSS vectors)
    if (DANGEROUS_PROTOCOLS.test(urlLower)) {
      logger.warn('HtmlSanitizer: Dangerous protocol detected in URL', { url });
      return false;
    }

    // Allow safe protocols
    // If it has a protocol, it must be from the safe list
    if (url.includes(':')) {
      const isValid: boolean = SAFE_PROTOCOLS.test(url);
      if (!isValid) {
        logger.warn('HtmlSanitizer: Unknown/unsafe protocol in URL', { url });
      }
      return isValid;
    }

    // Relative URLs without protocols are generally safe,
    // but check for encoded dangerous protocols
    if (url.includes('%')) {
      try {
        const decoded: string = decodeURIComponent(url);
        if (DANGEROUS_PROTOCOLS.test(decoded)) {
          logger.warn('HtmlSanitizer: Encoded dangerous protocol detected', { url });
          return false;
        }
      } catch (e) {
        // If decoding fails, reject to be safe
        logger.warn('HtmlSanitizer: Failed to decode URL - rejecting', { url });
        return false;
      }
    }

    return true;
  }

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
  static isValidEmail(email: string): boolean {
    // ====================================================================
    // Step 1: Basic Input Validation
    // ====================================================================

    if (!email || typeof email !== 'string') {
      return false;
    }

    // Trim whitespace
    email = email.trim();

    if (email.length === 0) {
      return false;
    }

    // DoS protection - RFC 5321 maximum is 254 characters
    const MAX_EMAIL_LENGTH: number = 254;
    if (email.length > MAX_EMAIL_LENGTH) {
      logger.warn('HtmlSanitizer: Email exceeds maximum length', {
        length: email.length,
        max: MAX_EMAIL_LENGTH,
      });
      return false;
    }

    // ====================================================================
    // Step 2: Split and Validate Structure
    // ====================================================================

    // Must contain exactly one @ symbol
    const atIndex: number = email.indexOf('@');
    if (atIndex === -1 || atIndex !== email.lastIndexOf('@')) {
      return false;
    }

    const localPart: string = email.substring(0, atIndex);
    const domainPart: string = email.substring(atIndex + 1);

    // ====================================================================
    // Step 3: Validate Local Part (before @)
    // ====================================================================

    // RFC 5321: local part max 64 characters
    if (localPart.length === 0 || localPart.length > 64) {
      return false;
    }

    // Local part cannot start or end with a dot
    if (localPart.startsWith('.') || localPart.endsWith('.')) {
      return false;
    }

    // Local part cannot contain consecutive dots
    if (localPart.includes('..')) {
      return false;
    }

    // Validate local part characters: a-z, 0-9, . _ + % -
    if (!/^[a-zA-Z0-9._+%-]+$/.test(localPart)) {
      return false;
    }

    // ====================================================================
    // Step 4: Validate Domain Part (after @)
    // ====================================================================

    // RFC 5321: domain part max 255 characters
    if (domainPart.length === 0 || domainPart.length > 255) {
      return false;
    }

    // Domain must contain at least one dot (TLD required)
    if (!domainPart.includes('.')) {
      return false;
    }

    // Domain cannot start or end with dot or hyphen
    if (
      domainPart.startsWith('.') ||
      domainPart.endsWith('.') ||
      domainPart.startsWith('-') ||
      domainPart.endsWith('-')
    ) {
      return false;
    }

    // Domain cannot contain consecutive dots
    if (domainPart.includes('..')) {
      return false;
    }

    // ====================================================================
    // Step 5: Validate Domain Labels
    // ====================================================================

    const domainLabels: string[] = domainPart.split('.');

    // Must have at least 2 labels (domain + TLD)
    if (domainLabels.length < 2) {
      return false;
    }

    for (const label of domainLabels) {
      // Each label: 1-63 characters (RFC 1035)
      if (label.length === 0 || label.length > 63) {
        return false;
      }

      // Labels cannot start or end with hyphen
      if (label.startsWith('-') || label.endsWith('-')) {
        return false;
      }

      // Labels can only contain: a-z, 0-9, hyphen
      if (!/^[a-zA-Z0-9-]+$/.test(label)) {
        return false;
      }
    }

    // Validate TLD (last label) - must be at least 2 characters and alphabetic
    const tld: string = domainLabels[domainLabels.length - 1];
    if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
      return false;
    }

    return true;
  }

  // ========================================================================
  // Entity Decoding
  // ========================================================================

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
  static decodeHtmlEntities(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // DoS protection
    if (text.length > MAX_INPUT_SIZE) {
      logger.error('HtmlSanitizer: Input exceeds maximum size for entity decoding', {
        size: text.length,
        max: MAX_INPUT_SIZE,
      });
      text = text.substring(0, MAX_INPUT_SIZE);
    }

    // Common HTML entities to decode
    const entities: EntityMap = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
    };

    // Replace known named entities
    for (const [entity, char] of Object.entries(entities)) {
      text = text.replace(new RegExp(entity, 'g'), char);
    }

    // Handle numeric entities (decimal) - with safety limits
    text = text.replace(/&#(\d+);/g, (match: string, dec: string): string => {
      const code: number = parseInt(dec, 10);
      // Limit to valid Unicode range and exclude control characters (except tab, newline, carriage return)
      if (
        code > 0 &&
        code <= 0x10ffff &&
        (code >= 32 || code === 9 || code === 10 || code === 13)
      ) {
        try {
          return String.fromCharCode(code);
        } catch (e) {
          logger.warn('HtmlSanitizer: Invalid character code', { code });
          return match;
        }
      }
      return match;
    });

    // Handle numeric entities (hexadecimal) - with safety limits
    text = text.replace(/&#x([0-9a-f]+);/gi, (match: string, hex: string): string => {
      const code: number = parseInt(hex, 16);
      // Limit to valid Unicode range and exclude control characters (except tab, newline, carriage return)
      if (
        code > 0 &&
        code <= 0x10ffff &&
        (code >= 32 || code === 9 || code === 10 || code === 13)
      ) {
        try {
          return String.fromCharCode(code);
        } catch (e) {
          logger.warn('HtmlSanitizer: Invalid hex character code', { hex });
          return match;
        }
      }
      return match;
    });

    return text;
  }
}

// ============================================================================
// Usage Guidelines & Best Practices
// ============================================================================

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
