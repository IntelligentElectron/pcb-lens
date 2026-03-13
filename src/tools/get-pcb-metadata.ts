import { stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DesignOverview, ErrorResult, LayerInfo, SectionInfo } from "./lib/types.js";
import { attr, streamAllLines } from "./lib/xml-utils.js";
import { formatResult, validateFile } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

export const getDesignOverview = async (
  filePath: string
): Promise<DesignOverview | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const fileStats = await stat(filePath);

  let ipc2581Revision: string | undefined;
  let stepName: string | undefined;
  const layers: LayerInfo[] = [];
  const seenLayers = new Set<string>();
  let componentCount = 0;
  const netNames = new Set<string>();

  const topLevelTags = [
    "Content",
    "LogicalNet",
    "LogisticHeader",
    "Bom",
    "Ecad",
    "PhyNet",
    "LayerFeature",
  ];
  const tagPatterns = topLevelTags.map((tag) => [tag, new RegExp(`^\\s*<${tag}[\\s>]`)] as const);
  const sectionMap = new Map<string, number>();
  let currentSection: string | null = null;
  let currentSectionStart = 0;
  let totalLineCount = 0;

  await streamAllLines(filePath, (line, lineNumber) => {
    totalLineCount = lineNumber;

    if (ipc2581Revision === undefined && line.includes("<IPC-2581")) {
      ipc2581Revision = attr(line, "revision");
    }

    if (stepName === undefined && line.includes("<Step ")) {
      stepName = attr(line, "name");
    }

    if (line.includes("<LayerRef ") || line.includes("<Layer ")) {
      const name = attr(line, "layerOrGroupRef") ?? attr(line, "name");
      if (name && !seenLayers.has(name)) {
        seenLayers.add(name);
        const side = attr(line, "side");
        const layerFunction = attr(line, "layerFunction");
        const layerInfo: LayerInfo = { name };
        if (side) layerInfo.side = side;
        if (layerFunction) layerInfo.layerFunction = layerFunction;
        layers.push(layerInfo);
      }
    }

    if (line.includes("<Component ") && line.includes("refDes=")) {
      componentCount++;
    }

    if (line.includes("<PhyNet ")) {
      const netName = attr(line, "name");
      if (netName) netNames.add(netName);
    }

    for (const [tag, pattern] of tagPatterns) {
      if (pattern.test(line)) {
        if (currentSection && currentSectionStart > 0) {
          sectionMap.set(
            currentSection,
            (sectionMap.get(currentSection) ?? 0) + (lineNumber - currentSectionStart)
          );
        }
        currentSection = tag;
        currentSectionStart = lineNumber;
        break;
      }
    }
  });

  if (currentSection && currentSectionStart > 0) {
    sectionMap.set(
      currentSection,
      (sectionMap.get(currentSection) ?? 0) + (totalLineCount - currentSectionStart + 1)
    );
  }

  const sections: SectionInfo[] = [...sectionMap.entries()].map(([name, lineCount]) => ({
    name,
    lineCount,
  }));

  return {
    fileName: path.basename(filePath),
    fileSizeBytes: fileStats.size,
    totalLines: totalLineCount,
    units: "MICRON",
    ipc2581Revision,
    stepName,
    layers,
    componentCount,
    netCount: netNames.size,
    sections: sections.sort((a, b) => b.lineCount - a.lineCount),
  };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_pcb_metadata",
    {
      description:
        "Get an overview of an IPC-2581 PCB design file: metadata, layer stackup, component/net counts, and section sizes",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
      },
    },
    withTelemetry("get_pcb_metadata", async ({ file }) => {
      const result = await getDesignOverview(file);
      return formatResult(result);
    })
  );
};
