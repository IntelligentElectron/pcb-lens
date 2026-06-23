# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-23

### Added

- `get_pcb_net` with `detail="full"` now returns a `segments` array of per-trace centerline routing geometry alongside the existing per-via coordinates. Each entry is one `<Polyline>`/`<Line>` conductor primitive: `{ layer, width, points }` (vertices in microns), plus `arcs` carrying full `<PolyStepCurve>` curvature (`index`, `centerX`, `centerY`, `clockwise`) when the trace is curved. The array is stratified across layers and capped at `MAX_COORD_ROWS = 300` with `truncated: true` when sampled; the per-layer `routing` rollup still reports the true Set-level totals. `detail="full"` must be set explicitly — `summary` (the default) output is unchanged and emits no `segments`. Poured `<Contour>` copper has no centerline and is excluded from `segments`; the rollup still reports it routed. `segments.length` is per-primitive and intentionally differs from `totalSegments` / `routing[].segmentCount`, which are Set-level (#55)

### Changed

- `get_pcb_net` reports each trace's own width from its `<LineDescRef>`/`<LineDesc>` rather than a single set-level value, so two `<Line>` (or `<Polyline>`) conductors of differing width inside one `<Set>` keep their distinct widths instead of collapsing to the last descriptor seen; a primitive falls back to the set/feature-level width only when it carries none of its own. The summary `routing[].traceWidths` rollup is tightened the same way and now lists every distinct conductor width a `<Set>` uses. `<PolyStepCurve>` (curved) vertices, previously dropped, are now parsed for the geometry export (#55)

## [1.0.4] - 2026-06-18

### Changed

- `detail="full"` via-row truncation is now stratified across drill spans. When the `MAX_COORD_ROWS = 300` cap applies, the returned rows are apportioned across drill spans in proportion to each span's share of `totalVias` (largest-remainder / Hamilton method) instead of head-slicing the first span, so the truncated sample is representative of the whole net. `truncated: true` and the per-span `viaCounts` totals are unchanged; a span whose proportional share rounds below one row can still get zero sampled rows, but its true count is always preserved in `viaCounts` (#49, #41 follow-up)
- `get_pcb_net` tool description and docs no longer advertise trace widths/lengths/segment counts unconditionally. Routing is read from conductor-layer copper geometry; an IPC-2581 export generated without conductor/etch (cline) feature output carries no conductor geometry, so routing is empty even though pins, vias, and `layersUsed` still populate. The fix on such files is to re-export with conductor features enabled. `<PhyNetPoint>` is documented as a deliberately-unused connection-point set (no edges or width reference), so it is not used to synthesize segment counts, lengths, or widths (#39)

### Added

- An OpenTelemetry integration guide under `docs/`; the README was simplified alongside it (#51)

## [1.0.3] - 2026-06-17

### Fixed

- `get_pcb_net` now reports routing for nets routed as filled copper shapes (`<Contour>`/`<Polygon>`), not just centerline conductors (`<Polyline>`/`<Line>`). Modern Cadence/Allegro pours even short signal traces and all planes as filled copper, so those nets previously returned empty `routing` (only `layersUsed` populated) despite being fully routed. A poured shape is now recorded as routing presence on its layer (the layer plus a per-`<Set>` segment count); a filled shape has no centerline, so `traceWidths`/`traceLength` are left empty rather than fabricated, and a `<Contour>` inside a `<Pad>` is not counted as routing (#39)

### Changed

- The opt-in `detail="full"` coordinate cap is tightened so even a full response stays within a typical tool-response budget (#41 follow-up). The single `MAX_DETAIL_ROWS = 2000` cap was split into `MAX_COORD_ROWS = 300` for the heavy per-coordinate arrays (`viaRows`/`padRows`) and `MAX_PIN_ROWS = 2000` for the connectivity pin list. A `detail="full"` query on the largest net now returns at most 300 coordinate rows (~18 KB) instead of 2000 (~93 KB), with `truncated: true` and the true totals preserved, while high-fanout connectivity (e.g. a 1265-pin GND) is kept under the separate, higher pin cap

## [1.0.2] - 2026-06-17

### Fixed

- `get_pcb_component` no longer reports a wrong `parsed.pinCount` for two-terminal chip passives. The count was derived from the digits after the family prefix in the package name, which for `RES`/`CAP`/`IND`/`INDP` chip parts is the imperial case-size code (so `RES0402` reported `402` instead of `2`). Pin count is now derived authoritatively from pad/net geometry; the package name is trusted only for families where the number genuinely encodes a pin count. `parsed` is also emitted consistently, including when the package name has no trailing digits (#38)
- `get_pcb_component` now returns pad geometry for chip-passive and other footprints that previously came back empty. `extractShapes` handles oval, rounded/chamfered/cornered rectangle, and polygon/contour pad primitives (contours reported by bounding box), and pads can resolve their shape through a `padstackDefRef` when there is no inline primitive (#40)
- `get_pcb_net` now returns trace routing for nets routed with `<Line>` conductor segments, not just `<Polyline>`. Previously a net routed entirely with `<Line>` elements returned no per-layer trace widths, lengths, or segment counts at all (#39)

### Changed

- **Tool responses are now token-bounded, which changes the default output shape** (#41). Per-coordinate arrays are summarized by default so a single query can no longer blow the caller's context:
  - `get_pcb_net` returns a compact `viaCounts` rollup (count per drill type + layer) by default; the raw per-via `viaRows`/`viaColumns` are now returned only with `detail="full"`. The redundant `viaDrills` field was removed — a `viaRows` entry's `drillIndex` references `viaCounts` by position. A `pinCount` total is now included.
  - `get_pcb_component` returns `padCount` + deduped `padShapes` by default; the per-pin `padRows`/`padColumns` are now returned only with `detail="full"`.
  - Both tools accept a new `detail` parameter (`"summary"` default, or `"full"`). Even in `full` mode the raw coordinate arrays are capped and the response is flagged `truncated: true`, so no response can exceed a safe size.

## [1.0.1] - 2026-06-17

### Fixed

- Documentation now matches the registered tool names. Five tool docs were renamed and rewritten field-by-field against the actual schemas and result types: `export_cadence_board` → `export_cadence_ipc2581`, `get_design_overview` → `get_pcb_metadata`, `query_components` → `get_pcb_component`, `query_net` → `get_pcb_net`, `query_constraints` → `get_constraints`. Corrected drifted response schemas (notably `get_pcb_net` via geometry and `get_pcb_component` lookup model) and error strings, and updated both README indexes
- Removed the `render_net` reference from the server's MCP instructions, since that tool is not registered (it remains dormant in source)

## [1.0.0] - 2026-06-17

First stable release.

### Added

- OpenTelemetry instrumentation: every tool call emits a span (`tool/<tool_name>`), metrics (`tool.calls`, `tool.duration`, `tool.errors`), and a structured log correlated by trace/span id, exported to any OTLP-compatible backend purely via the standard `OTEL_*` environment variables. Disabled and zero-overhead unless an OTLP endpoint is configured
- `enduser.id` resource attribute set from the host OS account name, attributing telemetry to the per-session user across traces, metrics, and logs
- Opt-in raw tool-argument capture on spans via `OTEL_CAPTURE_TOOL_ARGS=1` (off by default)

### Changed

- Consolidated telemetry into `src/telemetry/`: local JSONL usage analytics (`local`) and OpenTelemetry (`otel`) behind a single barrel

### Fixed

- Self-update now runs only for the compiled standalone binary; running from source (tsx/node) no longer performs a GitHub update check or re-execs into a downloaded binary

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
