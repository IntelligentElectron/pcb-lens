import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ErrorResult, PadViaClassification, ViaInPadResult } from "./lib/types.js";
import {
  extractShapes,
  extractPackages,
  extractComponents,
  extractViaPadSizes,
  transformPin,
  type Point,
  type Shape,
} from "./lib/geometry.js";
import { attr, numAttr, loadAllLines, scanLines } from "./lib/xml-utils.js";
import { extractMicronFactorFromLines, formatResult, validateFile } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

interface Via {
  x: number;
  y: number;
  drillDiameter: number;
  padstackRef: string;
}

/**
 * Extract vias from all nets connected to a specific component.
 */
const extractComponentVias = (
  lines: string[],
  refdes: string,
  factor: number
): { connectedNets: Set<string>; vias: Via[] } => {
  // First find nets connected to this component
  const connectedNets = new Set<string>();
  let insideSet = false;
  let currentNet = "";
  let setHasComponent = false;

  scanLines(lines, (line) => {
    if (line.includes("<Set ")) {
      currentNet = attr(line, "net") ?? "";
      insideSet = Boolean(currentNet);
      setHasComponent = false;
    }
    if (insideSet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        if (compRef === refdes) setHasComponent = true;
      }
      if (line.includes("</Set>")) {
        if (setHasComponent) connectedNets.add(currentNet);
        insideSet = false;
      }
    }
  });

  // Also check LogicalNet for connections
  let insideLogicalNet = false;
  let logicalNetName = "";
  let logicalNetHasComp = false;

  scanLines(lines, (line) => {
    if (line.includes("<LogicalNet ")) {
      logicalNetName = attr(line, "name") ?? "";
      insideLogicalNet = Boolean(logicalNetName);
      logicalNetHasComp = false;
    }
    if (insideLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        if (compRef === refdes) logicalNetHasComp = true;
      }
      if (line.includes("</LogicalNet>")) {
        if (logicalNetHasComp) connectedNets.add(logicalNetName);
        insideLogicalNet = false;
      }
    }
    if (line.includes("<Step>")) return false;
  });

  // Then extract all vias from those nets
  const vias: Via[] = [];
  const skipLayers = new Set(["REF-route", "REF-both"]);
  let insideMatchedSet = false;
  let currentLayerName = "";
  let currentGeometry = "";

  scanLines(lines, (line) => {
    if (line.includes("<LayerFeature ")) {
      currentLayerName = attr(line, "layerRef") ?? "";
    }
    if (line.includes("<Set ")) {
      const net = attr(line, "net");
      insideMatchedSet = Boolean(
        net && connectedNets.has(net) && !skipLayers.has(currentLayerName)
      );
      currentGeometry = attr(line, "geometry") ?? "";
    }
    if (insideMatchedSet) {
      if (line.includes("<Hole ")) {
        const status = attr(line, "platingStatus");
        if (status === "VIA") {
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          const d = (numAttr(line, "diameter") ?? 0) * factor;
          if (x !== undefined && y !== undefined) {
            vias.push({
              x: x * factor,
              y: y * factor,
              drillDiameter: d,
              padstackRef: currentGeometry,
            });
          }
        }
      }
      if (line.includes("</Set>")) insideMatchedSet = false;
    }
  });

  return { connectedNets, vias };
};

/**
 * Compute the pad boundary radius (half-extent for distance checks).
 */
const padRadius = (shape: Shape): number => {
  if (shape.type === "circle") return shape.width / 2;
  return Math.max(shape.width, shape.height) / 2;
};

/**
 * Dog-bone threshold: via within 2x pad radius is "dog-bone".
 */
const DOG_BONE_FACTOR = 2.0;

export const queryViaInPad = async (
  filePath: string,
  refdes: string
): Promise<ViaInPadResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (!refdes || refdes.length > 200) {
    return { error: "refdes must be 1-200 characters" };
  }

  const lines = await loadAllLines(filePath);
  const factor = extractMicronFactorFromLines(lines);

  const shapes = extractShapes(lines, factor);
  const packages = extractPackages(lines);
  const viaPadSizes = extractViaPadSizes(lines);
  const components = extractComponents(lines, factor);

  // Find the target component
  const comp = components.find((c) => c.refdes === refdes);
  if (!comp) {
    return { error: `Component '${refdes}' not found` };
  }

  const pkg = packages.get(comp.packageRef);
  if (!pkg) {
    return { error: `Package '${comp.packageRef}' not found for component '${refdes}'` };
  }

  // Extract vias from connected nets
  const { vias } = extractComponentVias(lines, refdes, factor);

  // Get via pad sizes for accurate extent calculation
  const viaPadPoints: Array<{ point: Point; extent: number }> = vias.map((v) => {
    const viaDef = viaPadSizes.get(v.padstackRef);
    let padDiameter: number;
    if (viaDef) {
      const padShape = shapes.get(viaDef.padShapeId);
      padDiameter = padShape ? padShape.width : v.drillDiameter * 2.25;
    } else {
      padDiameter = v.drillDiameter * 2.25;
    }
    return { point: { x: v.x, y: v.y }, extent: padDiameter / 2 };
  });

  // Classify each pad
  const pads: PadViaClassification[] = [];
  for (const [pinName, pinDef] of pkg) {
    const padPos = transformPin(comp, pinDef, factor);
    const shape = shapes.get(pinDef.shapeId);
    const padR = shape ? padRadius(shape) : 0;

    let minDist = Infinity;
    for (const vp of viaPadPoints) {
      const dx = padPos.x - vp.point.x;
      const dy = padPos.y - vp.point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) minDist = dist;
    }

    let classification: PadViaClassification["classification"];
    if (minDist <= padR) {
      classification = "via-in-pad";
    } else if (padR > 0 && minDist <= padR * DOG_BONE_FACTOR) {
      classification = "dog-bone";
    } else {
      classification = "no-via";
    }

    const result: PadViaClassification = {
      pin: pinName,
      x: Math.round(padPos.x * 100) / 100,
      y: Math.round(padPos.y * 100) / 100,
      classification,
    };

    if (classification !== "no-via") {
      result.viaDistance_um = Math.round(minDist * 100) / 100;
    }

    pads.push(result);
  }

  pads.sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));

  const summary = {
    viaInPad: pads.filter((p) => p.classification === "via-in-pad").length,
    dogBone: pads.filter((p) => p.classification === "dog-bone").length,
    noVia: pads.filter((p) => p.classification === "no-via").length,
    total: pads.length,
  };

  return {
    refdes,
    packageRef: comp.packageRef,
    units: "MICRON",
    pads,
    summary,
  };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "query_via_in_pad",
    {
      description:
        "Detect via-in-pad for a component. Classifies each pad as via-in-pad (via center within pad boundary), dog-bone (via within 2x pad radius), or no-via.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        refdes: z.string().describe("Exact component refdes (e.g., 'U1')"),
      },
    },
    withTelemetry("query_via_in_pad", async ({ file, refdes }) => {
      const result = await queryViaInPad(file, refdes);
      return formatResult(result);
    })
  );
};
