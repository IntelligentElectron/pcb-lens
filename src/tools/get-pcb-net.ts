import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ErrorResult,
  QueryNetResult,
  NetRouteInfo,
  NetVia,
  QueryNetsResult,
} from "./lib/types.js";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import {
  addPin,
  buildLineDescDict,
  extractMicronFactor,
  formatResult,
  groupPinsByRefdes,
  makeAccumulator,
  validateFile,
  validatePattern,
  type NetAccumulator,
} from "./shared.js";
import { withTelemetry } from "../telemetry.js";

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
  const phyNetNames = new Set<string>();
  const matchedPhyNetNames = new Set<string>();
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
      if (name) {
        phyNetNames.add(name);
      }
      if (name && regex.test(name)) {
        insideMatchedPhyNet = true;
        currentPhyNetName = name;
        matchedPhyNetNames.add(name);
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

  if (phyNetNames.size > 0 && matchedPhyNetNames.size === phyNetNames.size) {
    return {
      error: `Pattern '${pattern}' matches all ${phyNetNames.size} physical nets. Use a more specific pattern, or use get_pcb_metadata for net counts and discovery.`,
    };
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
  let inPolyline = false;
  let polyPoints: { x: number; y: number }[] = [];
  let polyLength = 0;

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
      polyLength = 0;
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
        inPolyline = true;
        polyPoints = [];
      }

      if (inPolyline) {
        if (line.includes("<PolyBegin ") || line.includes("<PolyStepSegment ")) {
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          if (x !== undefined && y !== undefined) {
            const pt = { x: x * factor, y: y * factor };
            if (polyPoints.length > 0) {
              const prev = polyPoints[polyPoints.length - 1];
              const dx = pt.x - prev.x;
              const dy = pt.y - prev.y;
              polyLength += Math.sqrt(dx * dx + dy * dy);
            }
            polyPoints.push(pt);
          }
        }
        if (line.includes("</Polyline>")) {
          inPolyline = false;
        }
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
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          const diameter = numAttr(line, "diameter") ?? 0;
          if (x !== undefined && y !== undefined) {
            acc.vias.push({
              x: Math.round(x * factor),
              y: Math.round(y * factor),
              drillDiameter: Math.round(diameter * factor),
              layer: currentLayerName,
            });
          }
        }
      }

      if (line.includes("</Set>")) {
        if (currentSetHasPolyline && currentLayerName) {
          if (!acc.routeMap.has(currentLayerName)) {
            acc.routeMap.set(currentLayerName, { widths: new Set(), segments: 0, traceLength: 0 });
          }
          const layerRoute = acc.routeMap.get(currentLayerName)!;
          layerRoute.segments++;
          layerRoute.traceLength += polyLength;

          if (currentSetLineDescId) {
            const width = lineDescDict.get(currentSetLineDescId);
            if (width !== undefined) {
              layerRoute.widths.add(Math.round(width * factor));
            }
          } else if (currentSetInlineWidth !== undefined) {
            layerRoute.widths.add(Math.round(currentSetInlineWidth * factor));
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
      for (const [layerName, data] of [...acc.routeMap.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        routing.push({
          layerName,
          traceWidths: [...data.widths].sort((a, b) => a - b),
          segmentCount: data.segments,
          traceLength: Math.round(data.traceLength),
        });
      }

      const vias: NetVia[] = acc.vias;

      const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
      const totalVias = vias.length;
      const totalTraceLength = Math.round(routing.reduce((sum, r) => sum + r.traceLength, 0));

      // Merge PhyNetPoint layers with routing-derived layers
      const layerSet = new Set(acc.phyNetLayers);
      for (const r of routing) layerSet.add(r.layerName);
      const layersUsed = [...layerSet].sort();

      const result: QueryNetResult = {
        netName,
        pins: groupPinsByRefdes(acc.pins),
        layersUsed,
      };

      if (routing.length > 0) {
        result.routing = routing;
      }
      if (vias.length > 0) {
        result.vias = vias;
      }
      if (totalSegments > 0) {
        result.totalSegments = totalSegments;
      }
      if (totalVias > 0) {
        result.totalVias = totalVias;
      }
      if (totalTraceLength > 0) {
        result.totalTraceLength = totalTraceLength;
      }

      return result;
    });

  return { pattern, units: "MICRON", matches };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_pcb_net",
    {
      description:
        "Query nets by name pattern in an IPC-2581 file. Returns grouped connected pins, routing per layer (trace widths, trace lengths, segment counts), and via information. Rejects patterns that match all nets.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        pattern: z
          .string()
          .describe("Regex pattern for net name (e.g., '^DDR_D0$', 'CLK', '^VCC_3V3$')"),
      },
    },
    withTelemetry("get_pcb_net", async ({ file, pattern }) => {
      const result = await queryNet(file, pattern);
      return formatResult(result);
    })
  );
};
