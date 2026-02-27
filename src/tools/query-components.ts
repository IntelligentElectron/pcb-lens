import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ComponentInfo,
  ComponentResult,
  ErrorResult,
  QueryComponentsResult,
} from "./lib/types.js";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import { extractMicronFactor, formatResult, validateFile, validatePattern } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

export const queryComponents = async (
  filePath: string,
  pattern: string
): Promise<QueryComponentsResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

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

  if (placements.size === 0) {
    return { pattern, units: "MICRON", matches: [] };
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

  // Merge placement + BOM
  const matches: ComponentResult[] = [];
  for (const [refdes, placement] of placements) {
    matches.push({
      ...placement,
      description: bomDescriptions.get(refdes),
      characteristics: bomCharacteristics.get(refdes) ?? {},
    });
  }

  matches.sort((a, b) => a.refdes.localeCompare(b.refdes));

  return { pattern, units: "MICRON", matches };
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
      },
    },
    withTelemetry("query_components", async ({ file, pattern }) => {
      const result = await queryComponents(file, pattern);
      return formatResult(result);
    })
  );
};
