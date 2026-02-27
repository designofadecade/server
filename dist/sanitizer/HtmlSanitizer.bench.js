import { bench, describe } from 'vitest';
import HtmlSanitizer from './HtmlSanitizer.js';
describe('HtmlSanitizer Performance', () => {
    const allowedTags = ['p', 'div', 'strong', 'a', 'br', 'hr', 'img'];
    bench('clean small HTML - 100 chars', () => {
        const html = '<p>Hello <strong>world</strong>! This is a <a href="test">link</a>.</p>';
        HtmlSanitizer.clean(html, allowedTags);
    });
    bench('clean medium HTML - 1KB', () => {
        const html = '<div>' + '<p>Lorem ipsum dolor sit amet. </p>'.repeat(30) + '</div>';
        HtmlSanitizer.clean(html, allowedTags);
    });
    bench('clean large HTML - 10KB', () => {
        const html = '<div>' + '<p>Lorem ipsum dolor sit amet. </p>'.repeat(300) + '</div>';
        HtmlSanitizer.clean(html, allowedTags);
    });
    bench('clean with dangerous content', () => {
        const html = `
            <div>
                <p>Safe content</p>
                <script>alert('xss')</script>
                <img src="x" onerror="alert('xss')">
                <a href="javascript:alert('xss')">Click</a>
            </div>
        `;
        HtmlSanitizer.clean(html, allowedTags);
    });
    bench('clean deeply nested HTML', () => {
        let html = '<div>';
        for (let i = 0; i < 20; i++) {
            html += '<div><p>Nested content</p>';
        }
        for (let i = 0; i < 20; i++) {
            html += '</div>';
        }
        html += '</div>';
        HtmlSanitizer.clean(html, allowedTags);
    });
});
//# sourceMappingURL=HtmlSanitizer.bench.js.map