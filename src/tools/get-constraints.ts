import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import { groupCmArchives, parseCmObjects, scanZipMembers } from "./lib/cadence-cm.js";
import { readBrdConstraints, readBrdInfo } from "./lib/allegro-brd.js";
import type {
  ConstraintObject,
  ConstraintsOverviewResult,
  ConstraintsSectionResult,
  CrossSection,
  CrossSectionLayer,
  ErrorResult,
} from "./lib/types.js";
import { formatResult } from "./shared.js";
import { withTelemetry } from "../telemetry/index.js";

// =============================================================================
// File validation
// =============================================================================

const EXTENSIONS = [".tcfx", ".dcf", ".brd"];

const validateConstraintFile = async (filePath: string): Promise<ErrorResult | null> => {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      return { error: `'${filePath}' is not a file` };
    }
  } catch {
    return { error: `File not found: '${filePath}'` };
  }
  if (!EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
    return { error: `Expected a .tcfx, .dcf or .brd file, got: '${path.basename(filePath)}'` };
  }
  return null;
};

// =============================================================================
// Overview mode (no section specified)
// =============================================================================

const getOverview = async (filePath: string): Promise<ConstraintsOverviewResult | ErrorResult> => {
  const sections: Array<{ name: string; objectCount: number }> = [];
  let currentSection: string | undefined;
  let objectCount = 0;
  let objectDepth = 0;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<cft:xml-objects ")) {
      const name = attr(line, "Name");
      if (name) {
        currentSection = name;
        objectCount = 0;
        objectDepth = 0;
      }
    } else if (line.includes("</cft:xml-objects>")) {
      if (currentSection) {
        sections.push({ name: currentSection, objectCount });
        currentSection = undefined;
      }
    } else if (currentSection) {
      if (line.includes("<object ")) {
        objectDepth++;
        if (objectDepth === 1) objectCount++;
      } else if (line.includes("</object>")) {
        objectDepth--;
      }
    }
  });

  let fileSizeBytes = 0;
  try {
    const s = await stat(filePath);
    fileSizeBytes = s.size;
  } catch {
    // already validated above
  }

  return {
    fileName: path.basename(filePath),
    fileSizeBytes,
    sections,
  };
};

// =============================================================================
// Section query mode
// =============================================================================

const querySection = async (
  filePath: string,
  sectionName: string
): Promise<ConstraintsSectionResult | ErrorResult> => {
  const objects: ConstraintObject[] = [];
  let inTargetSection = false;
  let sectionFound = false;

  // Parser state for building the current object
  let currentObject: ConstraintObject | undefined;
  let currentAttrName: string | undefined;
  // Track nesting for cross-section layers
  let inCrossSection = false;
  let currentCrossSection: CrossSection | undefined;
  let currentLayer: CrossSectionLayer | undefined;
  let currentLayerAttrName: string | undefined;
  // Depth tracking: 0 = section level, 1 = top-level objects, 2 = cross-section child objects
  let depth = 0;

  await streamAllLines(filePath, (line) => {
    // Find the target section
    if (!inTargetSection) {
      if (line.includes("<cft:xml-objects ")) {
        const name = attr(line, "Name");
        if (name === sectionName) {
          inTargetSection = true;
          sectionFound = true;
          depth = 0;
        }
      }
      return;
    }

    // End of target section
    if (line.includes("</cft:xml-objects>")) {
      if (currentObject) {
        if (currentCrossSection) {
          currentObject.crossSection = currentCrossSection;
        }
        objects.push(currentObject);
      }
      return false; // stop streaming
    }

    // Cross-section handling
    if (line.includes("<x-section>")) {
      inCrossSection = true;
      return;
    }
    if (line.includes("</x-section>")) {
      inCrossSection = false;
      return;
    }

    if (inCrossSection) {
      if (line.includes("<children ")) {
        currentCrossSection = {
          layers: [],
        };
        const primaryStackup = attr(line, "PrimaryStackup");
        const topIndex = numAttr(line, "TopIndex");
        const bottomIndex = numAttr(line, "BottomIndex");
        if (primaryStackup) currentCrossSection.primaryStackup = primaryStackup;
        if (topIndex !== undefined) currentCrossSection.topIndex = topIndex;
        if (bottomIndex !== undefined) currentCrossSection.bottomIndex = bottomIndex;
        return;
      }
      if (line.includes("</children>")) {
        if (currentLayer) {
          currentCrossSection?.layers.push(currentLayer);
          currentLayer = undefined;
        }
        return;
      }

      // Layer objects inside <children>
      if (line.includes("<object ")) {
        if (currentLayer) {
          currentCrossSection?.layers.push(currentLayer);
        }
        const type = attr(line, "Type") ?? "";
        currentLayer = { type, attributes: {} };
        currentLayerAttrName = undefined;
        return;
      }
      if (line.includes("</object>")) {
        if (currentLayer) {
          currentCrossSection?.layers.push(currentLayer);
          currentLayer = undefined;
        }
        currentLayerAttrName = undefined;
        return;
      }

      // Attributes inside layer objects
      if (currentLayer) {
        // Single-line case: <attribute Name="X"><value Value="Y"/></attribute>
        if (line.includes("<attribute ") && line.includes("<value ")) {
          const attrName = attr(line, "Name");
          const value = attr(line, "Value");
          if (attrName && value !== undefined) {
            currentLayer.attributes[attrName] = value;
          }
          return;
        }
        if (line.includes("<attribute ")) {
          currentLayerAttrName = attr(line, "Name");
          return;
        }
        if (line.includes("<value ") && currentLayerAttrName) {
          const value = attr(line, "Value");
          if (value !== undefined) {
            currentLayer.attributes[currentLayerAttrName] = value;
          }
          currentLayerAttrName = undefined;
          return;
        }
        if (line.includes("</attribute>")) {
          currentLayerAttrName = undefined;
          return;
        }
      }
      return;
    }

    // Top-level object handling
    if (line.includes("<object ") && !inCrossSection) {
      depth++;
      if (depth === 1) {
        // Finalize previous object
        if (currentObject) {
          if (currentCrossSection) {
            currentObject.crossSection = currentCrossSection;
            currentCrossSection = undefined;
          }
          objects.push(currentObject);
        }
        const name = attr(line, "Name") ?? "";
        currentObject = {
          name,
          attributes: {},
          references: [],
          members: [],
        };
        currentAttrName = undefined;
      }
      return;
    }

    if (line.includes("</object>") && !inCrossSection) {
      depth--;
      if (depth < 0) depth = 0;
      return;
    }

    // Only parse attributes/references/members at depth 1
    if (!currentObject || depth !== 1) return;

    // Single-line case: <attribute Name="X"><value Value="Y"/></attribute>
    if (line.includes("<attribute ") && line.includes("<value ")) {
      const attrName = attr(line, "Name");
      const value = attr(line, "Value");
      if (attrName && value !== undefined) {
        const generic = attr(line, "Generic");
        currentObject.attributes[attrName] = {
          value,
          ...(generic ? { generic } : {}),
        };
      }
      return;
    }

    if (line.includes("<attribute ")) {
      currentAttrName = attr(line, "Name");
      return;
    }

    if (line.includes("<value ") && currentAttrName) {
      const value = attr(line, "Value");
      if (value !== undefined) {
        const generic = attr(line, "Generic");
        currentObject.attributes[currentAttrName] = {
          value,
          ...(generic ? { generic } : {}),
        };
      }
      currentAttrName = undefined;
      return;
    }

    if (line.includes("</attribute>")) {
      currentAttrName = undefined;
      return;
    }

    if (line.includes("<reference ")) {
      const kind = attr(line, "Kind") ?? "";
      const name = attr(line, "Name") ?? "";
      currentObject.references.push({ kind, name });
      return;
    }

    if (line.includes("<member ")) {
      const kind = attr(line, "Kind") ?? "";
      const name = attr(line, "Name") ?? "";
      currentObject.members.push({ kind, name });
    }
  });

  if (!sectionFound) {
    return { error: `Section '${sectionName}' not found in file` };
  }

  return {
    fileName: path.basename(filePath),
    section: sectionName,
    objects,
  };
};

// =============================================================================
// Cadence .dcf and Allegro .brd: Constraint Manager XML archives + binary blocks
// =============================================================================

interface CadenceSection {
  source: string;
  units?: string;
  objects: ConstraintObject[];
}

const loadCadenceSections = async (
  filePath: string
): Promise<{ sections: Map<string, CadenceSection>; allegroVersion?: string } | ErrorResult> => {
  const buf = await readFile(filePath);
  const info = path.extname(filePath).toLowerCase() === ".brd" ? readBrdInfo(buf) : undefined;
  const board = typeof info === "object" ? info : undefined;

  // The board's own physical archive first, then the technology Attach, then views (prefixed)
  const rank = (a: { fileType: string; prefix: string }) =>
    a.prefix ? 2 : a.fileType === "Design" ? 0 : 1;
  const archives = groupCmArchives(scanZipMembers(buf))
    .map((a, i) => ({ ...a, index: i + 1 }))
    .sort((a, b) => rank(a) - rank(b) || b.objects.size - a.objects.size);

  const sections = new Map<string, CadenceSection>();
  for (const a of archives) {
    const design = a.objects.has("Design")
      ? parseCmObjects(a.objects.get("Design")!)[0]?.name
      : undefined;
    const source = `embedded archive ${a.index}: ${a.prefix}${a.fileType}${a.key ? `/${a.key}` : ""}${design ? `, design "${design}"` : ""}`;
    for (const [name, xml] of a.objects) {
      sections.set(sections.has(name) ? `${name}#${a.index}` : name, {
        source: path.extname(filePath).toLowerCase() === ".dcf" ? "dcf" : source,
        units: a.units ?? board?.units,
        objects: parseCmObjects(xml),
      });
    }
  }
  if (board) {
    for (const [name, objects] of Object.entries(readBrdConstraints(buf, board))) {
      sections.set(name, { source: "binary", units: "mm", objects });
    }
  }
  if (!sections.size) {
    return {
      error: `No constraint data found in '${path.basename(filePath)}'${typeof info === "string" ? `: ${info}` : ""}`,
    };
  }
  return { sections, ...(board ? { allegroVersion: board.version } : {}) };
};

const queryCadence = async (
  filePath: string,
  section?: string
): Promise<ConstraintsOverviewResult | ConstraintsSectionResult | ErrorResult> => {
  const loaded = await loadCadenceSections(filePath);
  if ("error" in loaded) return loaded;
  const fileName = path.basename(filePath);
  if (section) {
    const s = loaded.sections.get(section);
    if (!s) return { error: `Section '${section}' not found in file` };
    return {
      fileName,
      section,
      source: s.source,
      ...(s.units ? { units: s.units } : {}),
      objects: s.objects,
    };
  }
  return {
    fileName,
    fileSizeBytes: (await stat(filePath)).size,
    ...(loaded.allegroVersion ? { allegroVersion: loaded.allegroVersion } : {}),
    sections: [...loaded.sections].map(([name, s]) => ({
      name,
      objectCount: s.objects.length,
      source: s.source,
      ...(s.units ? { units: s.units } : {}),
    })),
  };
};

// =============================================================================
// Main entry point
// =============================================================================

export const queryConstraints = async (
  filePath: string,
  section?: string
): Promise<ConstraintsOverviewResult | ConstraintsSectionResult | ErrorResult> => {
  const resolvedPath = path.resolve(filePath);
  const validationError = await validateConstraintFile(resolvedPath);
  if (validationError) return validationError;
  if (!resolvedPath.toLowerCase().endsWith(".tcfx")) return queryCadence(resolvedPath, section);

  if (section) {
    return querySection(resolvedPath, section);
  }
  return getOverview(resolvedPath);
};

// =============================================================================
// MCP Registration
// =============================================================================

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_constraints",
    {
      description:
        "Query layout constraints from a Cadence .tcfx file, a Constraint Manager .dcf file, or an Allegro .brd board (read directly, no Cadence install needed). Without a section name, returns an overview of all sections and object counts. With a section name, returns all constraint objects with their attributes, references, members and children. Common sections: PhysicalCSet, SpacingCSet, ElectricalCSet, NetClass, MatchGroup, DiffPair, Design (stackup), Region. A .brd also has Brd* sections decoded from its binary database (BrdPhysicalCSet, BrdNetClass, BrdNet, BrdStackup, ...): these are the board's live rules, while the XML sections are embedded Constraint Manager snapshots whose 'source' says where they came from.",
      inputSchema: {
        file: z.string().describe("Path to a .tcfx, .dcf or .brd file"),
        section: z
          .string()
          .optional()
          .describe(
            "Section name to query (e.g., 'PhysicalCSet', 'SpacingCSet'). Omit for overview."
          ),
      },
    },
    withTelemetry("get_constraints", async ({ file, section }) => {
      const result = await queryConstraints(file, section);
      return formatResult(result);
    })
  );
};
