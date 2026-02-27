# API Documentation

## Overview

The PCB Lens MCP Server provides tools for querying IPC-2581 PCB layout files through any MCP-compatible AI assistant. Once configured, you can ask your AI assistant to analyze board layouts, find components, trace nets, inspect routing, and review design constraints.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| IPC-2581 XML | `.xml` | Industry-standard PCB layout format (RevA, RevB, RevC) from any compliant EDA tool |
| Cadence TCFX | `.tcfx` | Constraint XML exported from Cadence Allegro `.brd` files |
| Cadence Allegro | `.brd` | Native board files (Windows only, requires Cadence SPB installation) |

## Design Philosophy

### Simple Tools, Smart LLM

Each tool has a single, focused responsibility. Complex reasoning (comparing layouts, flagging DRC violations, reviewing stackups) is offloaded to the LLM rather than embedded in tool logic. This keeps tools predictable and debuggable while allowing the AI to combine them creatively.

### Streaming Parser

IPC-2581 files can be 14MB+ (300K+ lines). All tools use Node.js readline streaming with regex attribute extraction instead of DOM/SAX parsing. This avoids loading the entire file into memory and keeps response times fast.

### Micron-Normalized Output

All physical values (coordinates, trace widths) are normalized to **microns**, regardless of the source file's native unit (MICRON, MILLIMETER, INCH). Responses always include `"units": "MICRON"` so the LLM knows the scale without guessing.

## Available Tools

| Tool | Description |
|------|-------------|
| [`get_design_overview`](tools/get_design_overview.md) | Get metadata, layer stackup, component/net counts, and section sizes for an IPC-2581 file |
| [`query_components`](tools/query_components.md) | Find components by refdes pattern with placement coordinates and BOM data |
| [`query_net`](tools/query_net.md) | Query a net by name pattern for pin connections, routing per layer, and via info |
| [`query_constraints`](tools/query_constraints.md) | Query layout constraints from a Cadence `.tcfx` file |
| [`export_cadence_board`](tools/export_cadence_board.md) | Export a Cadence Allegro `.brd` file to IPC-2581 XML (Windows only) |
| [`export_cadence_constraints`](tools/export_cadence_constraints.md) | Export a Cadence Allegro `.brd` file to `.tcfx` constraint XML (Windows only) |

## Example Queries

Once configured, you can ask your AI assistant questions like:

- "Give me an overview of this IPC-2581 file"
- "Find all bypass capacitors near U1"
- "Show me the routing for the DDR_CLK net"
- "What trace widths are used on the VCC_3V3 power net?"
- "List the constraint rules in PhysicalCSet"
- "Export this Allegro board to IPC-2581"

## Tool Documentation

See the [tools/](tools/) directory for detailed documentation on each tool's parameters and response format.

## Error Handling

All tools return an `ErrorResult` on failure:

```json
{
  "error": "Descriptive error message"
}
```

Common error conditions:

- **File not found** - The specified file path does not exist
- **Invalid regex** - The pattern parameter contains invalid regex syntax
- **Platform restriction** - Cadence export tools require Windows
- **Missing installation** - Cadence export tools require a Cadence SPB installation
