/**
 * PCB Lens MCP Server
 *
 * Model Context Protocol server for querying IPC-2581 PCB layout files.
 * Supports Cadence Allegro designs exported as IPC-2581 XML.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "./version.js";
import { getDesignOverview, queryComponents, queryNet } from "./service.js";

// =============================================================================
// Server Instructions
// =============================================================================

const SERVER_INSTRUCTIONS = `
# PCB Lens MCP Server

This server provides tools to query IPC-2581 PCB layout files for physical design review.
Supports Cadence Allegro designs exported as IPC-2581 XML (RevA, RevB, RevC).

## Workflow Guidance

1. Use \`get_design_overview\` first to understand the design structure, layer stackup, and size
2. Use \`query_components\` to find component placements by refdes pattern (regex)
3. Use \`query_net\` to trace a net's routing, trace widths, vias, and connected pins

## Tool Usage Tips

- All tools accept an IPC-2581 XML file path as the first argument
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
// Helper Functions
// =============================================================================

/**
 * Format a result as MCP tool response content.
 */
const formatResult = (result: unknown): { content: { type: "text"; text: string }[] } => ({
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
});

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

  // -------------------------------------------------------------------------
  // Tool: get_design_overview
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_design_overview",
    {
      description:
        "Get an overview of an IPC-2581 PCB design file: metadata, layer stackup, component/net counts, and section sizes",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
      },
    },
    async ({ file }) => {
      const result = await getDesignOverview(file);
      return formatResult(result);
    }
  );

  // -------------------------------------------------------------------------
  // Tool: query_components
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_components",
    {
      description:
        "Find components by refdes pattern in an IPC-2581 file. Returns placement coordinates, rotation, layer, package, and BOM data.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        pattern: z
          .string()
          .describe("Regex pattern for component refdes (e.g., '^U1$', '^C\\\\d+', 'R10[0-9]')"),
      },
    },
    async ({ file, pattern }) => {
      const result = await queryComponents(file, pattern);
      return formatResult(result);
    }
  );

  // -------------------------------------------------------------------------
  // Tool: query_net
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_net",
    {
      description:
        "Query a net by name pattern in an IPC-2581 file. Returns connected pins, routing per layer (trace widths, segment counts), and via information.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        pattern: z
          .string()
          .describe("Regex pattern for net name (e.g., '^DDR_D0$', 'CLK', '^VCC_3V3$')"),
      },
    },
    async ({ file, pattern }) => {
      const result = await queryNet(file, pattern);
      return formatResult(result);
    }
  );

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
