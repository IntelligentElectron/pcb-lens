# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-13

### Added

- Per-pin pad geometry in `get_pcb_component` output (positions and shapes with deduplication)
- Net connectivity in `get_pcb_component` output (connected nets with pin names and total pin counts)
- Structured package parsing from Cadence footprint naming (packageFamily, pinCount, bodySize_mm, pitch_mm)
- Shared geometry extraction module (`lib/geometry.ts`) for pad, shape, and via utilities

### Changed

- Renamed `get_pcb_components` to `get_pcb_component`: single exact-refdes lookup instead of regex multi-match
- Switched pads to columnar format with deduplicated shapes (`padShapes[]` + `padRows[]` of `[pin, x, y, shapeIndex]`)
- Switched component nets to columnar format (`netColumns` + `netRows[]` of `[netName, pins, pinCount]`)
- Switched vias in `get_pcb_net` to columnar format with deduplicated drill types (`viaDrills[]` + `viaRows[]` of `[x, y, drillIndex]`)
- Rounded all micron coordinate and dimension values to integers

## [0.0.10] - 2026-03-03

### Changed

- CLI `update` command no longer prompts for confirmation before installing
- Moved internal architecture docs from CLAUDE.md into source files as inline comments

## [0.0.9] - 2026-03-01

### Added

- Library exports for programmatic use from TypeScript codebases (`@intelligentelectron/pcb-lens/service`)
- New `src/service.ts` barrel file re-exporting all tool functions and public types
- Package `exports` map with `./service` and `./types` subpath entry points

## [0.0.8] - 2026-02-27

### Changed

- `query_net` now groups pin connectivity by component refdes (`pins: { [refdes]: string[] }`) to reduce payload size
- `query_net` now omits empty routing/via arrays and zero-value summary fields (`totalSegments`, `totalVias`)
- `query_net` now rejects patterns that match all nets and directs callers to `get_design_overview` for discovery

## [0.0.7] - 2026-02-27

### Fixed

- `query_net` now extracts pins from `<LogicalNet>` sections instead of only `<LayerFeature>/<Set>`, which returned empty pin arrays
- `query_net` now extracts layer usage from `<PhyNetPoint>` sections, fixing empty `layersUsed` for nets without routing segments
- `query_net` now returns all nets matching the regex pattern instead of only the first match

### Changed

- `query_net` return type changed from single `QueryNetResult` to `QueryNetsResult` wrapper with `pattern`, `units`, and `matches` array (consistent with `query_components`)
- Non-matching patterns now return `{ matches: [] }` instead of an error

## [0.0.6] - 2026-02-27

### Added

- Local JSONL telemetry for usage analytics (session info and tool invocations, local-only, fire-and-forget)
- `--export-telemetry` CLI flag to export telemetry data as a zip file
- API documentation in `docs/` (tool reference, response schemas, guides)

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
