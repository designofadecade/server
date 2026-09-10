import { describe, it, expect } from 'vitest';
import HtmlSanitizer from './HtmlSanitizer.ts';

/**
 * Sanitizer input is attacker-controlled by definition, so the cost of
 * sanitizing has to stay linear in input size.
 *
 * The tag patterns used to end in `[^>]*`. On input with many '<' and no '>'
 * the engine rescanned to the end of input from every '<' and backtracked,
 * making the work quadratic: 80KB took ~6.6s and 1MB — inside MAX_INPUT_SIZE —
 * extrapolated to roughly 19 minutes of blocked event loop for one request.
 *
 * The bounds below are deliberately loose. Post-fix these inputs take tens of
 * milliseconds, so a 2s ceiling is ~100x headroom against CI jitter while still
 * failing decisively if the quadratic behaviour returns — against the unfixed
 * code these same cases take 4-55 seconds each.
 *
 * These assert an absolute budget rather than a growth ratio between two input
 * sizes. At millisecond scale a ratio is dominated by JIT warmup, which made it
 * flaky; the absolute ceiling has orders of magnitude more headroom.
 */
describe('HtmlSanitizer ReDoS resistance', () => {
  const BUDGET_MS = 2000;
  const N = 200_000;

  const timed = (fn: () => unknown): number => {
    const started = performance.now();
    fn();
    return performance.now() - started;
  };

  it('sanitizes a long run of "<" in linear time', () => {
    expect(timed(() => HtmlSanitizer.clean('<'.repeat(N)))).toBeLessThan(BUDGET_MS);
  });

  it('sanitizes repeated dangerous-tag prefixes in linear time', () => {
    const payload = '<link' + '<base'.repeat(N / 5);
    expect(timed(() => HtmlSanitizer.clean(payload))).toBeLessThan(BUDGET_MS);
  });

  it('sanitizes unterminated tags in linear time with an allowlist', () => {
    const payload = '<a href="'.repeat(N / 9);
    expect(timed(() => HtmlSanitizer.clean(payload, ['a', 'b']))).toBeLessThan(BUDGET_MS);
  });

  it('strips tags from long unbalanced input in linear time', () => {
    const payload = '<b>ok</b>' + '<'.repeat(N);
    expect(timed(() => HtmlSanitizer.clean(payload, ['b']))).toBeLessThan(BUDGET_MS);
  });
});

/**
 * CodeQL reports `js/incomplete-multi-character-sanitization` on the individual
 * tag-stripping `.replace()` calls, because a single pass over `<scr<script>ipt>`
 * reassembles `<script>`. That is mitigated structurally rather than locally:
 * the strip loop repeats until the output stops changing, any residual '<' is
 * escaped, and output tags are re-emitted from an allowlist builder.
 *
 * Those alerts are dismissed as false positives. This suite is what makes that
 * dismissal safe — remove any part of the mitigation and these fail, rather
 * than the hole reopening silently.
 */
describe('HtmlSanitizer multi-character sanitization', () => {
  const executable = (s: string) =>
    /<\s*(script|iframe|object|embed|applet)|\son\w+\s*=|javascript\s*:/i.test(s);

  const payloads = [
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<scri<script>pt>alert(1)</scri</script>pt>',
    '<<script>script>alert(1)<</script>/script>',
    '<scr<scr<script>ipt>ipt>alert(1)</scr</scr</script>ipt>ipt>',
    '<sc<!-- -->ript>alert(1)</sc<!-- -->ript>',
    '<img sr<script>c=x onerror=alert(1)>',
    '<img src=x on<script>error=alert(1)>',
    '<a hr<script>ef="javascript:alert(1)">x</a>',
    '<a href="jav&#x61;script:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<b onmouseover=alert(1)>hi</b>',
    '<iframe sr<script>c="//evil">',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '<base<base href="//evil">href="//evil">',
  ];

  for (const payload of payloads) {
    it(`never emits executable markup for ${JSON.stringify(payload).slice(0, 44)}`, () => {
      expect(executable(HtmlSanitizer.clean(payload))).toBe(false);
      expect(executable(HtmlSanitizer.clean(payload, ['a', 'b', 'i', 'img']))).toBe(false);
    });
  }

  /**
   * A quoted attribute value may legally contain '<'. The linear tag pattern
   * has to consume the whole quoted value, or attribute content escapes into
   * the document as structure.
   */
  it('does not leak quoted attribute content as markup', () => {
    expect(HtmlSanitizer.clean('<a title="a<b">text</a>', ['a', 'b'])).toBe('<a>text</a>');
    expect(HtmlSanitizer.clean('<a href="/x" title="q<r">t</a>', ['a'])).toBe('<a href="/x">t</a>');
    expect(HtmlSanitizer.clean("<a title='x<script>alert(1)</script>'>t</a>", ['a'])).toBe(
      '<a>t</a>'
    );
  });
});
