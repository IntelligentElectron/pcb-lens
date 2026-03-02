# PCB Lens MCP Server

## Overview

MCP server for querying IPC-2581 PCB layout files. Enables LLM-driven layout review for any board exported as IPC-2581 XML.

## Development

### Setup

```bash
bun install         # Prefer bun over npm
npm run setup       # Download IPC-2581 test fixtures
npm run dev
```

**Note:** Test fixtures are large XML files downloaded via `npm run setup`. They are gitignored. The download script extracts specific IPC-2581 files from consortium zips, flattens them to `test/fixtures/*.xml` (renaming `.cvg` → `.xml`), and cleans up nested directories. When adding new fixtures, always verify the inner zip structure first — many contain nested directories, `.cvg` files, and non-IPC-2581 artifacts (ODB++, Gerbers, drill files).

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

Branch protection requires releases to go through a PR:

1. `git checkout -b release/vX.Y.Z`
2. Update `CHANGELOG.md` with new version section
3. `git commit -am "Add vX.Y.Z changelog"`
4. `npm version patch --no-git-tag-version` (bumps `package.json` only, no tag)
5. `git commit -am "vX.Y.Z"`
6. Push branch and open PR: `git push -u origin release/vX.Y.Z && gh pr create`
7. Merge the PR
8. Tag the merge commit and push:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   **Note:** Do NOT use `npm version` without `--no-git-tag-version` — it creates a local git tag that points to the release branch commit, not the merge commit on main. The tag must be created manually on the merge commit.

The tag push triggers the release workflow, which automatically:
- Builds signed binaries for all platforms
- Creates GitHub Release with binaries
- Publishes to npm via OIDC (no tokens)

## Project Structure

```bash
find src/ scripts/ test/ -type f -not -name '*.js' -not -name '*.map' | sort
```

## Editing Guidelines

- Scratch scripts in `scripts/` are fine for ad-hoc work, but clean them up before finishing — don't leave them behind.

## Adding New Features

### Adding a New Tool

1. Add types in `src/tools/lib/types.ts`
2. Create a new tool file in `src/tools/<tool-name>.ts` (imports from `./lib/` and `./shared.js` only)
3. Register the tool via a `register(server)` export, called from `src/server.ts`
4. Add tests in `src/tools/<tool-name>.test.ts`

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
