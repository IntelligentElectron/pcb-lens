/**
 * PCB Lens MCP Server
 *
 * Model Context Protocol server for querying IPC-2581 PCB layout files.
 * Supports any EDA tool that exports IPC-2581 XML.
 */

import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./cli/version.js";
import { initTelemetry } from "./telemetry.js";
import { register as registerGetDesignOverview } from "./tools/get-design-overview.js";
import { register as registerQueryComponents } from "./tools/query-components.js";
import { register as registerQueryNet } from "./tools/query-net.js";
import { register as registerQueryNetsByComponent } from "./tools/query-nets-by-component.js";
import { register as registerQueryViaInPad } from "./tools/query-via-in-pad.js";
import { register as registerExportCadenceBoard } from "./tools/export-cadence-board.js";
import { register as registerExportCadenceConstraints } from "./tools/export-cadence-constraints.js";
import { register as registerQueryConstraints } from "./tools/query-constraints.js";

// =============================================================================
// Server Instructions
// =============================================================================

const SERVER_INSTRUCTIONS = `
# PCB Lens MCP Server

This server provides tools to query IPC-2581 PCB layout files for physical design review.
Supports IPC-2581 XML files (RevA, RevB, RevC) exported from any compliant EDA tool.

## Workflow Guidance

1. If starting from a Cadence Allegro .brd file, use \`export_cadence_board\` to generate the IPC-2581 XML first (Windows only)
2. To access design constraints (trace width rules, spacing rules, net classes, stackup), use \`export_cadence_constraints\` to generate a .tcfx file, then \`query_constraints\` to read it
3. Use \`get_design_overview\` first to understand the design structure, layer stackup, and size
4. Use \`query_components\` to find component placements by refdes pattern (regex)
5. Use \`query_net\` to trace a net's routing, trace widths, vias, and connected pins
6. Use \`query_nets_by_component\` to get all nets connected to a component
7. Use \`render_net\` to visualize a net's routing geometry as SVG

## Tool Usage Tips

- All query/render tools accept an IPC-2581 XML file path as the first argument
- Component refdes patterns use regex (e.g., "^U\\\\d+" for all ICs, "^C1$" for exact match)
- Net name patterns use regex (e.g., "DDR_D0", "^VCC", "CLK")
- All physical values (coordinates, trace widths) are normalized to microns regardless of the source file's native unit
- Rotation is in degrees counterclockwise

## Error Handling

Results with an \`error\` field indicate a problem:
- File not found: Check the file path
- No matches: Try a broader regex pattern
- Invalid regex: Check pattern syntax
`.trim();

// =============================================================================
// Server Setup
// =============================================================================

/**
 * Create and configure the MCP server.
 */
export const createServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "pcb-lens-mcp-server",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  registerGetDesignOverview(server);
  registerQueryComponents(server);
  registerQueryNet(server);
  registerQueryNetsByComponent(server);
  registerQueryViaInPad(server);
  registerExportCadenceBoard(server);
  registerExportCadenceConstraints(server);
  registerQueryConstraints(server);
  // TODO: register render-net once PNG output via resvg-wasm is stable in compiled binaries

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  initTelemetry(crypto.randomUUID());
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
