import fs from 'fs/promises';

export default class HtmlRenderer {

    static async renderFromFile(templatePath: string, vars: Record<string, any>): Promise<string> {

        const templateContent = await fs.readFile(templatePath, 'utf8');
        if (!templateContent)
            return '';

        return HtmlRenderer.render(templateContent, vars);

    }

    static render(template: string, vars: Record<string, any>): string {
        return HtmlRenderer.#processTemplate(template, vars);
    }

    static #processTemplate(template: string, vars: Record<string, any>): string {

        let processed = template;
        let hasChanges = true;

        // Process blocks from innermost to outermost using iterative approach
        while (hasChanges) {

            const before = processed;

            // Process {{#if}} with {{else}} - innermost first (non-greedy match)
            processed = processed.replace(
                /\{\{#if\s+([^}]+)\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{else\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{\/if\}\}/s,
                (_match, condition, ifContent, elseContent) => {

                    const isTruthy = HtmlRenderer.#evaluateCondition(condition, vars);
                    return isTruthy ? ifContent : elseContent;
                }
            );

            // Process {{#if}} without {{else}} - innermost first (non-greedy match)
            processed = processed.replace(
                /\{\{#if\s+([^}]+)\}\}((?:(?!\{\{#if|\{\{#each).)*?)\{\{\/if\}\}/s,
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
                    if (!Array.isArray(arr))
                        return '';

                    return arr.map((item, index) => {

                        // Create new context with item properties and special variables
                        const itemVars = typeof item === 'object' && item !== null
                            ? { ...vars, ...item, this: item, index }
                            : { ...vars, this: item, index };

                        return HtmlRenderer.#replaceVariables(content, itemVars);

                    }).join('');
                }
            );

            hasChanges = (processed !== before);
        }

        // Final pass: replace all variables
        return HtmlRenderer.#replaceVariables(processed, vars);
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
            { regex: /^(.+?)\s*<\s*(.+)$/, op: '<' }
        ];

        // Check each operator pattern
        for (const { regex, op } of operators) {
            const match = condition.match(regex);
            if (match) {
                const left = HtmlRenderer.#resolveConditionValue(match[1].trim(), vars);
                const right = HtmlRenderer.#resolveConditionValue(match[2].trim(), vars);

                switch (op) {
                    case '===': return left === right;
                    case '!==': return left !== right;
                    case '==': return left == right;
                    case '!=': return left != right;
                    case '>': return left > right;
                    case '<': return left < right;
                    case '>=': return left >= right;
                    case '<=': return left <= right;
                }
            }
        }

        // No operator found - evaluate as truthy check
        const value = HtmlRenderer.#resolveValue(condition, vars);
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }

    static #resolveConditionValue(value: string, vars: Record<string, any>): any {

        // Check if it's a quoted string
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
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

            if (value == null || !Object.hasOwn(value, key))
                return null;

            value = value[key];
        }

        return value;
    }

    static #replaceVariables(template: string, vars: Record<string, any>): string {

        // {{key}} or {{key.nested}} or {{this.property}}
        return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {

            const keys = path.split('.');
            let value: any = vars;

            for (const key of keys) {

                if (value == null || !Object.hasOwn(value, key))
                    return '';

                value = value[key];
            }

            return typeof value === 'function' ? '' : value;

        });

    }

}
