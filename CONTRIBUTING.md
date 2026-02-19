# Contributing to PCB Lens MCP Server

Thank you for your interest in contributing! We welcome contributions from the community.

## Maintainers

This project is maintained by:
- **Valentino Zegna** - Creator & Lead Maintainer

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm

### Development Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/pcb-lens.git
   cd pcb-lens
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Download test fixtures (IPC-2581 XML files from the IPC-2581 Consortium):

   ```bash
   npm run setup
   ```

4. Run the development server:

   ```bash
   npm run dev
   ```

5. Run tests:

   ```bash
   npm test
   ```

### Project Structure

- `src/` - Main source code
- `src/cli/` - CLI command handlers, auto-updater, shell integration
- `src/xml-utils.ts` - Streaming XML parsing utilities
- `test/fixtures/` - IPC-2581 XML test files (downloaded via `npm run setup`, gitignored)
- `test/integration/` - Integration tests against fixtures
- `scripts/` - Build and release scripts

### Test Fixtures

Test fixtures are IPC-2581 XML files downloaded from the IPC-2581 Consortium. They are large files (14MB+) and are gitignored. Run `npm run setup` to download them. The script extracts specific IPC-2581 files from consortium zips and flattens them to `test/fixtures/*.xml`.

## Development Workflow

### Running Checks

Before submitting a PR, run all checks:

```bash
npm run type-check    # TypeScript type checking
npm run lint          # ESLint
npm test              # Unit tests
```

### Code Style

- TypeScript with strict mode
- ESLint for linting
- Prefer functional programming patterns

### Writing Tests

- Tests are colocated with source files (e.g., `service.test.ts`)
- Use Vitest for testing
- Fixture-dependent tests skip automatically if fixtures aren't downloaded
- Test edge cases and error conditions

## Pull Request Process

1. **Create a feature branch:**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Keep commits focused and atomic
   - Write clear commit messages

3. **Run all checks:**

   ```bash
   npm run type-check && npm run lint && npm test
   ```

4. **Push and create a PR:**
   - Fill out the PR template
   - Link any related issues
   - Describe what you changed and why

5. **Code Review:**
   - Respond to feedback
   - Make requested changes
   - Keep the PR updated with main

## Reporting Issues

- Use the issue templates
- Include steps to reproduce
- Provide sample files if possible (anonymized)

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Open a [Discussion](https://github.com/IntelligentElectron/pcb-lens/discussions) for questions or ideas.
