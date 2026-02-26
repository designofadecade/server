# Contributing to Design of a Decade Server

Thank you for your interest in contributing to Design of a Decade Server! We welcome contributions from the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/server.git
   cd server
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running Tests

Always run tests before submitting a pull request:

```bash
npm test                 # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
npm run test:ui         # Open Vitest UI
```

### Building

```bash
npm run build           # Build the project
npm run typecheck       # Type-check without building
```

### Linting and Formatting

```bash
npm run lint            # Lint code with ESLint
npm run format          # Format code with Prettier
```

## Pull Request Process

1. **Update tests**: Ensure your changes include appropriate test coverage
2. **Update documentation**: Update README.md and other docs if needed
3. **Run the full test suite**: Make sure all tests pass
4. **Lint your code**: Run `npm run lint` and fix any issues
5. **Update CHANGELOG.md**: Add your changes under the "Unreleased" section
6. **Create a pull request**: Provide a clear description of your changes

### Pull Request Guidelines

- Keep PRs focused on a single feature or bug fix
- Write clear, descriptive commit messages
- Reference any related issues in your PR description
- Ensure CI/CD checks pass before requesting review
- Be responsive to feedback and questions

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Provide proper type annotations
- Avoid `any` types when possible (use `unknown` instead)
- Use interfaces for object shapes
- Export types that may be useful to consumers

### Style Guide

- Follow the ESLint and Prettier configurations
- Use meaningful variable and function names
- Keep functions small and focused
- Add JSDoc comments for public APIs
- Use async/await over raw Promises
- Prefer const over let, avoid var

### File Organization

- One class/module per file
- Co-locate tests with source files (e.g., `Router.ts` and `Router.test.ts`)
- Use barrel exports (index.ts) for public APIs
- Keep internal utilities in separate files

## Testing

### Test Requirements

- All new features must include tests
- Bug fixes should include regression tests
- Aim for high test coverage (80%+ is ideal)
- Write both unit tests and integration tests where appropriate

### Test Structure

```typescript
import { describe, it, expect } from 'vitest';

describe('FeatureName', () => {
  it('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = someFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Mocking

- Use Vitest's mocking utilities
- Keep mocks simple and focused
- Clean up mocks in afterEach hooks

## Documentation

- Update the README.md for new features
- Add JSDoc comments to public APIs
- Update type definitions as needed
- Include code examples for complex features
- Keep the CHANGELOG.md up to date

## Questions?

If you have questions about contributing, please open an issue with the "question" label.

## License

By contributing to Design of a Decade Server, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Design of a Decade Server! 🎉
