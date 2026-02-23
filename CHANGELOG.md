# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
