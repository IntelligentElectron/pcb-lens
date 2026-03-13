import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ComponentNetSummary, ErrorResult, QueryNetsByComponentResult } from "./lib/types.js";
import { attr, streamAllLines } from "./lib/xml-utils.js";
import { formatResult, validateFile } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

export const queryNetsByComponent = async (
  filePath: string,
  refdes: string
): Promise<QueryNetsByComponentResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (!refdes || refdes.length > 200) {
    return { error: "refdes must be 1-200 characters" };
  }

  // Single pass: scan LogicalNet sections, collect nets that reference this component.
  const netData = new Map<string, { pinCount: number; componentPins: string[] }>();
  let insideLogicalNet = false;
  let currentNetName = "";
  let currentNetPinCount = 0;
  let currentComponentPins: string[] = [];

  await streamAllLines(filePath, (line) => {
    if (line.includes("<LogicalNet ")) {
      const name = attr(line, "name");
      insideLogicalNet = Boolean(name);
      currentNetName = name ?? "";
      currentNetPinCount = 0;
      currentComponentPins = [];
    }

    if (insideLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          currentNetPinCount++;
          if (compRef === refdes) {
            currentComponentPins.push(pin);
          }
        }
      }
      if (line.includes("</LogicalNet>")) {
        if (currentComponentPins.length > 0 && currentNetName) {
          netData.set(currentNetName, {
            pinCount: currentNetPinCount,
            componentPins: currentComponentPins.sort((a, b) =>
              a.localeCompare(b, undefined, { numeric: true })
            ),
          });
        }
        insideLogicalNet = false;
      }
    }

    // Stop once we're past the net sections
    if (line.includes("<Step>") || line.includes("<LayerFeature")) return false;
  });

  const nets: ComponentNetSummary[] = [...netData.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([netName, data]) => ({ netName, pins: data.componentPins, pinCount: data.pinCount }));

  return { refdes, nets };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "query_nets_by_component",
    {
      description:
        "List all nets connected to a component. Returns net names, the component's pin names on each net, and total pin count per net. Use query_net on specific nets for full routing details.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        refdes: z.string().describe("Exact component refdes (e.g., 'U1', 'R15')"),
      },
    },
    withTelemetry("query_nets_by_component", async ({ file, refdes }) => {
      const result = await queryNetsByComponent(file, refdes);
      return formatResult(result);
    })
  );
};
