# CLAUDE.md - PCB Lens MCP Server

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
src/
  index.ts              # Entry point, CLI handling
  server.ts             # MCP server setup, tool registration
  service.ts            # Tool implementations (streaming XML queries)
  types.ts              # TypeScript types and interfaces
  version.ts            # Version constant
  xml-utils.ts          # Streaming XML parsing utilities
  cli/
    commands.ts         # CLI command handlers
    updater.ts          # Auto-update logic
    prompts.ts          # User interaction utilities
    shell.ts            # Shell rc file manipulation
scripts/
  download-fixtures.sh  # Download IPC-2581 test fixtures
test/
  fixtures/             # IPC-2581 XML test files (gitignored)
  integration/          # Integration tests against fixtures
```

## Editing Guidelines

- A post-edit hook runs `tsc --noEmit` and `eslint` after every `Edit`. When refactoring touches multiple call sites (e.g., renaming a function), use `Write` to rewrite the whole file at once instead of incremental `Edit` calls that leave intermediate broken states.
- Scratch scripts in `scripts/` are fine for ad-hoc work, but clean them up before finishing — don't leave them behind.

## Adding New Features

### Adding a New Tool

1. Add types in `src/types.ts`
2. Add the service function in `src/service.ts`
3. Register the tool in `src/server.ts` using `server.registerTool()`
4. Add tests in `src/service.test.ts`

## Key Concepts

### IPC-2581 XML Structure

IPC-2581 is an industry-standard XML format for PCB layout data. Key sections:

- **Content**: Dictionaries (line descriptors, pad shapes, colors)
- **LogisticHeader**: File metadata
- **Bom**: Bill of materials
- **Ecad/CadData**: Layer definitions, padstack definitions, package/footprint definitions
- **Component** (under Step): Component placement (x/y, rotation, layer)
- **PhyNet**: Physical net connectivity (pin connections)
- **LayerFeature**: Routing data (traces, vias, copper pours)

### Units

All tool responses normalize physical values (coordinates, trace widths) to **microns**, regardless of the source file's native unit (`MICRON`, `MILLIMETER`, `INCH`). The conversion factor is extracted from `<CadHeader units="...">`. Do not assume or describe values in mils, mm, or inches — they are always microns.

### Streaming Parser

Files can be 14MB+ (300K+ lines). The parser uses Node.js readline streaming with regex
attribute extraction instead of DOM/SAX parsing. This avoids loading the entire file into memory.

Core utilities in `src/xml-utils.ts`:
- `attr(line, name)` — extract XML attribute by regex
- `numAttr(line, name)` — extract numeric attribute
- `streamAllLines(filePath, handler)` — stream every line

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
