import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ErrorResult,
  NetPin,
  NetRouteInfo,
  NetViaInfo,
  QueryNetsResult,
} from "./lib/types.js";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import {
  buildLineDescDict,
  extractMicronFactor,
  formatResult,
  validateFile,
  validatePattern,
} from "./shared.js";
import { withTelemetry } from "../telemetry.js";

interface NetAccumulator {
  pins: NetPin[];
  pinsSeen: Set<string>;
  phyNetLayers: Set<string>;
  routeMap: Map<string, { widths: Set<number>; segments: number }>;
  viaMap: Map<string, number>;
}

const makeAccumulator = (): NetAccumulator => ({
  pins: [],
  pinsSeen: new Set(),
  phyNetLayers: new Set(),
  routeMap: new Map(),
  viaMap: new Map(),
});

const addPin = (acc: NetAccumulator, refdes: string, pin: string): void => {
  const key = `${refdes}.${pin}`;
  if (!acc.pinsSeen.has(key)) {
    acc.pinsSeen.add(key);
    acc.pins.push({ refdes, pin });
  }
};

export const queryNet = async (
  filePath: string,
  pattern: string
): Promise<QueryNetsResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Discover matching nets from LogicalNet + PhyNet sections,
  // extract pins from LogicalNet, extract layers from PhyNetPoint.
  const accumulators = new Map<string, NetAccumulator>();
  let insideMatchedLogicalNet = false;
  let insideMatchedPhyNet = false;
  let currentLogicalNetName = "";
  let currentPhyNetName = "";

  await streamAllLines(filePath, (line) => {
    // Stop once we reach LayerFeature (Pass 3 handles that)
    if (line.includes("<LayerFeature")) return false;

    // LogicalNet pin extraction
    if (line.includes("<LogicalNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        insideMatchedLogicalNet = true;
        currentLogicalNetName = name;
        if (!accumulators.has(name)) accumulators.set(name, makeAccumulator());
      } else {
        insideMatchedLogicalNet = false;
      }
    }

    if (insideMatchedLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          addPin(accumulators.get(currentLogicalNetName)!, compRef, pin);
        }
      }
      if (line.includes("</LogicalNet>")) {
        insideMatchedLogicalNet = false;
      }
    }

    // PhyNet layer extraction
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        insideMatchedPhyNet = true;
        currentPhyNetName = name;
        if (!accumulators.has(name)) accumulators.set(name, makeAccumulator());
      } else {
        insideMatchedPhyNet = false;
      }
    }

    if (insideMatchedPhyNet) {
      if (line.includes("<PhyNetPoint ")) {
        const layerRef = attr(line, "layerRef");
        if (layerRef) {
          accumulators.get(currentPhyNetName)!.phyNetLayers.add(layerRef);
        }
      }
      if (line.includes("</PhyNet>")) {
        insideMatchedPhyNet = false;
      }
    }
  });

  // If no nets matched, return empty matches (not an error)
  if (accumulators.size === 0) {
    return { pattern, units: "MICRON", matches: [] };
  }

  // Pass 2: Build LineDesc dictionary
  const lineDescDict = await buildLineDescDict(filePath);

  // Pass 3: LayerFeature routing/vias for all matched nets
  const matchedNames = new Set(accumulators.keys());
  const skipLayers = new Set(["REF-route", "REF-both"]);

  let currentLayerName = "";
  let insideMatchedSet = false;
  let currentSetNetName = "";
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
      insideMatchedSet = Boolean(
        netName && matchedNames.has(netName) && !skipLayers.has(currentLayerName)
      );
      currentSetNetName = netName ?? "";
      currentSetHasPolyline = false;
      currentSetLineDescId = undefined;
      currentSetInlineWidth = undefined;
      currentSetGeometry = attr(line, "geometry");
    }

    if (insideMatchedSet) {
      const acc = accumulators.get(currentSetNetName)!;

      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          addPin(acc, compRef, pin);
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
          acc.viaMap.set(key, (acc.viaMap.get(key) ?? 0) + 1);
        }
      }

      if (line.includes("</Set>")) {
        if (currentSetHasPolyline && currentLayerName) {
          if (!acc.routeMap.has(currentLayerName)) {
            acc.routeMap.set(currentLayerName, { widths: new Set(), segments: 0 });
          }
          const layerRoute = acc.routeMap.get(currentLayerName)!;
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

  // Assemble results
  const matches = [...accumulators.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([netName, acc]) => {
      const routing: NetRouteInfo[] = [];
      for (const [layerName, data] of acc.routeMap) {
        routing.push({
          layerName,
          traceWidths: [...data.widths].sort((a, b) => a - b),
          segmentCount: data.segments,
        });
      }

      const vias: NetViaInfo[] = [];
      for (const [padstackRef, count] of acc.viaMap) {
        vias.push({ padstackRef, count });
      }

      const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
      const totalVias = vias.reduce((sum, v) => sum + v.count, 0);

      // Merge PhyNetPoint layers with routing-derived layers
      const layerSet = new Set(acc.phyNetLayers);
      for (const r of routing) layerSet.add(r.layerName);
      const layersUsed = [...layerSet].sort();

      return { netName, pins: acc.pins, routing, vias, totalSegments, totalVias, layersUsed };
    });

  return { pattern, units: "MICRON", matches };
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
    withTelemetry("query_net", async ({ file, pattern }) => {
      const result = await queryNet(file, pattern);
      return formatResult(result);
    })
  );
};
