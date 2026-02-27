# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2026-02-27

### Added

- `export_cadence_constraints` tool for exporting Cadence `.brd` constraint data to `.tcfx` XML (Windows only)
- `query_constraints` tool for parsing `.tcfx` files: overview mode (section names, object counts) and section query mode (constraint objects with attributes, references, members, cross-section stackup)
- Shared Cadence utilities module (`src/tools/lib/cadence.ts`) with install detection, license mutex, and platform guard

### Changed

- Refactored `export_cadence_board` to use shared Cadence utilities, ensuring a single mutex across all Cadence export tools
- Enforced strict module hierarchy: tool files import only from `./lib/` and `./shared.js`, no peer imports

### Removed

- Claude Code Review and Claude CI/CD GitHub workflows

## [0.0.4] - 2026-02-24

### Removed

- `--no-update` CLI flag: auto-update now always runs on startup

## [0.0.3] - 2026-02-23

### Fixed

- **`export_cadence_board` always failed**: command passed `-i` flag which `ipc2581_out.exe` does not accept. Board path is now passed as a positional argument. ([#9](https://github.com/IntelligentElectron/pcb-lens/issues/9))

## [0.0.2] - 2026-02-23

### Added

- `export_cadence_board` tool for automated IPC-2581 XML export from Cadence Allegro .brd files (Windows only)
- Cadence SPB auto-detection with version sorting
- Mutex-serialized export calls to avoid Cadence license conflicts
- Support for IPC-2581 Rev B (1.03) and Rev C (1.04) export formats
- WASM embedding support for compiled Bun binaries

## [0.0.1] - 2026-02-23

### Fixed

- Replace `@resvg/resvg-js` (native napi-rs addon) with `@resvg/resvg-wasm` to fix macOS code signing error (`dlopen` failure) when running as a compiled Bun binary

### Added

- Initial project scaffold with MCP server skeleton
- `get_design_overview` tool for IPC-2581 file metadata and structure
- `query_components` tool for component placement and BOM lookup
- `query_net` tool for net routing, trace widths, and via analysis
- `render_net` tool for SVG-to-PNG net visualization
- Streaming XML parser for large IPC-2581 files (no DOM loading)
- Test fixture download script for IPC-2581 consortium samples
- Release automation with CI workflows and binary compilation
- Integration tests against IPC-2581 consortium fixtures

[0.0.5]: https://github.com/IntelligentElectron/pcb-lens/releases/tag/v0.0.5
[0.0.4]: https://github.com/IntelligentElectron/pcb-lens/releases/tag/v0.0.4
[0.0.3]: https://github.com/IntelligentElectron/pcb-lens/releases/tag/v0.0.3
[0.0.2]: https://github.com/IntelligentElectron/pcb-lens/releases/tag/v0.0.2
[0.0.1]: https://github.com/IntelligentElectron/pcb-lens/releases/tag/v0.0.1
