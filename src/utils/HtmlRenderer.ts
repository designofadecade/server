import fs from 'fs/promises';

export interface RenderOptions {
  /**
   * HTML-escape interpolated values. Defaults to true.
   *
   * Set false only when the values are already safe HTML - typically output
   * from `HtmlSanitizer.clean()` - and the template is composing it rather
   * than displaying it. This restores pre-8.0.0 interpolation for `{{value}}`
   * without re-opening the template-injection hole: values are still parked in
   * the slot table, so data can never be read back as template syntax.
   */
  escape?: boolean;
}

export default class HtmlRenderer {
  static async renderFromFile(
    templatePath: string,
    vars: Record<string, any>,
    options: RenderOptions = {}
  ): Promise<string> {
    const templateContent = await fs.readFile(templatePath, 'utf8');
    if (!templateContent) return '';

    return HtmlRenderer.render(templateContent, vars, options);
  }

  static render(template: string, vars: Record<string, any>, options: RenderOptions = {}): string {
    if (typeof template !== 'string') return '';

    // SECURITY: NUL is reserved for the substitution sentinel below, so it is
    // stripped from caller input to stop a template forging a slot reference.
    const safeTemplate = template.replace(/\0/g, '');

    // Substituted values are parked in this table and only spliced in once
    // every template construct has been processed. Writing them straight into
    // the working string let data be re-read as template syntax: a value of
    // '{{secret}}' inside an {{#each}} resolved against the outer scope, and an
    // injected '{{#if}}' block was executed on the next pass of the loop.
    const slots: string[] = [];

    // Escaping is on by default. Callers composing already-sanitized HTML opt
    // out explicitly; template injection stays blocked either way, because every
    // value still goes through the slot table.
    const escape = options.escape !== false;

    const processed = HtmlRenderer.#processTemplate(safeTemplate, vars, slots, escape);

    return processed.replace(/\0(\d+)\0/g, (_match, index) => slots[Number(index)] ?? '');
  }

  static #escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Parks a resolved value in the slot table and returns its sentinel.
   * The sentinel contains no template syntax, so nothing that comes from data
   * can be interpreted as a variable, condition or block on a later pass.
   */
  static #slot(value: any, slots: string[], escape: boolean): string {
    if (value === null || value === undefined || typeof value === 'function') return '';

    // NUL never belongs in rendered output, and dropping it here keeps a
    // value from carrying anything that resembles a slot sentinel.
    const text = String(value).replace(/\0/g, '');
    const index = slots.length;

    slots.push(escape ? HtmlRenderer.#escapeHtml(text) : text);

    return `\0${index}\0`;
  }

  static #processTemplate(
    template: string,
    vars: Record<string, any>,
    slots: string[],
    escape: boolean
  ): string {
    let processed = template;
    let hasChanges = true;

    // Process blocks from innermost to outermost using iterative approach
    while (hasChanges) {
      const before = processed;

      // Process {{#if}} with {{else}} - innermost first (non-greedy match)
      processed = processed.replace(
        /\{\{#if\s+([^{}\s][^{}]*)\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{else\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{\/if\}\}/s,
        (_match, condition, ifContent, elseContent) => {
          const isTruthy = HtmlRenderer.#evaluateCondition(condition, vars);
          return isTruthy ? ifContent : elseContent;
        }
      );

      // Process {{#if}} without {{else}} - innermost first (non-greedy match)
      processed = processed.replace(
        /\{\{#if\s+([^{}\s][^{}]*)\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{\/if\}\}/s,
        (_match, condition, content) => {
          const isTruthy = HtmlRenderer.#evaluateCondition(condition, vars);
          return isTruthy ? content : '';
        }
      );

      // Process {{#each}} - innermost first (non-greedy match)
      processed = processed.replace(
        /\{\{#each\s+([\w.]+)\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{\/each\}\}/s,
        (_match, path, content) => {
          const arr = HtmlRenderer.#resolveValue(path, vars);
          if (!Array.isArray(arr)) return '';

          return arr
            .map((item, index) => {
              // Create new context with item properties and special variables
              const itemVars =
                typeof item === 'object' && item !== null
                  ? { ...vars, ...item, this: item, index }
                  : { ...vars, this: item, index };

              return HtmlRenderer.#replaceVariables(content, itemVars, slots, escape);
            })
            .join('');
        }
      );

      hasChanges = processed !== before;
    }

    // Final pass: replace all variables
    return HtmlRenderer.#replaceVariables(processed, vars, slots, escape);
  }

  static #evaluateCondition(condition: string, vars: Record<string, any>): boolean {
    // Trim the condition
    condition = condition.trim();

    // Check for comparison operators
    const operators = [
      { regex: /^(.+?)\s*===\s*(.+)$/, op: '===' },
      { regex: /^(.+?)\s*!==\s*(.+)$/, op: '!==' },
      { regex: /^(.+?)\s*==\s*(.+)$/, op: '==' },
      { regex: /^(.+?)\s*!=\s*(.+)$/, op: '!=' },
      { regex: /^(.+?)\s*>=\s*(.+)$/, op: '>=' },
      { regex: /^(.+?)\s*<=\s*(.+)$/, op: '<=' },
      { regex: /^(.+?)\s*>\s*(.+)$/, op: '>' },
      { regex: /^(.+?)\s*<\s*(.+)$/, op: '<' },
    ];

    // Check each operator pattern
    for (const { regex, op } of operators) {
      const match = condition.match(regex);
      if (match) {
        const left = HtmlRenderer.#resolveConditionValue(match[1].trim(), vars);
        const right = HtmlRenderer.#resolveConditionValue(match[2].trim(), vars);

        switch (op) {
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '==':
            return left == right;
          case '!=':
            return left != right;
          case '>':
            return left > right;
          case '<':
            return left < right;
          case '>=':
            return left >= right;
          case '<=':
            return left <= right;
        }
      }
    }

    // No operator found - evaluate as truthy check
    const value = HtmlRenderer.#resolveValue(condition, vars);
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }

  static #resolveConditionValue(value: string, vars: Record<string, any>): any {
    // Check if it's a quoted string
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    // Check if it's a number
    if (!isNaN(Number(value)) && value.trim() !== '') {
      return Number(value);
    }

    // Check if it's a boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;

    // Otherwise, resolve as a variable path
    return HtmlRenderer.#resolveValue(value, vars);
  }

  static #resolveValue(path: string, vars: Record<string, any>): any {
    const keys = path.split('.');
    let value: any = vars;

    for (const key of keys) {
      if (value == null || !Object.hasOwn(value, key)) return null;

      value = value[key];
    }

    return value;
  }

  static #lookup(path: string, vars: Record<string, any>): any {
    const keys = path.split('.');
    let value: any = vars;

    for (const key of keys) {
      if (value == null || !Object.hasOwn(value, key)) return null;

      value = value[key];
    }

    return value;
  }

  static #replaceVariables(
    template: string,
    vars: Record<string, any>,
    slots: string[],
    escape: boolean
  ): string {
    // {{{key}}} - raw, unescaped. Only for values the caller knows are safe HTML.
    let processed = template.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, path) =>
      HtmlRenderer.#slot(HtmlRenderer.#lookup(path, vars), slots, false)
    );

    // {{key}} or {{key.nested}} or {{this.property}} - HTML-escaped by default,
    // so an interpolated value cannot introduce markup or break out of an
    // attribute.
    processed = processed.replace(/\{\{([\w.]+)\}\}/g, (_, path) =>
      HtmlRenderer.#slot(HtmlRenderer.#lookup(path, vars), slots, escape)
    );

    return processed;
  }
}
