import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ComponentInfo,
  ComponentResult,
  ErrorResult,
  NetRow,
  PadRow,
  PadShape,
} from "./lib/types.js";
import { extractShapes, extractPackages, transformPin } from "./lib/geometry.js";
import { parsePackageRef } from "./lib/package-parser.js";
import { attr, numAttr, loadAllLines, streamAllLines } from "./lib/xml-utils.js";
import {
  extractMicronFactor,
  extractMicronFactorFromLines,
  formatResult,
  validateFile,
} from "./shared.js";
import { withTelemetry } from "../telemetry.js";

export const queryComponent = async (
  filePath: string,
  refdes: string
): Promise<ComponentResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (!refdes || refdes.length > 200) {
    return { error: "refdes must be 1-200 characters" };
  }

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Find the exact component placement.
  let placement: ComponentInfo | null = null;
  let currentRefdes: string | null = null;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<Component ") && line.includes("refDes=")) {
      const rd = attr(line, "refDes");
      if (rd === refdes) {
        currentRefdes = rd;
        placement = {
          refdes: rd,
          packageRef: attr(line, "packageRef") ?? "",
          x: 0,
          y: 0,
          rotation: 0,
          layer: attr(line, "layerRef") ?? "",
          mountType: attr(line, "mountType"),
        };
      } else {
        currentRefdes = null;
      }
    }

    if (currentRefdes && placement) {
      if (line.includes("<Location ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined) placement.x = Math.round(x * factor);
        if (y !== undefined) placement.y = Math.round(y * factor);
      }

      if (line.includes("<Xform ")) {
        const rotation = numAttr(line, "rotation");
        if (rotation !== undefined) placement.rotation = rotation;
      }

      if (line.includes("</Component>")) {
        return false; // Found it, stop scanning
      }
    }

    if (line.includes("<PhyNetGroup ") || line.includes("</Step>")) {
      return false;
    }
  });

  if (!placement) {
    return { error: `Component '${refdes}' not found` };
  }
  const p = placement as ComponentInfo;

  // Pass 2: Collect BOM data.
  let characteristics: Record<string, string> = {};
  let description: string | undefined;
  {
    let bomRefdesMatch = false;
    let currentChars: Record<string, string> = {};
    let currentDesc: string | undefined;

    await streamAllLines(filePath, (line) => {
      if (line.includes("<BomItem ")) {
        bomRefdesMatch = false;
        currentChars = {};
        currentDesc = attr(line, "OEMDesignNumberRef");
      }

      if (line.includes("<RefDes ")) {
        const name = attr(line, "name");
        if (name === refdes) {
          bomRefdesMatch = true;
        }
      }

      if (line.includes("<Textual ")) {
        const charName = attr(line, "textualCharacteristicName");
        const charValue = attr(line, "textualCharacteristicValue");
        if (charName && charValue) {
          currentChars[charName] = charValue;
        }
      }

      if (line.includes("</BomItem>")) {
        if (bomRefdesMatch) {
          characteristics = { ...currentChars };
          description = currentDesc;
          return false; // Found BOM entry, stop
        }
        bomRefdesMatch = false;
        currentChars = {};
        currentDesc = undefined;
      }

      if (line.includes("</Bom>")) {
        return false;
      }
    });
  }

  // Pass 3: Scan LogicalNet sections for net connectivity.
  const netMap = new Map<string, { pinCount: number; componentPins: string[] }>();
  {
    let insideLogicalNet = false;
    let currentNetName = "";
    let currentNetPinCount = 0;
    let currentPins: string[] = [];

    await streamAllLines(filePath, (line) => {
      if (line.includes("<LogicalNet ")) {
        const name = attr(line, "name");
        insideLogicalNet = Boolean(name);
        currentNetName = name ?? "";
        currentNetPinCount = 0;
        currentPins = [];
      }

      if (insideLogicalNet) {
        if (line.includes("<PinRef ")) {
          const compRef = attr(line, "componentRef");
          const pin = attr(line, "pin");
          if (compRef && pin) {
            currentNetPinCount++;
            if (compRef === refdes) {
              currentPins.push(pin);
            }
          }
        }
        if (line.includes("</LogicalNet>")) {
          if (currentPins.length > 0) {
            netMap.set(currentNetName, {
              pinCount: currentNetPinCount,
              componentPins: currentPins.sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true })
              ),
            });
          }
          insideLogicalNet = false;
        }
      }

      if (line.includes("<Step>") || line.includes("<LayerFeature")) return false;
    });
  }

  // Pass 4: Extract pad geometry.
  let padShapes: PadShape[] | undefined;
  let padRows: PadRow[] | undefined;
  {
    const lines = await loadAllLines(filePath);
    const f = extractMicronFactorFromLines(lines);
    const shapes = extractShapes(lines, f);
    const packages = extractPackages(lines);

    const pkg = packages.get(p.packageRef);
    if (pkg) {
      const shapeList: PadShape[] = [];
      const shapeIdx = new Map<string, number>();
      const rows: PadRow[] = [];
      for (const [pinName, pinDef] of pkg) {
        const pos = transformPin(
          {
            refdes: p.refdes,
            packageRef: p.packageRef,
            x: p.x,
            y: p.y,
            rotation: p.rotation,
            mirror: false,
            layer: p.layer,
          },
          pinDef,
          f
        );
        const shape = shapes.get(pinDef.shapeId);
        if (shape) {
          const w = Math.round(shape.width);
          const h = Math.round(shape.height);
          const key = `${shape.type}:${w}:${h}`;
          let idx = shapeIdx.get(key);
          if (idx === undefined) {
            idx = shapeList.length;
            shapeList.push({ shape: shape.type, width: w, height: h });
            shapeIdx.set(key, idx);
          }
          rows.push([pinName, Math.round(pos.x), Math.round(pos.y), idx]);
        }
      }
      rows.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
      padShapes = shapeList;
      padRows = rows;
    }
  }

  // Build result
  const parsed = parsePackageRef(p.packageRef);
  const netRows: NetRow[] = [...netMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([netName, data]) => [netName, data.componentPins, data.pinCount]);

  return {
    refdes: p.refdes,
    units: "MICRON",
    packageRef: p.packageRef,
    ...(parsed ? { parsed } : {}),
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    layer: p.layer,
    ...(p.mountType ? { mountType: p.mountType } : {}),
    ...(description ? { description } : {}),
    characteristics,
    netColumns: ["netName", "pins", "pinCount"],
    netRows,
    ...(padShapes && padRows
      ? { padShapes, padColumns: ["pin", "x", "y", "shapeIndex"] as const, padRows }
      : {}),
  };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_pcb_component",
    {
      description:
        "Look up a single component by exact refdes in an IPC-2581 file. Returns placement, package, BOM data, connected nets with pin names, and per-pin pad geometry.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        refdes: z
          .string()
          .describe("Exact component reference designator (e.g., 'U5', 'C10', 'R22')"),
      },
    },
    withTelemetry("get_pcb_component", async ({ file, refdes }) => {
      const result = await queryComponent(file, refdes);
      return formatResult(result);
    })
  );
};
