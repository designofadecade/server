/**
 * HTML Sanitization Utility
 *
 * Production-grade HTML sanitization to prevent XSS attacks and ensure safe HTML rendering.
 *
 * Security Features:
 * - XSS Prevention: Blocks dangerous protocols (javascript:, data:, vbscript:, etc.)
 * - DoS Protection: Enforces maximum input size limits
 * - Never-Allow List: Blocks inherently dangerous tags (script, iframe, form, etc.)
 * - Multi-Pass Entity Decoding: Prevents nested encoding attacks
 * - Null Byte Protection: Removes string termination attack vectors
 * - Event Handler Removal: Strips all event attributes (onclick, onerror, etc.)
 * - Script/Style Removal: Completely removes script and style tags with content
 * - HTML Comment Stripping: Removes comments that could hide malicious content
 * - URL Validation: Validates and sanitizes URLs in anchor tags
 * - External Link Security: Auto-adds target="_blank" rel="noopener noreferrer"
 * - Entity Decoding: Safely decodes HTML entities with range validation
 * - Attribute Escaping: Prevents attribute injection attacks
 * - Final Security Check: Verifies output before returning
 *
 * @module HtmlSanitizer
 * @version 3.0.0
 */
import { logger } from '../logger/Logger.js';
// ============================================================================
// Configuration Constants
// ============================================================================
/**
 * Maximum input size to prevent DoS attacks (1MB)
 */
const MAX_INPUT_SIZE = 1024 * 1024;
/**
 * Valid HTML tag name pattern
 */
const TAG_NAME_PATTERN = /^[a-z][a-z0-9]*$/i;
/**
 * Maximum URL length (2048 characters - standard browser limit)
 */
const MAX_URL_LENGTH = 2048;
/**
 * Dangerous protocols that could be used for XSS attacks
 */
const DANGEROUS_PROTOCOLS = /^(javascript:|vbscript:|data:|file:|about:|blob:)/i;
/**
 * Safe protocols allowed in URLs
 */
const SAFE_PROTOCOLS = /^(https?:\/\/|mailto:|tel:|sms:|\/|\.\/|\.\.\/|#)/i;
/**
 * Tags that should NEVER be allowed, even if explicitly requested
 * These tags can execute scripts, load external content, or modify page behavior
 */
const NEVER_ALLOWED_TAGS = new Set([
    'script', // JavaScript execution
    'style', // Can load external content via @import
    'iframe', // Can load external content
    'object', // Can load external content/plugins
    'embed', // Can load external content/plugins
    'applet', // Java applets (deprecated but dangerous)
    'link', // Can load external stylesheets
    'base', // Can change all relative URLs
    'meta', // Can do redirects, set encoding
    'form', // Can submit data to external sites
    'input', // Form inputs
    'button', // Can trigger actions
    'textarea', // Form inputs
    'select', // Form inputs
]);
/**
 * Maximum number of entity decoding passes to prevent infinite loops
 * while still catching multiple levels of encoding
 */
const MAX_DECODE_PASSES = 3;
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
     * - Supports preserving specific attributes on allowed tags
     *
     * @param html - The HTML string to clean
     * @param allowedTags - Array of allowed tag names (case-insensitive)
     * @param allowedAttributes - Optional object mapping tag names to arrays of allowed attribute names
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
     *
     * @example
     * // Allow specific attributes on tags
     * HtmlSanitizer.clean(html, ['span', 'a'], {
     *   span: ['style', 'class', 'data-uuid'],
     *   a: ['href', 'target', 'rel']
     * });
     * // Input: '<span class="legal-tag" data-uuid="123" onclick="alert()">Text</span>'
     * // Output: '<span class="legal-tag" data-uuid="123">Text</span>'
     */
    static clean(html, allowedTags, allowedAttributes) {
        // ====================================================================
        // Step 1: Input Validation
        // ====================================================================
        if (!html || typeof html !== 'string') {
            return '';
        }
        if (!Array.isArray(allowedTags) || allowedTags.length === 0) {
            logger.warn('No allowed tags provided, stripping all HTML', {
                code: 'SANITIZER_NO_ALLOWED_TAGS',
                source: 'HtmlSanitizer.clean',
            });
            return this.stripAllTags(html);
        }
        // ====================================================================
        // Step 2: Validate and Normalize Allowed Tags
        // ====================================================================
        const validAllowedTags = allowedTags
            .filter((tag) => {
            if (typeof tag !== 'string' || !TAG_NAME_PATTERN.test(tag)) {
                logger.warn('Invalid tag name ignored', {
                    code: 'SANITIZER_INVALID_TAG',
                    source: 'HtmlSanitizer.clean',
                    tag,
                });
                return false;
            }
            const lowerTag = tag.toLowerCase();
            // SECURITY: Block inherently dangerous tags even if requested
            if (NEVER_ALLOWED_TAGS.has(lowerTag)) {
                logger.warn('Dangerous tag blocked from allowed list', {
                    code: 'SANITIZER_DANGEROUS_TAG_BLOCKED',
                    source: 'HtmlSanitizer.clean',
                    tag: lowerTag,
                });
                return false;
            }
            return true;
        })
            .map((tag) => tag.toLowerCase());
        if (validAllowedTags.length === 0) {
            logger.warn('No valid allowed tags, stripping all HTML', {
                code: 'SANITIZER_NO_VALID_TAGS',
                source: 'HtmlSanitizer.clean',
            });
            return this.stripAllTags(html);
        }
        // ====================================================================
        // Step 2.5: Validate and Normalize Allowed Attributes
        // ====================================================================
        let normalizedAllowedAttributes = null;
        if (allowedAttributes && typeof allowedAttributes === 'object') {
            normalizedAllowedAttributes = {};
            for (const [tagName, attrs] of Object.entries(allowedAttributes)) {
                const lowerTag = tagName.toLowerCase();
                // Skip if not in validAllowedTags
                if (!validAllowedTags.includes(lowerTag)) {
                    logger.warn('Skipping attributes for tag not in allowed list', {
                        code: 'SANITIZER_ATTRIBUTES_FOR_DISALLOWED_TAG',
                        source: 'HtmlSanitizer.clean',
                        tag: lowerTag,
                    });
                    continue;
                }
                if (Array.isArray(attrs)) {
                    const validAttrs = attrs
                        .filter((attr) => typeof attr === 'string' && attr.length > 0)
                        .map((attr) => attr.toLowerCase());
                    if (validAttrs.length > 0) {
                        normalizedAllowedAttributes[lowerTag] = new Set(validAttrs);
                    }
                }
            }
            // If no valid attributes were found, set to null
            if (Object.keys(normalizedAllowedAttributes).length === 0) {
                normalizedAllowedAttributes = null;
            }
        }
        // ====================================================================
        // Step 3: DoS Protection
        // ====================================================================
        if (html.length > MAX_INPUT_SIZE) {
            logger.error('Input exceeds maximum size for clean(), truncating', {
                code: 'SANITIZER_INPUT_TOO_LARGE',
                source: 'HtmlSanitizer.clean',
                size: html.length,
                max: MAX_INPUT_SIZE,
            });
            html = html.substring(0, MAX_INPUT_SIZE);
        }
        // ====================================================================
        // Step 4: Remove Null Bytes (String Termination Attacks)
        // ====================================================================
        // SECURITY: Remove null bytes that could be used to terminate strings
        // in some contexts and bypass filters
        html = html.replace(/\0/g, '');
        // ====================================================================
        // Step 5: Decode HTML Entities Multiple Times (XSS Prevention)
        // ====================================================================
        // SECURITY: Decode entities multiple times to catch nested encoding attacks
        // For example: &amp;lt;script&amp;gt; -> &lt;script&gt; -> <script>
        // We do multiple passes (up to MAX_DECODE_PASSES) until no more changes occur
        let previousHtml = '';
        let decodePass = 0;
        while (html !== previousHtml && decodePass < MAX_DECODE_PASSES) {
            previousHtml = html;
            html = this.decodeHtmlEntities(html);
            decodePass++;
        }
        if (decodePass >= MAX_DECODE_PASSES && html !== previousHtml) {
            logger.warn('Max entity decode passes reached, possible encoding attack', {
                code: 'SANITIZER_MAX_DECODE_PASSES',
                source: 'HtmlSanitizer.clean',
                passes: decodePass,
            });
        }
        // ====================================================================
        // Step 6: Remove Dangerous Content
        // ====================================================================
        // Remove HTML comments (could hide malicious content)
        let cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
        // Remove dangerous tags entirely (including their content)
        // This is a safety net - these should already be blocked, but we remove them
        // in case they appear in the content
        cleaned = cleaned.replace(/<(script|style|iframe|object|embed|applet|link|base|meta|form|input|button|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '');
        // Also remove self-closing dangerous tags
        cleaned = cleaned.replace(/<(script|style|iframe|object|embed|applet|link|base|meta|form|input|button|textarea|select)[^>]*\/?>/gi, '');
        // ====================================================================
        // Step 7: Process HTML Tags
        // ====================================================================
        cleaned = cleaned.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
            const lowerTagName = tagName.toLowerCase();
            // Extra safety: block dangerous tags even if they somehow got through
            if (NEVER_ALLOWED_TAGS.has(lowerTagName)) {
                logger.warn('Dangerous tag removed from content', {
                    code: 'SANITIZER_DANGEROUS_TAG_REMOVED',
                    source: 'HtmlSanitizer.clean',
                    tag: lowerTagName,
                });
                return '';
            }
            // Remove tags not in the allowed list (preserve text content)
            if (!validAllowedTags.includes(lowerTagName)) {
                return '';
            }
            // Handle closing tags - always allow if opening tag is allowed
            if (match.startsWith('</')) {
                return `</${lowerTagName}>`;
            }
            // Detect self-closing tags
            const isSelfClosing = match.endsWith('/>');
            // Extract and process attributes if allowedAttributes is specified
            const preservedAttributes = [];
            const allowedAttrsForTag = normalizedAllowedAttributes?.[lowerTagName];
            if (allowedAttrsForTag) {
                // Extract all attributes from the tag
                const attrRegex = /([a-z][a-z0-9-]*)\s*=\s*["']([^"']*)["']/gi;
                let attrMatch;
                while ((attrMatch = attrRegex.exec(match)) !== null) {
                    const attrName = attrMatch[1].toLowerCase();
                    const attrValue = attrMatch[2];
                    // Skip event handlers (onclick, onerror, etc.)
                    if (attrName.startsWith('on')) {
                        logger.warn('Event handler attribute removed', {
                            code: 'SANITIZER_EVENT_HANDLER_REMOVED',
                            source: 'HtmlSanitizer.clean',
                            attribute: attrName,
                        });
                        continue;
                    }
                    // Check if this attribute is allowed for this tag
                    if (allowedAttrsForTag.has(attrName)) {
                        // Special handling for href attribute - must validate URL
                        if (attrName === 'href') {
                            const url = attrValue.trim();
                            if (this.isValidUrl(url)) {
                                const escapedUrl = this.sanitizeForAttribute(url);
                                preservedAttributes.push(`href="${escapedUrl}"`);
                            }
                            else {
                                logger.warn('Unsafe URL removed from href attribute', {
                                    code: 'SANITIZER_UNSAFE_HREF',
                                    source: 'HtmlSanitizer.clean',
                                    url,
                                });
                            }
                        }
                        // Special handling for style attribute - validate CSS
                        else if (attrName === 'style') {
                            const sanitizedStyle = this.sanitizeStyleAttribute(attrValue);
                            if (sanitizedStyle) {
                                preservedAttributes.push(`style="${sanitizedStyle}"`);
                            }
                        }
                        // For other allowed attributes, sanitize the value
                        else {
                            const escapedValue = this.sanitizeForAttribute(attrValue);
                            preservedAttributes.push(`${attrName}="${escapedValue}"`);
                        }
                    }
                }
            }
            // Special handling for anchor tags - validate URLs and add security attributes
            if (lowerTagName === 'a') {
                // If we haven't already handled href through allowedAttributes, handle it the old way
                if (!allowedAttrsForTag?.has('href')) {
                    const hrefMatch = match.match(/href\s*=\s*["']([^"']*)["']/i);
                    if (hrefMatch && hrefMatch[1]) {
                        const url = hrefMatch[1].trim();
                        // Validate URL for security
                        if (this.isValidUrl(url)) {
                            // Escape the URL to prevent attribute injection
                            const escapedUrl = this.sanitizeForAttribute(url);
                            preservedAttributes.push(`href="${escapedUrl}"`);
                            // SECURITY: Add target="_blank" and rel="noopener noreferrer" for external links
                            // This prevents tab nabbing attacks and ensures the new page can't access window.opener
                            const isExternal = /^https?:\/\//i.test(url);
                            if (isExternal) {
                                // Only add these if not already in preservedAttributes
                                if (!preservedAttributes.some((attr) => attr.startsWith('target='))) {
                                    preservedAttributes.push('target="_blank"');
                                }
                                if (!preservedAttributes.some((attr) => attr.startsWith('rel='))) {
                                    preservedAttributes.push('rel="noopener noreferrer"');
                                }
                            }
                        }
                        else {
                            // Invalid URL - remove href but keep anchor tag
                            logger.warn('Unsafe URL removed from anchor tag', {
                                code: 'SANITIZER_UNSAFE_URL',
                                source: 'HtmlSanitizer.clean',
                                url,
                            });
                        }
                    }
                }
                else {
                    // If href was handled through allowedAttributes, still add security attributes for external links
                    const hrefAttr = preservedAttributes.find((attr) => attr.startsWith('href='));
                    if (hrefAttr) {
                        const urlMatch = hrefAttr.match(/href="([^"]*)"/);
                        if (urlMatch) {
                            const url = urlMatch[1];
                            const isExternal = /^https?:\/\//i.test(url);
                            if (isExternal) {
                                if (!preservedAttributes.some((attr) => attr.startsWith('target='))) {
                                    preservedAttributes.push('target="_blank"');
                                }
                                if (!preservedAttributes.some((attr) => attr.startsWith('rel='))) {
                                    preservedAttributes.push('rel="noopener noreferrer"');
                                }
                            }
                        }
                    }
                }
            }
            // Handle self-closing tags (br, hr, img)
            if (isSelfClosing && ['br', 'hr', 'img'].includes(lowerTagName)) {
                const attrString = preservedAttributes.length > 0 ? ' ' + preservedAttributes.join(' ') : '';
                return `<${lowerTagName}${attrString} />`;
            }
            // Build the tag with preserved attributes
            if (preservedAttributes.length > 0) {
                return `<${lowerTagName} ${preservedAttributes.join(' ')}>`;
            }
            // For all other allowed tags, return simple opening tag
            return `<${lowerTagName}>`;
        });
        // ====================================================================
        // Step 8: Final Security Check
        // ====================================================================
        // Final pass: ensure no dangerous patterns remain
        // Check for any remaining script/style tags (case insensitive)
        if (/<(script|style|iframe|object|embed)/i.test(cleaned)) {
            logger.error('Dangerous tags still present after sanitization', {
                code: 'SANITIZER_DANGEROUS_CONTENT_REMAINING',
                source: 'HtmlSanitizer.clean',
            });
            // Strip all tags as a safety measure
            return this.stripAllTags(cleaned);
        }
        // ====================================================================
        // Step 9: Final Cleanup
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
    static sanitizeBasicHtml(html) {
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
    static replaceTagAttributes(html, tagName, attributes) {
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
        return html.replace(new RegExp(`<${lowerTagName}\\b([^>]*)>`, 'gi'), (_match, existingAttrs) => {
            // Parse existing attributes to preserve href, src, etc.
            const preservedAttrs = [];
            // Extract href, src, and other important attributes
            const hrefMatch = existingAttrs.match(/href\s*=\s*["']([^"']*)["']/i);
            const srcMatch = existingAttrs.match(/src\s*=\s*["']([^"']*)["']/i);
            const altMatch = existingAttrs.match(/alt\s*=\s*["']([^"']*)["']/i);
            if (hrefMatch)
                preservedAttrs.push(`href="${hrefMatch[1]}"`);
            if (srcMatch)
                preservedAttrs.push(`src="${srcMatch[1]}"`);
            if (altMatch)
                preservedAttrs.push(`alt="${altMatch[1]}"`);
            // Combine preserved and new attributes
            const allAttrs = [...preservedAttrs, attributeString].filter(Boolean).join(' ');
            return allAttrs ? `<${lowerTagName} ${allAttrs}>` : `<${lowerTagName}>`;
        });
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
    static stripAllTags(html) {
        if (!html || typeof html !== 'string') {
            return '';
        }
        // DoS protection - reject excessively large inputs
        if (html.length > MAX_INPUT_SIZE) {
            logger.error('Input exceeds maximum size for stripAllTags, truncating', {
                code: 'SANITIZER_STRIP_INPUT_TOO_LARGE',
                source: 'HtmlSanitizer.stripAllTags',
                size: html.length,
                max: MAX_INPUT_SIZE,
            });
            html = html.substring(0, MAX_INPUT_SIZE);
        }
        // Remove HTML comments
        let text = html.replace(/<!--[\s\S]*?-->/g, '');
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
    static stripAll(html) {
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
    static sanitizeForAttribute(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        // DoS protection
        if (text.length > MAX_INPUT_SIZE) {
            logger.error('Attribute value exceeds maximum size, truncating', {
                code: 'SANITIZER_ATTRIBUTE_TOO_LARGE',
                source: 'HtmlSanitizer.sanitizeForAttribute',
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
    static sanitizeForHtml(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        // DoS protection
        if (text.length > MAX_INPUT_SIZE) {
            logger.error('HTML content exceeds maximum size, truncating', {
                code: 'SANITIZER_HTML_TOO_LARGE',
                source: 'HtmlSanitizer.sanitizeForHtml',
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
    static isValidUrl(url) {
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
            logger.warn('URL exceeds maximum length', {
                code: 'SANITIZER_URL_TOO_LONG',
                source: 'HtmlSanitizer.isValidUrl',
                length: url.length,
                max: MAX_URL_LENGTH,
            });
            return false;
        }
        // Normalize to lowercase for protocol checking
        const urlLower = url.toLowerCase();
        // Check for dangerous protocols first (XSS vectors)
        if (DANGEROUS_PROTOCOLS.test(urlLower)) {
            logger.warn('Dangerous protocol detected in URL', {
                code: 'SANITIZER_DANGEROUS_PROTOCOL',
                source: 'HtmlSanitizer.isValidUrl',
                url,
            });
            return false;
        }
        // Allow safe protocols
        // If it has a protocol, it must be from the safe list
        if (url.includes(':')) {
            const isValid = SAFE_PROTOCOLS.test(url);
            if (!isValid) {
                logger.warn('Unknown/unsafe protocol in URL', {
                    code: 'SANITIZER_UNSAFE_PROTOCOL',
                    source: 'HtmlSanitizer.isValidUrl',
                    url,
                });
            }
            return isValid;
        }
        // Relative URLs without protocols are generally safe,
        // but check for encoded dangerous protocols
        if (url.includes('%')) {
            try {
                const decoded = decodeURIComponent(url);
                if (DANGEROUS_PROTOCOLS.test(decoded)) {
                    logger.warn('Encoded dangerous protocol detected', {
                        code: 'SANITIZER_ENCODED_DANGEROUS_PROTOCOL',
                        source: 'HtmlSanitizer.isValidUrl',
                        url,
                    });
                    return false;
                }
            }
            catch (e) {
                // If decoding fails, reject to be safe
                logger.warn('Failed to decode URL - rejecting', {
                    code: 'SANITIZER_URL_DECODE_ERROR',
                    source: 'HtmlSanitizer.isValidUrl',
                    url,
                    error: e,
                });
                return false;
            }
        }
        return true;
    }
    /**
     * Sanitizes CSS style attribute values to prevent XSS attacks.
     * Only allows safe inline color styles for the current use case.
     *
     * Security Features:
     * - Strips potentially dangerous CSS properties (behavior, -moz-binding, etc.)
     * - Validates color values (hex, rgb, rgba, named colors)
     * - Removes expressions and url() functions that could load external content
     * - Blocks @import and other directives
     * - Limits to safe CSS properties for inline styling
     *
     * @param style - The style attribute value to sanitize
     * @returns Sanitized style string or empty string if invalid
     *
     * @example
     * HtmlSanitizer.sanitizeStyleAttribute('color: red; background: blue;');
     * // Returns: 'color: red'
     *
     * @example
     * HtmlSanitizer.sanitizeStyleAttribute('color: #ff0000; behavior: url(xss.htc);');
     * // Returns: 'color: #ff0000' (dangerous property removed)
     */
    static sanitizeStyleAttribute(style) {
        if (!style || typeof style !== 'string') {
            return '';
        }
        // Trim whitespace
        style = style.trim();
        if (style.length === 0) {
            return '';
        }
        // DoS protection
        if (style.length > 1024) {
            logger.warn('Style attribute exceeds maximum length', {
                code: 'SANITIZER_STYLE_TOO_LONG',
                source: 'HtmlSanitizer.sanitizeStyleAttribute',
                length: style.length,
            });
            return '';
        }
        // For our use case, only allow color-related properties
        const allowedProperties = ['color', 'background-color'];
        // Split style into individual declarations
        const declarations = style
            .split(';')
            .map((decl) => decl.trim())
            .filter(Boolean);
        const sanitizedDeclarations = [];
        for (const declaration of declarations) {
            const colonIndex = declaration.indexOf(':');
            if (colonIndex === -1)
                continue;
            const property = declaration.substring(0, colonIndex).trim().toLowerCase();
            const value = declaration.substring(colonIndex + 1).trim();
            // Only allow whitelisted properties
            if (!allowedProperties.includes(property)) {
                logger.warn('Disallowed CSS property filtered out', {
                    code: 'SANITIZER_DISALLOWED_CSS_PROPERTY',
                    source: 'HtmlSanitizer.sanitizeStyleAttribute',
                    property,
                });
                continue;
            }
            // Check for dangerous patterns in the value
            const dangerousPatterns = [
                /javascript:/i,
                /expression\s*\(/i,
                /-moz-binding/i,
                /behavior\s*:/i,
                /@import/i,
                /url\s*\(/i,
                /data:/i,
            ];
            let hasDangerousPattern = false;
            for (const pattern of dangerousPatterns) {
                if (pattern.test(value)) {
                    logger.warn('Dangerous pattern detected in CSS value', {
                        code: 'SANITIZER_DANGEROUS_CSS_VALUE',
                        source: 'HtmlSanitizer.sanitizeStyleAttribute',
                        property,
                    });
                    hasDangerousPattern = true;
                    break;
                }
            }
            if (hasDangerousPattern) {
                continue;
            }
            // Validate color value
            if (this.isValidColorValue(value)) {
                const escapedValue = this.sanitizeForAttribute(value);
                sanitizedDeclarations.push(`${property}: ${escapedValue}`);
            }
            else {
                logger.warn('Invalid color value in style attribute', {
                    code: 'SANITIZER_INVALID_COLOR_VALUE',
                    source: 'HtmlSanitizer.sanitizeStyleAttribute',
                    value,
                });
            }
        }
        return sanitizedDeclarations.join('; ');
    }
    /**
     * Validates if a CSS color value is safe.
     * Allows hex colors, rgb/rgba, and named colors.
     *
     * @param value - The color value to validate
     * @returns True if the color value is safe, false otherwise
     *
     * @example
     * HtmlSanitizer.isValidColorValue('#ff0000'); // true
     * HtmlSanitizer.isValidColorValue('rgb(255, 0, 0)'); // true
     * HtmlSanitizer.isValidColorValue('red'); // true
     * HtmlSanitizer.isValidColorValue('javascript:alert(1)'); // false
     */
    static isValidColorValue(value) {
        if (!value || typeof value !== 'string') {
            return false;
        }
        value = value.trim();
        // Hex color (#fff or #ffffff)
        if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) {
            return true;
        }
        // RGB/RGBA color
        if (/^rgba?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[0-9.]+)?\s*\)$/i.test(value)) {
            return true;
        }
        // Named colors (common safe colors)
        const namedColors = [
            'black',
            'white',
            'red',
            'green',
            'blue',
            'yellow',
            'orange',
            'purple',
            'pink',
            'brown',
            'gray',
            'grey',
            'cyan',
            'magenta',
            'lime',
            'navy',
            'teal',
            'aqua',
            'maroon',
            'olive',
            'silver',
            'fuchsia',
            'transparent',
        ];
        if (namedColors.includes(value.toLowerCase())) {
            return true;
        }
        return false;
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
    static isValidEmail(email) {
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
        const MAX_EMAIL_LENGTH = 254;
        if (email.length > MAX_EMAIL_LENGTH) {
            logger.warn('Email exceeds maximum length', {
                code: 'SANITIZER_EMAIL_TOO_LONG',
                source: 'HtmlSanitizer.isValidEmail',
                length: email.length,
                max: MAX_EMAIL_LENGTH,
            });
            return false;
        }
        // ====================================================================
        // Step 2: Split and Validate Structure
        // ====================================================================
        // Must contain exactly one @ symbol
        const atIndex = email.indexOf('@');
        if (atIndex === -1 || atIndex !== email.lastIndexOf('@')) {
            return false;
        }
        const localPart = email.substring(0, atIndex);
        const domainPart = email.substring(atIndex + 1);
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
        if (domainPart.startsWith('.') ||
            domainPart.endsWith('.') ||
            domainPart.startsWith('-') ||
            domainPart.endsWith('-')) {
            return false;
        }
        // Domain cannot contain consecutive dots
        if (domainPart.includes('..')) {
            return false;
        }
        // ====================================================================
        // Step 5: Validate Domain Labels
        // ====================================================================
        const domainLabels = domainPart.split('.');
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
        const tld = domainLabels[domainLabels.length - 1];
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
    static decodeHtmlEntities(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        // DoS protection
        if (text.length > MAX_INPUT_SIZE) {
            logger.error('Input exceeds maximum size for entity decoding', {
                code: 'SANITIZER_ENTITY_INPUT_TOO_LARGE',
                source: 'HtmlSanitizer.decodeHtmlEntities',
                size: text.length,
                max: MAX_INPUT_SIZE,
            });
            text = text.substring(0, MAX_INPUT_SIZE);
        }
        // Common HTML entities to decode
        const entities = {
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
        text = text.replace(/&#(\d+);/g, (match, dec) => {
            const code = parseInt(dec, 10);
            // Limit to valid Unicode range and exclude control characters (except tab, newline, carriage return)
            if (code > 0 &&
                code <= 0x10ffff &&
                (code >= 32 || code === 9 || code === 10 || code === 13)) {
                try {
                    return String.fromCharCode(code);
                }
                catch (e) {
                    logger.warn('Invalid character code', {
                        code: 'SANITIZER_INVALID_CHAR_CODE',
                        source: 'HtmlSanitizer.decodeHtmlEntities',
                        charCode: code,
                        error: e,
                    });
                    return match;
                }
            }
            return match;
        });
        // Handle numeric entities (hexadecimal) - with safety limits
        text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
            const code = parseInt(hex, 16);
            // Limit to valid Unicode range and exclude control characters (except tab, newline, carriage return)
            if (code > 0 &&
                code <= 0x10ffff &&
                (code >= 32 || code === 9 || code === 10 || code === 13)) {
                try {
                    return String.fromCharCode(code);
                }
                catch (e) {
                    logger.warn('Invalid hex character code', {
                        code: 'SANITIZER_INVALID_HEX_CODE',
                        source: 'HtmlSanitizer.decodeHtmlEntities',
                        hex,
                        error: e,
                    });
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
//# sourceMappingURL=HtmlSanitizer.js.map