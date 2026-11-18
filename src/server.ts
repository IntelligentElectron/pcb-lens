/**
 * PCB Lens MCP Server
 *
 * Model Context Protocol server for querying PCB layouts: IPC-2581 XML from any EDA tool, and
 * Cadence Allegro .brd boards read directly.
 */

import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./cli/version.js";
import { initTelemetry, initOtel, withTelemetry } from "./telemetry/index.js";
import { TOOLS } from "./tools/index.js";
import { formatResult } from "./tools/shared.js";

// =============================================================================
// Server Instructions
// =============================================================================

const SERVER_INSTRUCTIONS = `
# PCB Lens MCP Server

This server provides tools to query PCB layouts for physical design review.
Supports IPC-2581 XML files (RevA, RevB, RevC) exported from any compliant EDA tool, and Cadence Allegro 16.x and 17.x .brd boards, read directly.

## Workflow Guidance

1. A Cadence Allegro 16.x or 17.x .brd file can be passed straight to the query tools; \`export_cadence_ipc2581\` (Windows only) is needed only for other Allegro versions
2. To access design constraints (trace width rules, spacing rules, net classes, stackup), call \`get_constraints\` on the .brd or .dcf file directly; \`export_cadence_constraints\` (Windows) produces a .tcfx file it also reads
3. Use \`get_pcb_metadata\` first to understand the design structure, layer stackup, and size
4. Use \`get_pcb_component\` to look up a single component by exact refdes
5. Use \`get_pcb_net\` to trace a net's routing, trace widths, vias, and connected pins

## Tool Usage Tips

- All query tools accept an IPC-2581 XML or Allegro .brd file path as the first argument
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

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      withTelemetry(tool.name, async (args: Record<string, unknown>) =>
        formatResult(await tool.run(args))
      )
    );
  }
  // TODO: register render-net once PNG output via resvg-wasm is stable in compiled binaries

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  initTelemetry(crypto.randomUUID());
  // Opt-in OpenTelemetry (no-op unless OTEL_* env is configured).
  await initOtel({ serviceName: "pcb-lens", serviceVersion: VERSION });
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
