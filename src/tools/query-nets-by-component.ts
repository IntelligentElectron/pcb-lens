import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ErrorResult,
  QueryNetResult,
  NetRouteInfo,
  NetViaInfo,
  QueryNetsByComponentResult,
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
  type NetAccumulator,
} from "./shared.js";
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

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Find nets connected to this component via LogicalNet PinRef,
  // collect pins, and extract PhyNet layers.
  const accumulators = new Map<string, NetAccumulator>();
  let insideLogicalNet = false;
  let currentNetName = "";
  let currentNetHasComponent = false;
  let currentNetPins: Array<{ refdes: string; pin: string }> = [];

  await streamAllLines(filePath, (line) => {
    if (line.includes("<LayerFeature")) return false;

    // LogicalNet: check if this net connects to our component
    if (line.includes("<LogicalNet ")) {
      const name = attr(line, "name");
      insideLogicalNet = Boolean(name);
      currentNetName = name ?? "";
      currentNetHasComponent = false;
      currentNetPins = [];
    }

    if (insideLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          currentNetPins.push({ refdes: compRef, pin });
          if (compRef === refdes) {
            currentNetHasComponent = true;
          }
        }
      }
      if (line.includes("</LogicalNet>")) {
        if (currentNetHasComponent && currentNetName) {
          if (!accumulators.has(currentNetName)) {
            accumulators.set(currentNetName, makeAccumulator());
          }
          const acc = accumulators.get(currentNetName)!;
          for (const p of currentNetPins) {
            addPin(acc, p.refdes, p.pin);
          }
        }
        insideLogicalNet = false;
      }
    }

    // PhyNet: collect layers for matched nets
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name && accumulators.has(name)) {
        currentNetName = name;
      } else {
        currentNetName = "";
      }
    }

    if (currentNetName && accumulators.has(currentNetName)) {
      if (line.includes("<PhyNetPoint ")) {
        const layerRef = attr(line, "layerRef");
        if (layerRef) {
          accumulators.get(currentNetName)!.phyNetLayers.add(layerRef);
        }
      }
      if (line.includes("</PhyNet>")) {
        currentNetName = "";
      }
    }
  });

  // Filter out ground nets unless include_ground is true
  if (!includeGround) {
    for (const netName of [...accumulators.keys()]) {
      if (GROUND_PATTERN.test(netName)) {
        accumulators.delete(netName);
      }
    }
  }

  if (accumulators.size === 0) {
    return { refdes, includeGround, units: "MICRON", matches: [] };
  }

  // Pass 2: Build LineDesc dictionary
  const lineDescDict = await buildLineDescDict(filePath);

  // Pass 3: LayerFeature routing/vias for matched nets
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
      for (const [layerName, data] of [...acc.routeMap.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        routing.push({
          layerName,
          traceWidths: [...data.widths].sort((a, b) => a - b),
          segmentCount: data.segments,
        });
      }

      const vias: NetViaInfo[] = [];
      for (const [padstackRef, count] of [...acc.viaMap.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        vias.push({ padstackRef, count });
      }

      const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
      const totalVias = vias.reduce((sum, v) => sum + v.count, 0);

      const layerSet = new Set(acc.phyNetLayers);
      for (const r of routing) layerSet.add(r.layerName);
      const layersUsed = [...layerSet].sort();

      const result: QueryNetResult = {
        netName,
        pins: groupPinsByRefdes(acc.pins),
        layersUsed,
      };

      if (routing.length > 0) result.routing = routing;
      if (vias.length > 0) result.vias = vias;
      if (totalSegments > 0) result.totalSegments = totalSegments;
      if (totalVias > 0) result.totalVias = totalVias;

      return result;
    });

  return { refdes, includeGround, units: "MICRON", matches };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "query_nets_by_component",
    {
      description:
        "Query all nets connected to a component by refdes. Returns routing data (trace widths, vias, layers) for each net. Ground/power-ground nets are excluded by default.",
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
