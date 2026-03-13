import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ComponentInfo,
  ComponentResult,
  ErrorResult,
  PadGeometry,
  QueryComponentsResult,
} from "./lib/types.js";
import { extractShapes, extractPackages, transformPin } from "./lib/geometry.js";
import { parsePackageRef } from "./lib/package-parser.js";
import { attr, numAttr, loadAllLines, streamAllLines } from "./lib/xml-utils.js";
import {
  extractMicronFactor,
  extractMicronFactorFromLines,
  formatResult,
  validateFile,
  validatePattern,
} from "./shared.js";
import { withTelemetry } from "../telemetry.js";

export const queryComponents = async (
  filePath: string,
  pattern: string,
  packagePattern?: string,
  includePads = false
): Promise<QueryComponentsResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

  let packageRegex: RegExp | undefined;
  if (packagePattern) {
    const pkgValidation = validatePattern(packagePattern);
    if ("error" in pkgValidation) return pkgValidation;
    packageRegex = pkgValidation.regex;
  }

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Collect matching component placements from Component section.
  const placements = new Map<string, ComponentInfo>();
  let currentRefdes: string | null = null;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<Component ") && line.includes("refDes=")) {
      const refdes = attr(line, "refDes");
      if (refdes && regex.test(refdes)) {
        currentRefdes = refdes;
        placements.set(refdes, {
          refdes,
          packageRef: attr(line, "packageRef") ?? "",
          x: 0,
          y: 0,
          rotation: 0,
          layer: attr(line, "layerRef") ?? "",
          mountType: attr(line, "mountType"),
        });
      } else {
        currentRefdes = null;
      }
    }

    if (currentRefdes && placements.has(currentRefdes)) {
      const comp = placements.get(currentRefdes)!;

      if (line.includes("<Location ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined) comp.x = x * factor;
        if (y !== undefined) comp.y = y * factor;
      }

      if (line.includes("<Xform ")) {
        const rotation = numAttr(line, "rotation");
        if (rotation !== undefined) comp.rotation = rotation;
      }

      if (line.includes("</Component>")) {
        currentRefdes = null;
      }
    }

    if (line.includes("<PhyNetGroup ") || line.includes("</Step>")) {
      return false;
    }
  });

  // Filter by package pattern if provided
  if (packageRegex) {
    for (const [refdes, comp] of placements) {
      if (!packageRegex.test(comp.packageRef)) {
        placements.delete(refdes);
      }
    }
  }

  const baseResult = {
    pattern,
    ...(packagePattern ? { package: packagePattern } : {}),
    units: "MICRON",
  };

  if (placements.size === 0) {
    return { ...baseResult, matches: [] };
  }

  // Pass 2: Collect BOM data for matched refdes.
  const bomCharacteristics = new Map<string, Record<string, string>>();
  const bomDescriptions = new Map<string, string>();
  let currentBomRefdes: string[] = [];
  let currentBomChars: Record<string, string> = {};
  let currentBomDesc: string | undefined;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<BomItem ")) {
      currentBomRefdes = [];
      currentBomChars = {};
      currentBomDesc = attr(line, "OEMDesignNumberRef");
    }

    if (line.includes("<RefDes ")) {
      const name = attr(line, "name");
      if (name && placements.has(name)) {
        currentBomRefdes.push(name);
      }
    }

    if (line.includes("<Textual ")) {
      const charName = attr(line, "textualCharacteristicName");
      const charValue = attr(line, "textualCharacteristicValue");
      if (charName && charValue) {
        currentBomChars[charName] = charValue;
      }
    }

    if (line.includes("</BomItem>")) {
      for (const refdes of currentBomRefdes) {
        bomCharacteristics.set(refdes, { ...currentBomChars });
        if (currentBomDesc) {
          bomDescriptions.set(refdes, currentBomDesc);
        }
      }
      currentBomRefdes = [];
      currentBomChars = {};
      currentBomDesc = undefined;
    }

    if (line.includes("</Bom>")) {
      return false;
    }
  });

  // Optional Pass 3: Extract pad geometry when include_pads is set.
  let padGeometryMap: Map<string, PadGeometry[]> | undefined;
  if (includePads) {
    const lines = await loadAllLines(filePath);
    const f = extractMicronFactorFromLines(lines);
    const shapes = extractShapes(lines, f);
    const packages = extractPackages(lines);
    padGeometryMap = new Map();

    for (const [refdes, placement] of placements) {
      const pkg = packages.get(placement.packageRef);
      if (!pkg) continue;
      const pads: PadGeometry[] = [];
      for (const [pinName, pinDef] of pkg) {
        const pos = transformPin(
          {
            refdes,
            packageRef: placement.packageRef,
            x: placement.x,
            y: placement.y,
            rotation: placement.rotation,
            mirror: false,
            layer: placement.layer,
          },
          pinDef,
          f
        );
        const shape = shapes.get(pinDef.shapeId);
        if (shape) {
          pads.push({
            pin: pinName,
            x: Math.round(pos.x * 100) / 100,
            y: Math.round(pos.y * 100) / 100,
            shape: shape.type,
            width: Math.round(shape.width * 100) / 100,
            height: Math.round(shape.height * 100) / 100,
          });
        }
      }
      pads.sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));
      padGeometryMap.set(refdes, pads);
    }
  }

  // Merge placement + BOM + parsed package + optional pads
  const matches: ComponentResult[] = [];
  for (const [refdes, placement] of placements) {
    const parsed = parsePackageRef(placement.packageRef);
    const pads = padGeometryMap?.get(refdes);
    matches.push({
      ...placement,
      ...(parsed ? { parsed } : {}),
      description: bomDescriptions.get(refdes),
      characteristics: bomCharacteristics.get(refdes) ?? {},
      ...(pads ? { pads } : {}),
    });
  }

  matches.sort((a, b) => a.refdes.localeCompare(b.refdes));

  return { ...baseResult, matches };
};

export const register = (server: McpServer): void => {
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
        package: z
          .string()
          .optional()
          .describe(
            "Optional regex pattern to filter by package/footprint name (e.g., 'BGA', 'QFP', 'SOT23'). ANDed with refdes pattern."
          ),
        include_pads: z
          .boolean()
          .default(false)
          .describe("Include per-pin pad geometry (shape, size, position). Default: false"),
      },
    },
    withTelemetry("query_components", async ({ file, pattern, package: pkg, include_pads }) => {
      const result = await queryComponents(file, pattern, pkg, include_pads);
      return formatResult(result);
    })
  );
};
