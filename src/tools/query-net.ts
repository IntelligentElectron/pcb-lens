import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ErrorResult, NetPin, NetRouteInfo, NetViaInfo, QueryNetResult } from "./lib/types.js";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import {
  buildLineDescDict,
  extractMicronFactor,
  formatResult,
  validateFile,
  validatePattern,
} from "./shared.js";

export const queryNet = async (
  filePath: string,
  pattern: string
): Promise<QueryNetResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Find matching net name from PhyNet section
  let matchedNetName: string | null = null;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        if (!matchedNetName) matchedNetName = name;
        return false;
      }
    }
  });

  if (!matchedNetName) {
    return { error: `No net matching pattern '${pattern}' found` };
  }

  // Pass 2: Build LineDesc dictionary (for resolving trace widths)
  const lineDescDict = await buildLineDescDict(filePath);

  // Pass 3: Single pass through LayerFeature sections.
  // Collect pins, routing, and vias for the matched net.
  const pins: NetPin[] = [];
  const pinsSeen = new Set<string>();
  const routeMap = new Map<string, { widths: Set<number>; segments: number }>();
  const viaMap = new Map<string, number>();
  const skipLayers = new Set(["REF-route", "REF-both"]);

  let currentLayerName = "";
  let insideMatchedSet = false;
  let currentSetHasPolyline = false;
  let currentSetLineDescId: string | undefined;
  let currentSetInlineWidth: number | undefined;
  let currentSetGeometry: string | undefined;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<LayerFeature ")) {
      currentLayerName = attr(line, "layerRef") ?? "";
    }

    if (line.includes("<Set ")) {
      const netName = attr(line, "net");
      insideMatchedSet = netName === matchedNetName && !skipLayers.has(currentLayerName);
      currentSetHasPolyline = false;
      currentSetLineDescId = undefined;
      currentSetInlineWidth = undefined;
      currentSetGeometry = attr(line, "geometry");
    }

    if (insideMatchedSet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          const key = `${compRef}.${pin}`;
          if (!pinsSeen.has(key)) {
            pinsSeen.add(key);
            pins.push({ refdes: compRef, pin });
          }
        }
      }

      if (line.includes("<Polyline")) {
        currentSetHasPolyline = true;
      }

      if (line.includes("<LineDescRef ")) {
        currentSetLineDescId = attr(line, "id");
      }

      if (line.includes("<LineDesc ") && !line.includes("<EntryLineDesc ")) {
        const inlineWidth = numAttr(line, "lineWidth");
        if (inlineWidth !== undefined) {
          currentSetInlineWidth = inlineWidth;
        }
      }

      if (line.includes("<Hole ")) {
        const platingStatus = attr(line, "platingStatus");
        if (platingStatus === "VIA") {
          const diameter = numAttr(line, "diameter");
          const key = currentSetGeometry ?? `dia_${diameter ?? "unknown"}`;
          viaMap.set(key, (viaMap.get(key) ?? 0) + 1);
        }
      }

      if (line.includes("</Set>")) {
        if (currentSetHasPolyline && currentLayerName) {
          if (!routeMap.has(currentLayerName)) {
            routeMap.set(currentLayerName, { widths: new Set(), segments: 0 });
          }
          const layerRoute = routeMap.get(currentLayerName)!;
          layerRoute.segments++;

          if (currentSetLineDescId) {
            const width = lineDescDict.get(currentSetLineDescId);
            if (width !== undefined) {
              layerRoute.widths.add(width * factor);
            }
          } else if (currentSetInlineWidth !== undefined) {
            layerRoute.widths.add(currentSetInlineWidth * factor);
          }
        }

        insideMatchedSet = false;
      }
    }
  });

  const routing: NetRouteInfo[] = [];
  for (const [layerName, data] of routeMap) {
    routing.push({
      layerName,
      traceWidths: [...data.widths].sort((a, b) => a - b),
      segmentCount: data.segments,
    });
  }

  const vias: NetViaInfo[] = [];
  for (const [padstackRef, count] of viaMap) {
    vias.push({ padstackRef, count });
  }

  const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
  const totalVias = vias.reduce((sum, v) => sum + v.count, 0);
  const layersUsed = routing.map((r) => r.layerName).sort();

  return {
    netName: matchedNetName,
    units: "MICRON",
    pins,
    routing,
    vias,
    totalSegments,
    totalVias,
    layersUsed,
  };
};

export const register = (server: McpServer): void => {
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
};
