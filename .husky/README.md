# Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged) to ensure code quality before commits.

## What Happens on Commit

When you run `git commit`, the following checks automatically run on staged files:

1. **Prettier** - Formats your code according to project standards
2. **ESLint** - Checks for code quality issues and automatically fixes them
3. **Vitest** - Runs tests related to your changes

If any of these checks fail, the commit will be aborted, and you'll need to fix the issues before committing again.

## Setup

Pre-commit hooks are automatically installed when you run:

```bash
npm install
```

This triggers the `prepare` script which sets up Husky.

## Configuration

### lint-staged Configuration

In `package.json`:

```json
{
  "lint-staged": {
    "*.ts": [
      "prettier --write",
      "eslint --fix",
      "vitest related --run"
    ]
  }
}
```

This means:
- Only TypeScript files (`*.ts`) are checked
- Prettier formats the files automatically
- ESLint fixes what it can
- Related tests are run (only tests affected by your changes)

### Customizing lint-staged

You can customize what runs on different file types:

```json
{
  "lint-staged": {
    "*.ts": [
      "prettier --write",
      "eslint --fix"
    ],
    "*.{json,md}": [
      "prettier --write"
    ]
  }
}
```

## Available Hooks

### pre-commit

Runs before each commit. Currently configured to run lint-staged.

File: `.husky/pre-commit`

```bash
npx lint-staged
```

### Adding More Hooks

You can add additional hooks:

#### commit-msg

Enforce commit message conventions:

```bash
echo 'npx --no -- commitlint --edit $1' > .husky/commit-msg
chmod +x .husky/commit-msg
```

#### pre-push

Run full test suite before pushing:

```bash
echo 'npm test' > .husky/pre-push
chmod +x .husky/pre-push
```

## Skipping Hooks

In rare cases where you need to skip pre-commit hooks:

```bash
git commit --no-verify -m "Emergency fix"
```

⚠️ Use this sparingly! The hooks are there to protect code quality.

## Troubleshooting

### Hooks not running

If hooks don't run after installing dependencies:

```bash
npm run prepare
```

### Permission denied errors

Make sure hooks are executable:

```bash
chmod +x .husky/pre-commit
```

### Hooks too slow

If the pre-commit hook takes too long, you can:

1. Remove the test step from lint-staged (not recommended)
2. Use `--no-verify` for work-in-progress commits, but test before pushing

### Hooks running on all files

By default, lint-staged only runs on staged files. If it seems to be running on all files:

1. Make sure you're using `git add` before committing
2. Check your lint-staged configuration

## Manual Commands

You can run the same checks manually:

```bash
# Format all files
npm run format

# Lint all files
npm run lint

# Run tests
npm test

# Type check
npm run typecheck

# Run lint-staged manually
npx lint-staged
```

## CI/CD Integration

These same checks should run in your CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Install dependencies
  run: npm ci
  
- name: Lint
  run: npm run lint
  
- name: Type check
  run: npm run typecheck
  
- name: Test
  run: npm test
```

## Best Practices

1. **Commit often** - Small commits are easier to review and fix
2. **Fix issues immediately** - Don't skip hooks to "fix later"
3. **Write tests** - The pre-commit hook runs tests to catch regressions
4. **Read error messages** - They usually tell you exactly what needs fixing
5. **Keep hooks fast** - Slow hooks encourage developers to skip them

## Common Error Messages

### "Prettier found code that is not properly formatted"

Run: `npm run format`

### "ESLint found issues"

Run: `npm run lint` to see issues, many can be auto-fixed with `npm run lint -- --fix`

### "Tests failed"

Run: `npm test` to see which tests are failing and fix them

### "Type errors"

Run: `npm run typecheck` to see TypeScript errors
