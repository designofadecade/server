import { describe, it, expect } from 'vitest';
import HtmlRenderer from './HtmlRenderer.ts';

/**
 * `{{#if}}` matched its condition with `\s+([^}]+)`. Both parts match a space,
 * so on a template like `{{#if` followed by a long run of spaces and no closing
 * `}}`, the engine tried every split point and rescanned to end of input for
 * each — quadratic. Requiring the condition to start with a non-space makes the
 * two disjoint, so a failed match backtracks in constant time per step.
 *
 * A condition also cannot contain braces, which bounds each scan at the next
 * `{` rather than at end of input — without that, a repeated `{{#if` gave many
 * start positions that each rescanned the whole template.
 *
 * HtmlRenderer has no input cap, so this is bounded only by template size.
 */
describe('HtmlRenderer ReDoS resistance', () => {
  const BUDGET_MS = 1000;

  const timed = (fn: () => unknown): number => {
    const started = performance.now();
    fn();
    return performance.now() - started;
  };

  it('handles an unterminated {{#if}} with a long whitespace run', () => {
    const template = '{{{{#if ' + ' '.repeat(100_000);
    expect(timed(() => HtmlRenderer.render(template, {}))).toBeLessThan(BUDGET_MS);
  });

  it('handles an unterminated {{#if}}/{{else}} with a long whitespace run', () => {
    const template = '{{{{#if ' + ' '.repeat(50_000) + '{{else}}';
    expect(timed(() => HtmlRenderer.render(template, {}))).toBeLessThan(BUDGET_MS);
  });

  /**
   * The first attempt at this fix only stopped the condition from starting with
   * whitespace, which fixed a single long run but not the general case: with
   * `{{#if` repeated, every occurrence is a start position whose condition scan
   * still ran to end of input. Excluding braces from the condition bounds each
   * scan at the next `{`, which is what makes it linear.
   */
  it('handles many repeated unterminated {{#if}} openings', () => {
    const template = '{{{{#if !'.repeat(32_000);
    expect(timed(() => HtmlRenderer.render(template, {}))).toBeLessThan(BUDGET_MS);
  });

  it('handles many {{#if}} openings with no matching close', () => {
    const template = '{{#if a}}'.repeat(32_000);
    expect(timed(() => HtmlRenderer.render(template, { a: 1 }))).toBeLessThan(BUDGET_MS);
  });

  it('handles many {{#if}}/{{else}} openings with no matching close', () => {
    const template = '{{#if a}}x{{else}}'.repeat(32_000);
    expect(timed(() => HtmlRenderer.render(template, { a: 1 }))).toBeLessThan(BUDGET_MS);
  });

  it('handles many repeated unterminated {{#each}} openings', () => {
    const template = '{{#each a}}'.repeat(32_000);
    expect(timed(() => HtmlRenderer.render(template, { a: [] }))).toBeLessThan(BUDGET_MS);
  });

  /**
   * The condition capture changed from `[^}]+` to `[^}\s][^}]*`, so it must
   * still accept every condition form the renderer supports — including the
   * comparison operators, whose `<` and `>` the capture has to pass through,
   * and surrounding whitespace, which `#evaluateCondition` trims.
   */
  it('still renders every supported condition form', () => {
    expect(HtmlRenderer.render('{{#if a}}Y{{/if}}', { a: true })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a}}Y{{else}}N{{/if}}', { a: false })).toBe('N');
    expect(HtmlRenderer.render('{{#if  a  }}Y{{/if}}', { a: true })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a }}Y{{/if}}', { a: true })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a.b}}Y{{/if}}', { a: { b: 1 } })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a === 1}}Y{{/if}}', { a: 1 })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a !== 1}}Y{{else}}N{{/if}}', { a: 1 })).toBe('N');
    expect(HtmlRenderer.render('{{#if a > 2}}Y{{/if}}', { a: 3 })).toBe('Y');
    expect(HtmlRenderer.render('{{#if a < 2}}Y{{else}}N{{/if}}', { a: 3 })).toBe('N');
    expect(HtmlRenderer.render('{{#if a >= 2}}Y{{/if}}', { a: 2 })).toBe('Y');
  });
});
