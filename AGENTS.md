# PCB Lens MCP Server

## Overview

MCP server for querying IPC-2581 PCB layout files. Enables LLM-driven layout review for any board exported as IPC-2581 XML.

## Development

### Setup

```bash
bun install         # Prefer bun over npm
npm run setup       # Init test-fixtures submodule + download IPC-2581 fixtures
npm run dev
```

**Note:** Test fixtures come from the shared **[test-fixtures](https://github.com/IntelligentElectron/test-fixtures)** repo, consumed as a git submodule at `test/fixtures`. `npm run setup` initializes the submodule and runs `test/fixtures/ipc2581/download-fixtures.sh`, which fetches the large IPC-2581 XML into `test/fixtures/ipc2581/` (gitignored by the submodule). The download script extracts specific IPC-2581 files from consortium zips, flattens them (renaming `.cvg` → `.xml`), and cleans up nested directories. When adding new fixtures, edit the script in the test-fixtures repo and verify the inner zip structure first — many contain nested directories, `.cvg` files, and non-IPC-2581 artifacts (ODB++, Gerbers, drill files). Fixture-dependent tests `skipIf` the XML is absent, so CI passes without downloading.

### Commands

```bash
npm run dev          # Run with tsx (auto-reload)
npm run build        # Compile TypeScript to dist/
npm run start        # Run compiled version
npm run type-check   # TypeScript type checking
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm test             # Run tests with Vitest
npm run test:watch   # Run tests in watch mode
npm run compile:all  # Build all platform binaries
```

### Binary Compilation

Uses Bun to compile TypeScript into standalone executables:

```bash
bun build src/index.ts --compile --minify --target=bun-<platform> --outfile=bin/<name>-<platform>
```

Platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-x64`

macOS binaries require code signing with `entitlements.plist` (for Bun JIT) and Apple notarization.

### Before Committing

```bash
npm run type-check && npm run lint && npm test
```

### Releasing

There is no release PR. Feature PRs contain the code, tests, and documentation users
need. Give each PR a user-facing title and description; GitHub uses the merged PRs to
generate release notes. Do not edit `CHANGELOG.md` or bump the development version.

After the intended changes have merged, choose the semantic version bump explicitly,
then tag the current `main` commit:

```bash
git checkout main && git pull
scripts/tag-release.sh 1.8.0
```

The script refuses to run off `main`, with a dirty or stale tree, for a malformed
semantic version, or for an existing tag. Pass `--yes` to skip the prompt. The tag is the
release version; CI stamps it into the binaries and the npm package.

The tag triggers the release workflow, which automatically:

- Builds, signs, and notarizes the standalone binaries
- Generates release notes from merged PRs and creates the GitHub Release
- Publishes to npm via OIDC (no tokens)

`CHANGELOG.md` is the historical changelog through v1.4.0.

## Project Structure

```bash
find src/ scripts/ test/ -type f -not -name '*.js' -not -name '*.map' | sort
```

## Editing Guidelines

- Scratch scripts in `scripts/` are fine for ad-hoc work, but clean them up before finishing — don't leave them behind.

## Adding New Features

### Adding a New Tool

1. Add types in `src/tools/lib/types.ts`
2. Create a new tool file in `src/tools/<tool-name>.ts` (imports from `./lib/`, `./shared.js` and `./registry.js` only) that exports `tool = defineTool({ name, title, description, inputSchema, run })`
3. Add it to `TOOLS` in `src/tools/index.ts`: the MCP server registers it and the command line runs it as `pcb-lens <tool>`
4. Run `npm run gen:skill` to regenerate the plugin's skill
5. Add tests in `src/tools/<tool-name>.test.ts`

## Testing

Tests use conditional skipping for fixture-dependent tests:

```bash
npm test                           # Run all tests (skips fixture tests if not downloaded)
npm run setup && npm test          # Run all tests including fixture tests
npm run test:watch                 # Watch mode
```

## CI/CD

- **CI** (`ci.yml`): Runs on every push - type-check, lint, test
- **Release** (`release.yml`): Triggered by `v*` tags - builds binaries, signs macOS, publishes npm

npm publishing uses OIDC trusted publishing (configured on npmjs.com) - no tokens required.
