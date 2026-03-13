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
import { register as registerGetPcbMetadata } from "./tools/get-pcb-metadata.js";
import { register as registerGetPcbComponent } from "./tools/get-pcb-component.js";
import { register as registerGetPcbNet } from "./tools/get-pcb-net.js";
import { register as registerExportCadenceIpc2581 } from "./tools/export-cadence-ipc2581.js";
import { register as registerExportCadenceConstraints } from "./tools/export-cadence-constraints.js";
import { register as registerGetConstraints } from "./tools/get-constraints.js";

// =============================================================================
// Server Instructions
// =============================================================================

const SERVER_INSTRUCTIONS = `
# PCB Lens MCP Server

This server provides tools to query IPC-2581 PCB layout files for physical design review.
Supports IPC-2581 XML files (RevA, RevB, RevC) exported from any compliant EDA tool.

## Workflow Guidance

1. If starting from a Cadence Allegro .brd file, use \`export_cadence_ipc2581\` to generate the IPC-2581 XML first (Windows only)
2. To access design constraints (trace width rules, spacing rules, net classes, stackup), use \`export_cadence_constraints\` to generate a .tcfx file, then \`get_constraints\` to read it
3. Use \`get_pcb_metadata\` first to understand the design structure, layer stackup, and size
4. Use \`get_pcb_component\` to look up a single component by exact refdes
5. Use \`get_pcb_net\` to trace a net's routing, trace widths, vias, and connected pins
6. Use \`render_net\` to visualize a net's routing geometry as SVG

## Tool Usage Tips

- All query/render tools accept an IPC-2581 XML file path as the first argument
- Component refdes is an exact match (e.g., "U5", "C10", "R22")
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

  registerGetPcbMetadata(server);
  registerGetPcbComponent(server);
  registerGetPcbNet(server);
  registerExportCadenceIpc2581(server);
  registerExportCadenceConstraints(server);
  registerGetConstraints(server);
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
