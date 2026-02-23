# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-02-23

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
