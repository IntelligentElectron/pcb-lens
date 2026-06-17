# IPC-2581 Layout Review — Research & Prototype Plan

**Status:** Reference — original prototype plan; validated and now realized by the current
pcb-lens tools
**Date:** early 2026 (original) · reviewed 2026-06-17
**Goal:** Validate that IPC-2581 RevC XML is navigable enough for LLM-driven PCB layout review
with thin extraction tooling, and decide where tooling is actually needed.

## Bottom line

IPC-2581 RevC is navigable enough for LLM-driven layout review: a small set of thin
extraction tools over the XML (metadata, component, net, constraints) is sufficient — which is
what the current pcb-lens MCP tools implement. This document is kept as the original design
input. For reading Cadence Allegro `.brd` *directly* (without the IPC-2581 export), see
[allegro-brd-direct-read.md](allegro-brd-direct-read.md).

## Context

We want to enable LLM-driven PCB layout review for Cadence Allegro designs. The netlist MCP server already handles schematic connectivity; this would add the physical layout dimension — component placement, footprints, traces, planes, spacing, etc.

Rather than building tools upfront, we first need to validate whether IPC-2581 XML is navigable enough with basic tools (Read, Grep, Bash) that an LLM can reason about layout data directly, and identify where thin extraction tooling is actually needed.

## Why IPC-2581

- Cadence Allegro `.brd` files are proprietary binary — not parseable without reverse-engineering
- IPC-2581 is an industry-standard XML export that Allegro supports natively (File → Export → IPC2581)
- Single XML file containing all layout data: placement, routing, stackup, footprints, vias, copper pours
- RevC (latest) is the most comprehensive — supports rigid-flex, embedded components, 3D thermal data
- Export is a one-time manual step (or automatable via Allegro CLI, like we do with `export_cadence_netlist`)

## Prototype Steps

### 1. Get a sample IPC-2581 RevC XML

- Export from Cadence Allegro: File → Export → IPC2581, select RevC, millimeters
- Place in test fixtures of the new codebase
- Optionally download IPC-2581 Consortium test case (BeagleBone Black) as second data point:
  `https://www.ipc2581.com/b-test-cases/` or RevC cases from `https://www.ipc2581.com/ipc-2581-revc-test-cases/`

### 2. Assess file size and structure

- Check raw XML file size — determines if Read tool can handle sections
- Read first ~200 lines to map top-level elements (Content, Ecad, Bom, etc.)
- Count lines per major section with grep to understand data distribution
- Note how cross-references work (packageRef, layerRef, padstackRef)

### 3. Test real layout review queries with raw tools

| # | Query | Tests |
|---|-------|-------|
| 1 | "Where is U1 placed?" | Grep refdes → read coordinates, rotation, layer |
| 2 | "What's the layer stackup?" | Find Stackup section → read layer order, materials, thicknesses |
| 3 | "What traces are on net DDR_D0?" | Follow net routing across LayerFeature sections |
| 4 | "What's the footprint of C1?" | Resolve packageRef → read pad geometry |
| 5 | "List all components on bottom layer" | Filter by layer/side/mountType attributes |
| 6 | "What via types are used?" | Find padstack definitions for vias |
| 7 | "Trace widths on a high-speed net" | Extract LineDesc width attributes for a specific net |

For each query, document:
- Did it work with raw tools? How many steps?
- What cross-references needed chasing?
- Was the output LLM-digestible or too verbose?

### 4. Decide on tooling

Based on results, determine:
- Which queries work raw → no tool needed
- Which queries need a thin extraction tool → define inputs/outputs
- Whether file size requires chunked access tooling
- Minimum viable tool set for useful layout review

## Separate Codebase

This will be a new project, separate from the netlist MCP server. The netlist server handles schematic connectivity; this handles physical layout. They can cross-reference each other (same refdes/net names) but are architecturally independent.

## References

- [IPC-2581 Consortium](http://www.ipc2581.com/) — test cases, spec info
- [OpenAllegroParser](https://github.com/Werni2A/OpenAllegroParser) — early FOSS Allegro parser. **Note:** never implemented a `.brd` parser (only `.pad`) and is archived (2022); not a viable path. For reading `.brd` directly, see [allegro-brd-direct-read.md](allegro-brd-direct-read.md) (KiCad 10's `pcbnew` importer).
- [boardui](https://github.com/midub/boardui) — IPC-2581 web viewer with parser package
- [Cadence IPC-2581 Export Guide](https://community.cadence.com/cadence_blogs_8/b/pcb/posts/ipc-2581-pcb)
- [Sierra Circuits: How to Export IPC-2581](https://www.protoexpress.com/kb/how-to-export-and-get-started-with-ipc-2581/)
