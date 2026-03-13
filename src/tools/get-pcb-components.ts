import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ComponentInfo,
  ComponentNetSummary,
  ComponentResult,
  ErrorResult,
  PadGeometry,
  PadShape,
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
  packagePattern?: string
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

  // Pass 3: Scan LogicalNet sections for net connectivity.
  const netsByComponent = new Map<
    string,
    Map<string, { pinCount: number; componentPins: string[] }>
  >();
  for (const refdes of placements.keys()) {
    netsByComponent.set(refdes, new Map());
  }
  {
    let insideLogicalNet = false;
    let currentNetName = "";
    let currentNetPinCount = 0;
    let currentPinsByRefdes = new Map<string, string[]>();

    await streamAllLines(filePath, (line) => {
      if (line.includes("<LogicalNet ")) {
        const name = attr(line, "name");
        insideLogicalNet = Boolean(name);
        currentNetName = name ?? "";
        currentNetPinCount = 0;
        currentPinsByRefdes = new Map();
      }

      if (insideLogicalNet) {
        if (line.includes("<PinRef ")) {
          const compRef = attr(line, "componentRef");
          const pin = attr(line, "pin");
          if (compRef && pin) {
            currentNetPinCount++;
            if (netsByComponent.has(compRef)) {
              const pins = currentPinsByRefdes.get(compRef) ?? [];
              pins.push(pin);
              currentPinsByRefdes.set(compRef, pins);
            }
          }
        }
        if (line.includes("</LogicalNet>")) {
          for (const [refdes, pins] of currentPinsByRefdes) {
            netsByComponent.get(refdes)!.set(currentNetName, {
              pinCount: currentNetPinCount,
              componentPins: pins.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
            });
          }
          insideLogicalNet = false;
        }
      }

      if (line.includes("<Step>") || line.includes("<LayerFeature")) return false;
    });
  }

  // Pass 4: Extract pad geometry.
  const padDataMap = new Map<string, { padShapes: PadShape[]; pads: PadGeometry[] }>();
  {
    const lines = await loadAllLines(filePath);
    const f = extractMicronFactorFromLines(lines);
    const shapes = extractShapes(lines, f);
    const packages = extractPackages(lines);

    for (const [refdes, placement] of placements) {
      const pkg = packages.get(placement.packageRef);
      if (!pkg) continue;
      const shapeList: PadShape[] = [];
      const shapeIndex = new Map<string, number>();
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
          const w = Math.round(shape.width * 100) / 100;
          const h = Math.round(shape.height * 100) / 100;
          const key = `${shape.type}:${w}:${h}`;
          let idx = shapeIndex.get(key);
          if (idx === undefined) {
            idx = shapeList.length;
            shapeList.push({ shape: shape.type, width: w, height: h });
            shapeIndex.set(key, idx);
          }
          pads.push({
            pin: pinName,
            x: Math.round(pos.x * 100) / 100,
            y: Math.round(pos.y * 100) / 100,
            shapeIndex: idx,
          });
        }
      }
      pads.sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));
      padDataMap.set(refdes, { padShapes: shapeList, pads });
    }
  }

  // Merge placement + BOM + parsed package + nets + pads
  const matches: ComponentResult[] = [];
  for (const [refdes, placement] of placements) {
    const parsed = parsePackageRef(placement.packageRef);
    const padData = padDataMap.get(refdes);
    const netMap = netsByComponent.get(refdes);
    const nets: ComponentNetSummary[] = netMap
      ? [...netMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([netName, data]) => ({
            netName,
            pins: data.componentPins,
            pinCount: data.pinCount,
          }))
      : [];
    matches.push({
      ...placement,
      ...(parsed ? { parsed } : {}),
      description: bomDescriptions.get(refdes),
      characteristics: bomCharacteristics.get(refdes) ?? {},
      nets,
      ...(padData ? { padShapes: padData.padShapes, pads: padData.pads } : {}),
    });
  }

  matches.sort((a, b) => a.refdes.localeCompare(b.refdes));

  return { ...baseResult, matches };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_pcb_components",
    {
      description:
        "Find components by refdes pattern in an IPC-2581 file. Returns placement, package, BOM data, connected nets with pin names, and per-pin pad geometry.",
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
      },
    },
    withTelemetry("get_pcb_components", async ({ file, pattern, package: pkg }) => {
      const result = await queryComponents(file, pattern, pkg);
      return formatResult(result);
    })
  );
};
