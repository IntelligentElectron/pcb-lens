import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DesignOverview, ErrorResult, LayerInfo, SectionInfo } from "./lib/types.js";
import { attr, streamAllLines } from "./lib/xml-utils.js";
import { isBrdFile, loadBrdLayout } from "./lib/allegro-layout.js";
import { validateFile } from "./shared.js";
import { defineTool } from "./registry.js";

const getBrdOverview = async (filePath: string): Promise<DesignOverview | ErrorResult> => {
  const brd = await loadBrdLayout(filePath);
  if (typeof brd === "string") return { error: brd };
  const { copperLayers, components, nets } = brd.layout;
  const last = copperLayers.length - 1;
  return {
    fileName: path.basename(filePath),
    fileSizeBytes: (await stat(filePath)).size,
    units: "MICRON",
    allegroVersion: brd.info.version,
    layers: copperLayers.map((l, i) => ({
      name: l.name,
      side: i === 0 ? "TOP" : i === last ? "BOTTOM" : "INTERNAL",
      layerFunction: l.plane ? "PLANE" : "CONDUCTOR",
    })),
    componentCount: components.length,
    netCount: nets.filter((n) => n.name).length,
  };
};

export const getDesignOverview = async (
  filePath: string
): Promise<DesignOverview | ErrorResult> => {
  if (isBrdFile(filePath)) return getBrdOverview(filePath);
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

export const tool = defineTool({
  name: "get_pcb_metadata",
  title: "Design overview",
  description:
    "Get a high-level overview of a PCB design file: file metadata, the layer stackup, design units, and the total component and net counts. Use this first to understand a design's size and layers before querying specific components or nets. For an Allegro .brd the layers are the copper layers, top to bottom.",
  inputSchema: {
    file: z
      .string()
      .describe("Path to an IPC-2581 XML file or an Allegro 16.x, 17.x or 18.x .brd file"),
  },
  run: ({ file }) => getDesignOverview(file),
});
