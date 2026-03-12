# HtmlSanitizer

Production-grade HTML sanitization for XSS prevention and safe HTML rendering.

## Overview

`HtmlSanitizer` provides comprehensive HTML sanitization to protect against XSS attacks, injection vulnerabilities, and malicious content. It includes URL validation, entity decoding, and DoS protection.

## Installation

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';
```

## Quick Start

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

// Basic sanitization
const userInput = '<p>Hello <script>alert("xss")</script></p>';
const safe = HtmlSanitizer.clean(userInput, ['p', 'b', 'i']);
// Returns: '<p>Hello </p>'

// Allow common formatting tags
const html = userInput;
const cleaned = HtmlSanitizer.clean(html, [
  'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'
]);
```

## API Reference

### clean()

Sanitizes HTML by allowing only specified tags and optionally preserving specific attributes.

```typescript
static clean(
  html: string, 
  allowedTags: string[],
  allowedAttributes?: Record<string, string[]>
): string
```

**Parameters:**
- `html` (string) - HTML string to sanitize
- `allowedTags` (string[]) - Array of allowed tag names (case-insensitive)
- `allowedAttributes` (optional) - Object mapping tag names to arrays of allowed attribute names

**Returns:** Sanitized HTML string

**Features:**
- Removes disallowed tags while preserving text content
- Validates and sanitizes URLs in anchor tags
- Removes HTML comments
- Strips script and style tags completely
- DoS protection (max 1MB input)
- Decodes HTML entities safely
- Optionally preserves specific attributes on allowed tags
- Blocks event handlers even if specified in allowedAttributes
- Validates CSS style attributes for safe color properties only

**Example:**
```typescript
// Basic usage
const safe = HtmlSanitizer.clean(
  '<p>Hello <b>World</b></p><script>alert("xss")</script>',
  ['p', 'b']
);
// Result: '<p>Hello <b>World</b></p>'

// With anchor tags
const html = '<a href="https://example.com">Safe</a><a href="javascript:alert(1)">Unsafe</a>';
const clean = HtmlSanitizer.clean(html, ['a']);
// Result: '<a href="https://example.com">Safe</a><a>Unsafe</a>'

// Preserve specific attributes
const htmlWithAttrs = '<span class="legal-tag" data-uuid="123" onclick="alert()">Text</span>';
const result = HtmlSanitizer.clean(htmlWithAttrs, ['span'], {
  span: ['class', 'data-uuid']
});
// Result: '<span class="legal-tag" data-uuid="123">Text</span>'
// (onclick removed, safe attributes preserved)

// Preserve style attributes (safe CSS only)
const styledHtml = '<span style="color: #ff0000; behavior: url(xss.htc);">Red</span>';
const styled = HtmlSanitizer.clean(styledHtml, ['span'], {
  span: ['style']
});
// Result: '<span style="color: #ff0000">Red</span>'
// (dangerous 'behavior' property removed)
```

### stripAllTags()

Removes all HTML tags and returns plain text.

```typescript
static stripAllTags(html: string): string
```

**Parameters:**
- `html` (string) - HTML string to process

**Returns:** Plain text with all HTML removed

**Features:**
- DoS protection (max 1MB input)
- Preserves text content
- Removes comments and scripts
- Decodes HTML entities

**Example:**
```typescript
const text = HtmlSanitizer.stripAllTags(
  '<p>Hello <b>World</b></p><!-- comment -->'
);
// Result: 'Hello World'
```

### sanitizeForAttribute()

Escapes HTML for safe use in attribute values.

```typescript
static sanitizeForAttribute(value: string): string
```

**Parameters:**
- `value` (string) - Value to escape

**Returns:** Escaped string safe for attributes

**Features:**
- DoS protection (max 1MB input)
- Escapes quotes, angle brackets, ampersands
- Prevents attribute injection

**Example:**
```typescript
const userInput = 'Hello "World" & <Friends>';
const safe = HtmlSanitizer.sanitizeForAttribute(userInput);
// Result: 'Hello &quot;World&quot; &amp; &lt;Friends&gt;'

// Use in HTML
const html = `<div data-message="${safe}">`;
```

### sanitizeForHtml()

Escapes HTML special characters for safe display.

```typescript
static sanitizeForHtml(html: string): string
```

**Parameters:**
- `html` (string) - HTML to escape

**Returns:** Escaped HTML safe to display

**Features:**
- DoS protection (max 1MB input)
- Escapes <, >, &, ", '
- Preserves text for display

**Example:**
```typescript
const code = '<script>alert("xss")</script>';
const safe = HtmlSanitizer.sanitizeForHtml(code);
// Result: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// Display safely
document.getElementById('code').textContent = safe;
```

### isValidUrl()

Validates URL safety for use in anchor tags.

```typescript
static isValidUrl(url: string): boolean
```

**Parameters:**
- `url` (string) - URL to validate

**Returns:** `true` if URL is safe, `false` otherwise

**Blocks:**
- `javascript:` URLs
- `data:` URIs
- `vbscript:` URLs
- `file:` URLs
- `blob:` URLs
- `about:` URLs
- Encoded dangerous protocols
- URLs exceeding 2048 characters

**Allows:**
- `https://` URLs
- `http://` URLs
- `mailto:` links
- `tel:` links
- `sms:` links
- Relative paths (`/`, `./`, `../`)
- Fragment identifiers (`#`)

**Example:**
```typescript
HtmlSanitizer.isValidUrl('https://example.com');        // true
HtmlSanitizer.isValidUrl('/path/to/page');              // true
HtmlSanitizer.isValidUrl('mailto:user@example.com');    // true

HtmlSanitizer.isValidUrl('javascript:alert(1)');        // false
HtmlSanitizer.isValidUrl('data:text/html,<script>');    // false
HtmlSanitizer.isValidUrl('vbscript:msgbox(1)');         // false
```

### decodeHtmlEntities()

Safely decodes HTML entities.

```typescript
static decodeHtmlEntities(text: string): string
```

**Parameters:**
- `text` (string) - Text with HTML entities

**Returns:** Text with entities decoded

**Features:**
- DoS protection (max 1MB input)
- Named entities (&amp;, &lt;, etc.)
- Numeric entities (&#65;, &#x41;)
- Safe character range validation
- Error handling for invalid entities

**Example:**
```typescript
const text = 'Hello &amp; &lt;World&gt; &#65;';
const decoded = HtmlSanitizer.decodeHtmlEntities(text);
// Result: 'Hello & <World> A'
```

## Common Allowed Tag Sets

### Basic Text Formatting

```typescript
const allowedTags = ['p', 'br', 'strong', 'em', 'u', 'b', 'i'];
```

### Rich Text Editor

```typescript
const allowedTags = [
  'p', 'br', 'strong', 'em', 'u', 'b', 'i',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'blockquote', 'code', 'pre'
];
```

### Markdown-style

```typescript
const allowedTags = [
  'p', 'br', 'strong', 'em', 'code', 'pre',
  'a', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
];
```

### Comments/Posts

```typescript
const allowedTags = [
  'p', 'br', 'a', 'strong', 'em',
  'ul', 'ol', 'li', 'blockquote'
];
```

## Attribute Preservation

The `allowedAttributes` parameter enables fine-grained control over which attributes are preserved on specific tags. This is useful for preserving styling, tracking metadata, or other safe attributes while maintaining XSS protection.

### Basic Attribute Preservation

```typescript
// Preserve class and data attributes
const html = '<span class="highlight" data-id="123">Text</span>';
const result = HtmlSanitizer.clean(html, ['span'], {
  span: ['class', 'data-id']
});
// Result: '<span class="highlight" data-id="123">Text</span>'
```

### Multiple Tags with Different Attributes

```typescript
const html = `
  <span class="legal-tag" data-uuid="abc-123">Legal term</span>
  <a href="/page" target="_blank" rel="noopener">Link</a>
  <div class="hidden" onclick="bad()">Content</div>
`;

const result = HtmlSanitizer.clean(html, ['span', 'a'], {
  span: ['class', 'data-uuid'],
  a: ['href', 'target', 'rel']
});
// span: class and data-uuid preserved
// a: href, target, rel preserved (plus auto-added security attrs for external links)
// div: removed (not in allowedTags)
// onclick: removed (event handlers always blocked)
```

### Style Attribute Preservation

Style attributes are validated to allow only safe CSS color properties:

```typescript
// Safe color styles
const html = '<span style="color: #ff0000; background-color: rgb(255, 255, 255);">Text</span>';
const result = HtmlSanitizer.clean(html, ['span'], {
  span: ['style']
});
// Result: '<span style="color: #ff0000; background-color: rgb(255, 255, 255)">Text</span>'

// Dangerous CSS filtered out
const dangerous = '<span style="color: red; behavior: url(xss.htc); -moz-binding: url(xss.xml);">Text</span>';
const safe = HtmlSanitizer.clean(dangerous, ['span'], {
  span: ['style']
});
// Result: '<span style="color: red">Text</span>'
// (dangerous properties removed)
```

### Allowed CSS Properties

When preserving style attributes, only these CSS properties are allowed:
- `color` - Text color
- `background-color` - Background color

Valid color formats:
- Hex: `#fff`, `#ffffff`, `#FF0000`
- RGB: `rgb(255, 0, 0)`
- RGBA: `rgba(255, 0, 0, 0.5)`
- Named: `red`, `blue`, `green`, `transparent`, etc.

Blocked CSS patterns:
- `javascript:` - XSS vector
- `expression()` - IE expression XSS
- `behavior:` - IE behavior binding
- `-moz-binding` - Firefox binding
- `@import` - External content loading
- `url()` - External content loading
- `data:` - Data URI XSS

### Security Guarantees with Attributes

Even when using `allowedAttributes`, these security features remain active:

```typescript
// Event handlers always blocked
const html = '<span class="safe" onclick="alert(1)" onload="bad()">Text</span>';
const result = HtmlSanitizer.clean(html, ['span'], {
  span: ['class', 'onclick', 'onload'] // onclick/onload requested but will be blocked
});
// Result: '<span class="safe">Text</span>'

// URLs still validated
const link = '<a href="javascript:alert(1)" class="link">Click</a>';
const safe = HtmlSanitizer.clean(link, ['a'], {
  a: ['href', 'class']
});
// Result: '<a class="link">Click</a>' (dangerous href removed)

// External links get security attributes
const external = '<a href="https://external.com" class="link">External</a>';
const secured = HtmlSanitizer.clean(external, ['a'], {
  a: ['href', 'class']
});
// Result: '<a href="https://external.com" class="link" target="_blank" rel="noopener noreferrer">External</a>'
```

### Use Cases

**Email Rendering:**
```typescript
// Preserve inline styles for email clients
const emailHtml = '<span style="color: #007bff;">Important</span>';
HtmlSanitizer.clean(emailHtml, ['span'], {
  span: ['style']
});
```

**Legal Compliance Tracking:**
```typescript
// Preserve metadata for legal terms
const legalContent = '<span class="legal-tag" data-uuid="term-123" data-version="1.0">Terms apply</span>';
HtmlSanitizer.clean(legalContent, ['span'], {
  span: ['class', 'data-uuid', 'data-version']
});
```

**Content Management:**
```typescript
// Preserve IDs and classes for CMS
const cmsContent = '<div class="article-body" id="content-456">Article text</div>';
HtmlSanitizer.clean(cmsContent, ['div'], {
  div: ['class', 'id']
});
```

### Backward Compatibility

When `allowedAttributes` is not provided, the sanitizer maintains its original behavior:

```typescript
// Without allowedAttributes - strips all attributes (except hardcoded href on <a>)
const html = '<span class="test" data-id="123">Text</span>';
const result = HtmlSanitizer.clean(html, ['span']);
// Result: '<span>Text</span>'

// With allowedAttributes - preserves specified attributes
const result2 = HtmlSanitizer.clean(html, ['span'], {
  span: ['class', 'data-id']
});
// Result: '<span class="test" data-id="123">Text</span>'
```

## Security Features

### XSS Prevention

```typescript
// Blocks dangerous protocols
const html = '<a href="javascript:alert(1)">Click</a>';
const safe = HtmlSanitizer.clean(html, ['a']);
// Result: '<a>Click</a>' (href removed)

// Removes script tags completely
const html = '<p>Text</p><script>alert("xss")</script>';
const safe = HtmlSanitizer.clean(html, ['p', 'script']);
// Result: '<p>Text</p>' (script and content removed)
```

### DoS Protection

```typescript
// Enforces 1MB maximum input size
const huge = 'a'.repeat(2 * 1024 * 1024);
const safe = HtmlSanitizer.clean(huge, ['p']);
// Truncates to 1MB, logs warning
```

### URL Validation

```typescript
// Validates encoded attacks
const html = '<a href="java%73cript:alert(1)">Click</a>';
const safe = HtmlSanitizer.clean(html, ['a']);
// Result: '<a>Click</a>' (encoded javascript: blocked)
```

### Entity Decoding

```typescript
// Safe entity range validation
const text = '&#9999999;'; // Out of range
const decoded = HtmlSanitizer.decodeHtmlEntities(text);
// Logs warning, skips invalid entity
```

## Error Handling

The sanitizer logs warnings for security events:

### Error Codes

- `SANITIZER_NO_ALLOWED_TAGS` - Empty allowed tags array
- `SANITIZER_INVALID_TAG` - Invalid tag name format
- `SANITIZER_NO_VALID_TAGS` - No valid tags after filtering
- `SANITIZER_INPUT_TOO_LARGE` - Input exceeds 1MB
- `SANITIZER_UNSAFE_URL` - Dangerous URL removed
- `SANITIZER_DANGEROUS_PROTOCOL` - Dangerous protocol detected
- `SANITIZER_UNSAFE_PROTOCOL` - Unknown/unsafe protocol
- `SANITIZER_ENCODED_DANGEROUS_PROTOCOL` - Encoded attack
- `SANITIZER_URL_DECODE_ERROR` - URL decoding failed
- `SANITIZER_URL_TOO_LONG` - URL exceeds 2048 chars
- `SANITIZER_STRIP_INPUT_TOO_LARGE` - Strip input too large
- `SANITIZER_ENTITY_INPUT_TOO_LARGE` - Entity decode input too large
- `SANITIZER_INVALID_CHAR_CODE` - Invalid character code
- `SANITIZER_INVALID_HEX_CODE` - Invalid hex character code

All errors include `source` field for tracking (e.g., `HtmlSanitizer.clean`).

## Best Practices

1. **Minimal Allowed Tags:** Only allow tags you actually need
   ```typescript
   // Bad - too permissive
   const allowed = ['div', 'span', 'p', 'a', 'img', 'iframe'];
   
   // Good - minimal
   const allowed = ['p', 'br', 'strong', 'em'];
   ```

2. **Context-Specific Sanitization:** Different contexts need different rules
   ```typescript
   // For comments
   const commentAllowed = ['p', 'br', 'strong', 'em'];
   
   // For blog posts
   const postAllowed = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'];
   
   // For admin content
   const adminAllowed = [...postAllowed, 'img', 'h1', 'h2', 'blockquote'];
   ```

3. **Double Sanitization:** Sanitize on input AND output
   ```typescript
   // On input - save sanitized version
   const sanitized = HtmlSanitizer.clean(userInput, allowedTags);
   await db.save({ content: sanitized });
   
   // On output - sanitize again for extra safety
   const safe = HtmlSanitizer.clean(content, allowedTags);
   return safe;
   ```

4. **URL Validation:** Always validate URLs in user content
   ```typescript
   // Before rendering
   if (content.includes('href=')) {
     const sanitized = HtmlSanitizer.clean(content, ['a', 'p']);
     // Dangerous URLs automatically removed
   }
   ```

5. **Plain Text Alternative:** When in doubt, strip all HTML
   ```typescript
   // For sensitive contexts (emails, previews)
   const plainText = HtmlSanitizer.stripAllTags(userInput);
   ```

## Examples

### User Comment System

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

async function saveComment(userId: string, rawContent: string) {
  // Define allowed tags for comments
  const allowedTags = ['p', 'br', 'strong', 'em', 'a'];
  
  // Sanitize input
  const sanitized = HtmlSanitizer.clean(rawContent, allowedTags);
  
  // Save to database
  await db.comments.create({
    userId,
    content: sanitized,
    createdAt: new Date()
  });
}

async function displayComment(commentId: string) {
  const comment = await db.comments.find(commentId);
  
  // Sanitize again before display (defense in depth)
  const safe = HtmlSanitizer.clean(comment.content, allowedTags);
  
  return safe;
}
```

### Rich Text Editor

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

const richTextAllowed = [
  'p', 'br', 'strong', 'em', 'u',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'a', 'blockquote', 'code', 'pre'
];

async function saveBlogPost(title: string, content: string) {
  // Sanitize title (plain text only)
  const safeTitle = HtmlSanitizer.stripAllTags(title);
  
  // Sanitize content (allow HTML)
  const safeContent = HtmlSanitizer.clean(content, richTextAllowed);
  
  await db.posts.create({
    title: safeTitle,
    content: safeContent
  });
}
```

### Email Preview

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

function createEmailPreview(htmlContent: string, maxLength: number = 200) {
  // Strip all HTML for preview
  const plainText = HtmlSanitizer.stripAllTags(htmlContent);
  
  // Truncate to preview length
  const preview = plainText.substring(0, maxLength);
  
  return preview + (plainText.length > maxLength ? '...' : '');
}

const email = '<p>Hello <strong>World</strong>!</p><p>This is content.</p>';
const preview = createEmailPreview(email, 50);
// Result: 'Hello World! This is content.'
```

### Search Results

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

function highlightSearchTerm(content: string, term: string) {
  // First sanitize for display
  const safe = HtmlSanitizer.sanitizeForHtml(content);
  
  // Then add highlight tags (safe because original is escaped)
  const highlighted = safe.replace(
    new RegExp(term, 'gi'),
    match => `<mark>${match}</mark>`
  );
  
  return highlighted;
}
```

## Performance

- **Input Validation:** O(n) where n is input length
- **Tag Filtering:** O(m) where m is number of tags
- **Entity Decoding:** O(n) with regex optimization
- **DoS Protection:** Enforced at all entry points
- **Memory:** Efficient string processing, truncates large inputs

## Type Definitions

```typescript
interface SanitizationResult {
  readonly sanitized: string;
  readonly warnings?: string[];
}
```

## Testing

```typescript
import HtmlSanitizer from '@designofadecade/server/sanitizer';

// Test XSS prevention
const xss = '<script>alert("xss")</script>';
const safe = HtmlSanitizer.clean(xss, ['p']);
assert(safe === '');

// Test URL validation
const dangerous = '<a href="javascript:alert(1)">Click</a>';
const safe = HtmlSanitizer.clean(dangerous, ['a']);
assert(!safe.includes('javascript:'));

// Test entity decoding
const entities = '&lt;script&gt;';
const decoded = HtmlSanitizer.decodeHtmlEntities(entities);
assert(decoded === '<script>');
```

## Related Documentation

- [Logger](./logger.md) - Security event logging
- [Router](./router.md) - Request handling
- [Context](./context.md) - Application context
