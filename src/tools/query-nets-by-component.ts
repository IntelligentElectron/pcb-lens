import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ComponentNetSummary, ErrorResult, QueryNetsByComponentResult } from "./lib/types.js";
import { attr, streamAllLines } from "./lib/xml-utils.js";
import { formatResult, validateFile } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

const GROUND_PATTERN = /^(A?D?GND\d*|VSS\w*)$/i;

export const queryNetsByComponent = async (
  filePath: string,
  refdes: string,
  includeGround = false
): Promise<QueryNetsByComponentResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (!refdes || refdes.length > 200) {
    return { error: "refdes must be 1-200 characters" };
  }

  // Single pass: scan LogicalNet sections, collect nets that reference this component.
  const netPinCounts = new Map<string, number>();
  let insideLogicalNet = false;
  let currentNetName = "";
  let currentNetHasComponent = false;
  let currentNetPinCount = 0;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<LogicalNet ")) {
      const name = attr(line, "name");
      insideLogicalNet = Boolean(name);
      currentNetName = name ?? "";
      currentNetHasComponent = false;
      currentNetPinCount = 0;
    }

    if (insideLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        if (compRef) {
          currentNetPinCount++;
          if (compRef === refdes) {
            currentNetHasComponent = true;
          }
        }
      }
      if (line.includes("</LogicalNet>")) {
        if (currentNetHasComponent && currentNetName) {
          netPinCounts.set(currentNetName, currentNetPinCount);
        }
        insideLogicalNet = false;
      }
    }

    // Stop once we're past the net sections
    if (line.includes("<Step>") || line.includes("<LayerFeature")) return false;
  });

  // Filter out ground nets unless include_ground is true
  if (!includeGround) {
    for (const netName of [...netPinCounts.keys()]) {
      if (GROUND_PATTERN.test(netName)) {
        netPinCounts.delete(netName);
      }
    }
  }

  const nets: ComponentNetSummary[] = [...netPinCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([netName, pinCount]) => ({ netName, pinCount }));

  return { refdes, includeGround, nets };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "query_nets_by_component",
    {
      description:
        "List all nets connected to a component. Returns net names and pin counts. Use query_net on specific nets for full routing details. Ground nets excluded by default.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        refdes: z.string().describe("Exact component refdes (e.g., 'U1', 'R15')"),
        include_ground: z
          .boolean()
          .default(false)
          .describe("Include ground nets (GND, AGND, DGND, VSS, etc.). Default: false"),
      },
    },
    withTelemetry("query_nets_by_component", async ({ file, refdes, include_ground }) => {
      const result = await queryNetsByComponent(file, refdes, include_ground);
      return formatResult(result);
    })
  );
};
