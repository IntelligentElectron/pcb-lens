/**
 * PCB Layout Service
 *
 * IPC-2581 XML streaming query methods.
 * All methods take a file path to an IPC-2581 XML as input.
 * All physical values (coordinates, trace widths) are normalized to microns.
 */

import { stat, readdir, access } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createMutex } from "./async-mutex.js";
import { attr, numAttr, streamAllLines, loadAllLines, scanLines } from "./xml-utils.js";
import type {
  ErrorResult,
  DesignOverview,
  LayerInfo,
  SectionInfo,
  ComponentResult,
  ComponentInfo,
  QueryComponentsResult,
  QueryNetResult,
  RenderNetResult,
  NetPin,
  NetRouteInfo,
  NetViaInfo,
  CadenceInstall,
  ExportCadenceBoardResult,
} from "./types.js";

const execAsync = promisify(exec);

// =============================================================================
// File Validation
// =============================================================================

const validateFile = async (filePath: string): Promise<ErrorResult | null> => {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      return { error: `'${filePath}' is not a file` };
    }
    if (!filePath.endsWith(".xml")) {
      return { error: `'${filePath}' is not an XML file` };
    }
  } catch {
    return { error: `File not found: '${filePath}'` };
  }
  return null;
};

// =============================================================================
// Unit Conversion
// =============================================================================

/**
 * Conversion factors from IPC-2581 unit values to microns.
 */
const UNIT_TO_MICRON: Record<string, number> = {
  MICRON: 1,
  MILLIMETER: 1_000,
  MM: 1_000,
  INCH: 25_400,
};

/**
 * Extract the micron conversion factor from the CadHeader element.
 * Returns 1 if the file already uses MICRON or the unit is unrecognized.
 */
const extractMicronFactor = async (filePath: string): Promise<number> => {
  let factor = 1;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<CadHeader ")) {
      const units = attr(line, "units")?.toUpperCase();
      if (units && units in UNIT_TO_MICRON) {
        factor = UNIT_TO_MICRON[units];
      }
      return false;
    }
  });

  return factor;
};

/** Extract micron factor from in-memory lines. */
const extractMicronFactorFromLines = (lines: string[]): number => {
  let factor = 1;
  scanLines(lines, (line) => {
    if (line.includes("<CadHeader ")) {
      const units = attr(line, "units")?.toUpperCase();
      if (units && units in UNIT_TO_MICRON) {
        factor = UNIT_TO_MICRON[units];
      }
      return false;
    }
  });
  return factor;
};

// =============================================================================
// LineDesc Dictionary
// =============================================================================

/**
 * Build a map of LineDesc IDs to their lineWidth values.
 * These are defined in the Content/DictionaryLineDesc section.
 */
const buildLineDescDict = async (filePath: string): Promise<Map<string, number>> => {
  const dict = new Map<string, number>();
  let currentId: string | undefined;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<EntryLineDesc ")) {
      currentId = attr(line, "id");
    }
    if (line.includes("<LineDesc ") && currentId) {
      const width = numAttr(line, "lineWidth");
      if (width !== undefined) {
        dict.set(currentId, width);
      }
      currentId = undefined;
    }
    // Stop after Content section ends (LineDesc is always in Content)
    if (line.includes("</Content>")) {
      return false;
    }
  });

  return dict;
};

// =============================================================================
// get_design_overview
// =============================================================================

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

  // Track sections by top-level elements
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
    // Detect IPC-2581 revision from root element
    if (ipc2581Revision === undefined && line.includes("<IPC-2581")) {
      ipc2581Revision = attr(line, "revision");
    }

    // Detect step name
    if (stepName === undefined && line.includes("<Step ")) {
      stepName = attr(line, "name");
    }

    // Collect layer definitions
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

    // Count components
    if (line.includes("<Component ") && line.includes("refDes=")) {
      componentCount++;
    }

    // Count unique nets
    if (line.includes("<PhyNet ")) {
      const netName = attr(line, "name");
      if (netName) netNames.add(netName);
    }

    // Track major sections
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

  // Close last section
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

// =============================================================================
// query_components
// =============================================================================

export const queryComponents = async (
  filePath: string,
  pattern: string
): Promise<QueryComponentsResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (pattern.length > 200) {
    return { error: "Regex pattern too long (max 200 characters)" };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern: '${pattern}'` };
  }

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Collect matching component placements from Component section.
  // Structure:
  //   <Component refDes="P10" packageRef="..." layerRef="BOTTOM" part="..." mountType="SMT">
  //     <NonstandardAttribute name="VALUE" value="YL004-030-001" type="STRING"/>
  //     <Xform rotation="90.000" mirror="true"/>
  //     <Location x="70609.968" y="31259.780"/>
  //   </Component>
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

    // Stop after Placement section (components come before PhyNet)
    if (line.includes("<PhyNetGroup ") || line.includes("</Step>")) {
      return false;
    }
  });

  if (placements.size === 0) {
    return { pattern, units: "MICRON", matches: [] };
  }

  // Pass 2: Collect BOM data for matched refdes.
  // Structure:
  //   <BomItem OEMDesignNumberRef="..." quantity="1" pinCount="14" category="ELECTRICAL">
  //     <RefDes name="P10" packageRef="..." populate="true" layerRef="BOTTOM"/>
  //     <RefDes name="P9" .../>
  //     <Characteristics category="ELECTRICAL">
  //       <Textual ... textualCharacteristicName="DEVICE_TYPE" textualCharacteristicValue="..."/>
  //       <Textual ... textualCharacteristicName="COMP_VALUE" textualCharacteristicValue="..."/>
  //     </Characteristics>
  //   </BomItem>
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

// =============================================================================
// query_net
// =============================================================================

export const queryNet = async (
  filePath: string,
  pattern: string
): Promise<QueryNetResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (pattern.length > 200) {
    return { error: "Regex pattern too long (max 200 characters)" };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern: '${pattern}'` };
  }

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Find matching net name from PhyNet section
  let matchedNetName: string | null = null;

  await streamAllLines(filePath, (line) => {
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        if (!matchedNetName) matchedNetName = name;
        return false; // Found it, stop
      }
    }
  });

  if (!matchedNetName) {
    return { error: `No net matching pattern '${pattern}' found` };
  }

  // Pass 2: Build LineDesc dictionary (for resolving trace widths)
  const lineDescDict = await buildLineDescDict(filePath);

  // Pass 3: Single pass through LayerFeature sections.
  // Collect pins, routing, and vias for the matched net.
  //
  // Structure in LayerFeature:
  //   <LayerFeature layerRef="TOP">
  //     <Set net="VDD_3V3B">                         ← routing Set
  //       <Features>
  //         <Polyline>
  //           <LineDescRef id="ROUND_1500"/>          ← trace width ref
  //         </Polyline>
  //       </Features>
  //     </Set>
  //     <Set net="DGND" testPoint="false" plate="true">  ← pad Set
  //       <Pad padstackDefRef="60C32D">
  //         <PinRef pin="43" componentRef="P9"/>      ← pin connection
  //       </Pad>
  //     </Set>

  const pins: NetPin[] = [];
  const pinsSeen = new Set<string>();
  const routeMap = new Map<string, { widths: Set<number>; segments: number }>();
  const viaMap = new Map<string, number>();
  const skipLayers = new Set(["REF-route", "REF-both"]);

  let currentLayerName = "";
  let insideMatchedSet = false;
  let currentSetHasPolyline = false;
  let currentSetLineDescId: string | undefined;
  let currentSetInlineWidth: number | undefined;
  let currentSetGeometry: string | undefined;

  await streamAllLines(filePath, (line) => {
    // Track which LayerFeature we're in
    if (line.includes("<LayerFeature ")) {
      currentLayerName = attr(line, "layerRef") ?? "";
    }

    // Detect <Set net="..."> matching our target net (skip phantom REF layers)
    if (line.includes("<Set ")) {
      const netName = attr(line, "net");
      insideMatchedSet = netName === matchedNetName && !skipLayers.has(currentLayerName);
      currentSetHasPolyline = false;
      currentSetLineDescId = undefined;
      currentSetInlineWidth = undefined;
      currentSetGeometry = attr(line, "geometry");
    }

    if (insideMatchedSet) {
      // Collect pin references
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          const key = `${compRef}.${pin}`;
          if (!pinsSeen.has(key)) {
            pinsSeen.add(key);
            pins.push({ refdes: compRef, pin });
          }
        }
      }

      // Track polyline (trace) segments
      if (line.includes("<Polyline")) {
        currentSetHasPolyline = true;
      }

      // Capture LineDescRef for width resolution (dictionary reference)
      if (line.includes("<LineDescRef ")) {
        currentSetLineDescId = attr(line, "id");
      }

      // Capture inline LineDesc for width (direct definition inside Polyline)
      if (line.includes("<LineDesc ") && !line.includes("<EntryLineDesc ")) {
        const inlineWidth = numAttr(line, "lineWidth");
        if (inlineWidth !== undefined) {
          currentSetInlineWidth = inlineWidth;
        }
      }

      // Track vias: <Hole platingStatus="VIA"> in DRILL layers
      if (line.includes("<Hole ")) {
        const platingStatus = attr(line, "platingStatus");
        if (platingStatus === "VIA") {
          const diameter = numAttr(line, "diameter");
          const key = currentSetGeometry ?? `dia_${diameter ?? "unknown"}`;
          viaMap.set(key, (viaMap.get(key) ?? 0) + 1);
        }
      }

      if (line.includes("</Set>")) {
        // Finalize the Set: if it had a polyline, record the route segment
        if (currentSetHasPolyline && currentLayerName) {
          if (!routeMap.has(currentLayerName)) {
            routeMap.set(currentLayerName, { widths: new Set(), segments: 0 });
          }
          const layerRoute = routeMap.get(currentLayerName)!;
          layerRoute.segments++;

          // Resolve width: prefer LineDescRef dictionary lookup, fall back to inline LineDesc
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

  const routing: NetRouteInfo[] = [];
  for (const [layerName, data] of routeMap) {
    routing.push({
      layerName,
      traceWidths: [...data.widths].sort((a, b) => a - b),
      segmentCount: data.segments,
    });
  }

  const vias: NetViaInfo[] = [];
  for (const [padstackRef, count] of viaMap) {
    vias.push({ padstackRef, count });
  }

  const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
  const totalVias = vias.reduce((sum, v) => sum + v.count, 0);
  const layersUsed = routing.map((r) => r.layerName).sort();

  return {
    netName: matchedNetName,
    units: "MICRON",
    pins,
    routing,
    vias,
    totalSegments,
    totalVias,
    layersUsed,
  };
};

// =============================================================================
// render_net
// =============================================================================

/**
 * Fixed colors for well-known layers; inner layers get dynamic colors.
 */
const FIXED_LAYER_COLORS: Record<string, string> = {
  TOP: "#e74c3c",
  BOTTOM: "#3498db",
};

const INNER_LAYER_PALETTE = [
  "#2ecc71", // green
  "#9b59b6", // purple
  "#f39c12", // orange
  "#1abc9c", // teal
  "#e67e22", // dark orange
  "#3498db", // (fallback blue variant — won't collide since BOTTOM is already assigned)
  "#e84393", // pink
  "#00cec9", // cyan
];

/**
 * Build a color map for layers actually present in the rendered data.
 * TOP and BOTTOM get fixed colors; inner layers get assigned from the palette.
 */
const buildLayerColors = (layers: string[]): Map<string, string> => {
  const colorMap = new Map<string, string>();
  let paletteIdx = 0;

  for (const layer of layers) {
    const upper = layer.toUpperCase();
    if (upper === "TOP" || upper === "BOTTOM") {
      colorMap.set(layer, FIXED_LAYER_COLORS[upper]);
    } else {
      colorMap.set(layer, INNER_LAYER_PALETTE[paletteIdx % INNER_LAYER_PALETTE.length]);
      paletteIdx++;
    }
  }

  return colorMap;
};

interface Point {
  x: number;
  y: number;
}
interface ArcPoint extends Point {
  centerX: number;
  centerY: number;
  clockwise: boolean;
}
interface Shape {
  type: "rect" | "circle";
  width: number;
  height: number;
}
interface PinDef {
  offsetX: number;
  offsetY: number;
  shapeId: string;
}
interface ComponentPlacement {
  refdes: string;
  packageRef: string;
  x: number;
  y: number;
  rotation: number;
  mirror: boolean;
  layer: string;
}
interface Trace {
  layer: string;
  points: Point[];
  width: number;
}
interface Via {
  x: number;
  y: number;
  drillDiameter: number;
  padstackRef: string;
}

// ---------------------------------------------------------------------------
// Extraction passes (in-memory line scanning)
// ---------------------------------------------------------------------------

const extractShapes = (lines: string[], f: number): Map<string, Shape> => {
  const shapes = new Map<string, Shape>();
  let currentId = "";

  scanLines(lines, (line) => {
    if (line.includes("<EntryStandard ")) {
      currentId = attr(line, "id") ?? "";
    }
    if (currentId && line.includes("<RectCenter ")) {
      const w = numAttr(line, "width");
      const h = numAttr(line, "height");
      if (w !== undefined && h !== undefined) {
        shapes.set(currentId, { type: "rect", width: w * f, height: h * f });
      }
      currentId = "";
    }
    if (currentId && line.includes("<Circle ")) {
      const d = numAttr(line, "diameter");
      if (d !== undefined) {
        shapes.set(currentId, { type: "circle", width: d * f, height: d * f });
      }
      currentId = "";
    }
    if (line.includes("</Content>")) return false;
  });

  return shapes;
};

const extractPackages = (lines: string[]): Map<string, Map<string, PinDef>> => {
  const packages = new Map<string, Map<string, PinDef>>();
  let currentPkg = "";
  let inPad = false;
  let inPin = false;
  let padPin = "";
  let padOffset: Point = { x: 0, y: 0 };
  let padShapeId = "";

  const commitPad = () => {
    if (currentPkg && padPin && padShapeId) {
      packages.get(currentPkg)!.set(padPin, {
        offsetX: padOffset.x,
        offsetY: padOffset.y,
        shapeId: padShapeId,
      });
    }
    padPin = "";
    padOffset = { x: 0, y: 0 };
    padShapeId = "";
  };

  scanLines(lines, (line) => {
    if (line.includes("<Package ")) {
      currentPkg = attr(line, "name") ?? "";
      if (currentPkg && !packages.has(currentPkg)) {
        packages.set(currentPkg, new Map());
      }
    }
    if (line.includes("</Package>")) {
      currentPkg = "";
    }

    if (!currentPkg) return;

    // RevA/B: <LandPattern> → <Pad> → <PinRef>/<Location>/<StandardPrimitiveRef> → </Pad>
    if (line.includes("<Pad") && (line.includes("<Pad>") || line.includes("<Pad "))) {
      inPad = true;
      padPin = "";
      padOffset = { x: 0, y: 0 };
      padShapeId = "";
    }
    if (inPad) {
      if (line.includes("<PinRef ")) {
        padPin = attr(line, "pin") ?? "";
      }
      if (line.includes("<Location ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined) padOffset.x = x;
        if (y !== undefined) padOffset.y = y;
      }
      if (line.includes("<StandardPrimitiveRef ")) {
        padShapeId = attr(line, "id") ?? "";
      }
      if (line.includes("</Pad>")) {
        commitPad();
        inPad = false;
      }
    }

    // RevC: <Pin number="..." ...> → <Location>/<StandardPrimitiveRef> → </Pin>
    if (!inPad && line.includes("<Pin ") && line.includes("number=")) {
      inPin = true;
      padPin = attr(line, "number") ?? "";
      padOffset = { x: 0, y: 0 };
      padShapeId = "";
    }
    if (inPin) {
      if (line.includes("<Location ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined) padOffset.x = x;
        if (y !== undefined) padOffset.y = y;
      }
      if (line.includes("<StandardPrimitiveRef ")) {
        padShapeId = attr(line, "id") ?? "";
      }
      if (line.includes("</Pin>")) {
        commitPad();
        inPin = false;
      }
    }

    if (line.includes("<Component ") && line.includes("refDes=")) return false;
  });

  return packages;
};

const extractViaPadSizes = (
  lines: string[]
): Map<string, { padShapeId: string; drillDiameter: number }> => {
  const viaPads = new Map<string, { padShapeId: string; drillDiameter: number }>();
  let currentName = "";
  let currentDrill = 0;
  let foundRegular = false;

  scanLines(lines, (line) => {
    if (line.includes("<PadStackDef ")) {
      currentName = attr(line, "name") ?? "";
      currentDrill = 0;
      foundRegular = false;
    }
    if (currentName && line.includes("<PadstackHoleDef ")) {
      currentDrill = numAttr(line, "diameter") ?? 0;
    }
    if (currentName && !foundRegular && line.includes('padUse="REGULAR"')) {
      foundRegular = true;
    }
    if (currentName && foundRegular && line.includes("<StandardPrimitiveRef ")) {
      const id = attr(line, "id") ?? "";
      if (id && currentDrill > 0) {
        viaPads.set(currentName, { padShapeId: id, drillDiameter: currentDrill });
      }
      foundRegular = false;
    }
    if (line.includes("</PadStackDef>")) {
      currentName = "";
    }
    if (line.includes("<Package ")) return false;
  });

  return viaPads;
};

const extractComponents = (lines: string[], f: number): ComponentPlacement[] => {
  const components: ComponentPlacement[] = [];
  let current: ComponentPlacement | null = null;

  scanLines(lines, (line) => {
    if (line.includes("<Component ") && line.includes("refDes=")) {
      const refdes = attr(line, "refDes");
      if (refdes) {
        current = {
          refdes,
          packageRef: attr(line, "packageRef") ?? "",
          x: 0,
          y: 0,
          rotation: 0,
          mirror: false,
          layer: attr(line, "layerRef") ?? "",
        };
      }
    }
    if (current) {
      if (line.includes("<Location ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined) current.x = x * f;
        if (y !== undefined) current.y = y * f;
      }
      if (line.includes("<Xform ")) {
        current.rotation = numAttr(line, "rotation") ?? 0;
        current.mirror = attr(line, "mirror") === "true";
      }
      if (line.includes("</Component>")) {
        components.push(current);
        current = null;
      }
    }
    if (line.includes("<PhyNetGroup ") || line.includes("</Step>")) return false;
  });

  return components;
};

const extractProfile = (
  lines: string[],
  f: number
): { points: Point[]; arcs: Map<number, ArcPoint> } => {
  const points: Point[] = [];
  const arcs = new Map<number, ArcPoint>();
  let inProfile = false;

  scanLines(lines, (line) => {
    if (line.includes("<Profile>")) {
      inProfile = true;
      return;
    }
    if (line.includes("</Profile>")) return false;
    if (!inProfile) return;

    if (line.includes("<PolyBegin ")) {
      const x = numAttr(line, "x");
      const y = numAttr(line, "y");
      if (x !== undefined && y !== undefined) points.push({ x: x * f, y: y * f });
    }
    if (line.includes("<PolyStepSegment ")) {
      const x = numAttr(line, "x");
      const y = numAttr(line, "y");
      if (x !== undefined && y !== undefined) points.push({ x: x * f, y: y * f });
    }
    if (line.includes("<PolyStepCurve ")) {
      const x = numAttr(line, "x");
      const y = numAttr(line, "y");
      const cx = numAttr(line, "centerX");
      const cy = numAttr(line, "centerY");
      const cw = attr(line, "clockwise") === "true";
      if (x !== undefined && y !== undefined && cx !== undefined && cy !== undefined) {
        points.push({ x: x * f, y: y * f });
        arcs.set(points.length - 1, {
          x: x * f,
          y: y * f,
          centerX: cx * f,
          centerY: cy * f,
          clockwise: cw,
        });
      }
    }
  });

  return { points, arcs };
};

const extractNetGeometry = (
  lines: string[],
  netName: string,
  f: number
): { traces: Trace[]; vias: Via[] } => {
  const traces: Trace[] = [];
  const vias: Via[] = [];
  let currentLayer = "";
  let insideMatchedSet = false;
  let currentPoints: Point[] = [];
  let currentWidth = 0;
  let inPolyline = false;
  let currentGeometry = "";
  const skipLayers = new Set(["REF-route", "REF-both"]);

  scanLines(lines, (line) => {
    if (line.includes("<LayerFeature ")) {
      currentLayer = attr(line, "layerRef") ?? "";
    }

    if (line.includes("<Set ")) {
      const net = attr(line, "net");
      insideMatchedSet = net === netName && !skipLayers.has(currentLayer);
      currentPoints = [];
      currentWidth = 0;
      inPolyline = false;
      currentGeometry = attr(line, "geometry") ?? "";
    }

    if (!insideMatchedSet) return;

    if (line.includes("<Polyline")) {
      inPolyline = true;
      currentPoints = [];
      currentWidth = 0;
    }
    if (inPolyline) {
      if (line.includes("<PolyBegin ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined && y !== undefined) currentPoints.push({ x: x * f, y: y * f });
      }
      if (line.includes("<PolyStepSegment ")) {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        if (x !== undefined && y !== undefined) currentPoints.push({ x: x * f, y: y * f });
      }
      if (line.includes("<LineDesc ")) {
        const w = numAttr(line, "lineWidth");
        if (w !== undefined) currentWidth = w * f;
      }
      if (line.includes("</Polyline>")) {
        if (currentPoints.length >= 2) {
          traces.push({ layer: currentLayer, points: [...currentPoints], width: currentWidth });
        }
        inPolyline = false;
      }
    }

    if (line.includes("<Hole ")) {
      const status = attr(line, "platingStatus");
      if (status === "VIA") {
        const x = numAttr(line, "x");
        const y = numAttr(line, "y");
        const d = (numAttr(line, "diameter") ?? 0.008) * f;
        if (x !== undefined && y !== undefined) {
          vias.push({ x: x * f, y: y * f, drillDiameter: d, padstackRef: currentGeometry });
        }
      }
    }

    if (line.includes("</Set>")) insideMatchedSet = false;
  });

  return { traces, vias };
};

const extractNetPins = (lines: string[], netName: string): { refdes: string; pin: string }[] => {
  const pins: { refdes: string; pin: string }[] = [];
  const seen = new Set<string>();
  let insideMatchedSet = false;

  scanLines(lines, (line) => {
    if (line.includes("<Set ")) {
      insideMatchedSet = attr(line, "net") === netName;
    }
    if (insideMatchedSet && line.includes("<PinRef ")) {
      const compRef = attr(line, "componentRef");
      const pin = attr(line, "pin");
      if (compRef && pin) {
        const key = `${compRef}.${pin}`;
        if (!seen.has(key)) {
          seen.add(key);
          pins.push({ refdes: compRef, pin });
        }
      }
    }
    if (line.includes("</Set>")) insideMatchedSet = false;
  });

  return pins;
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const transformPin = (comp: ComponentPlacement, pinDef: PinDef, f: number): Point => {
  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let dx = pinDef.offsetX * f;
  const dy = pinDef.offsetY * f;
  if (comp.mirror) dx = -dx;
  return {
    x: comp.x + dx * cos - dy * sin,
    y: comp.y + dx * sin + dy * cos,
  };
};

const svgArc = (prev: Point, arc: ArcPoint): string => {
  const r = Math.sqrt((arc.centerX - prev.x) ** 2 + (arc.centerY - prev.y) ** 2);
  const sweepFlag = arc.clockwise ? 0 : 1;
  return `A${r},${r} 0 0 ${sweepFlag} ${arc.x},${arc.y}`;
};

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

interface RenderData {
  profile: { points: Point[]; arcs: Map<number, ArcPoint> };
  shapes: Map<string, Shape>;
  packages: Map<string, Map<string, PinDef>>;
  viaPadSizes: Map<string, { padShapeId: string; drillDiameter: number }>;
  components: ComponentPlacement[];
  net: { traces: Trace[]; vias: Via[] };
  netPins: { refdes: string; pin: string }[];
  factor: number;
}

const generateSvg = (data: RenderData, netName: string): string => {
  const { profile, shapes, packages, viaPadSizes, components, net, netPins, factor } = data;

  // Build dynamic layer color map from layers actually used
  const allLayers = [
    ...new Set([
      ...net.traces.map((t) => t.layer),
      ...netPins
        .map((np) => {
          const comp = components.find((c) => c.refdes === np.refdes);
          return comp?.layer ?? "";
        })
        .filter(Boolean),
    ]),
  ];
  const layerColors = buildLayerColors(allLayers);

  // Board bounds
  const allPx = profile.points.map((p) => p.x);
  const allPy = profile.points.map((p) => p.y);
  const boardMinX = Math.min(...allPx);
  const boardMaxX = Math.max(...allPx);
  const boardMinY = Math.min(...allPy);
  const boardMaxY = Math.max(...allPy);
  const boardW = boardMaxX - boardMinX;
  const boardH = boardMaxY - boardMinY;
  const margin = Math.max(boardW, boardH) * 0.08;

  const vbX = boardMinX - margin;
  const vbY = boardMinY - margin;
  const vbW = boardW + 2 * margin;
  const vbH = boardH + 2 * margin;
  const svgWidth = 1200;
  const svgHeight = Math.round(svgWidth * (vbH / vbW));
  const fontSize = boardW * 0.008;
  const pinFontSize = boardW * 0.005;

  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">`
  );
  L.push(`  <title>Net: ${netName}</title>`);
  L.push(`  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#1a1a2e"/>`);
  L.push(`  <g transform="scale(1,-1) translate(0,${-(boardMinY + boardMaxY)})">`);

  // Board outline
  if (profile.points.length > 0) {
    let d = `M${profile.points[0].x},${profile.points[0].y}`;
    for (let i = 1; i < profile.points.length; i++) {
      const arc = profile.arcs.get(i);
      d += arc
        ? ` ${svgArc(profile.points[i - 1], arc)}`
        : ` L${profile.points[i].x},${profile.points[i].y}`;
    }
    d += " Z";
    L.push(`    <path d="${d}" fill="#16213e" stroke="#e0e0e0" stroke-width="${boardW * 0.003}"/>`);
  }

  // Component dots
  const compMap = new Map<string, ComponentPlacement>();
  for (const c of components) compMap.set(c.refdes, c);
  const netRefdes = new Set(netPins.map((p) => p.refdes));

  L.push(`    <!-- Components -->`);
  L.push(`    <g>`);
  for (const c of components) {
    const onNet = netRefdes.has(c.refdes);
    L.push(
      `      <circle cx="${c.x}" cy="${c.y}" r="${boardW * 0.0012}" fill="${onNet ? "#ffffff" : "#334155"}" opacity="${onNet ? 0.5 : 0.2}"/>`
    );
  }
  L.push(`    </g>`);

  // Refdes labels for net components
  L.push(`    <!-- Refdes labels -->`);
  L.push(`    <g font-family="monospace" font-size="${fontSize}" fill="#ffffff">`);
  const labeled = new Set<string>();
  for (const p of netPins) {
    if (labeled.has(p.refdes)) continue;
    labeled.add(p.refdes);
    const comp = compMap.get(p.refdes);
    if (!comp) continue;
    L.push(
      `      <text x="${comp.x}" y="${comp.y}" transform="scale(1,-1) translate(0,${-2 * comp.y})" dy="${-fontSize}">${comp.refdes}</text>`
    );
  }
  L.push(`    </g>`);

  // Traces by layer
  const byLayer = new Map<string, Trace[]>();
  for (const t of net.traces) {
    const arr = byLayer.get(t.layer) ?? [];
    arr.push(t);
    byLayer.set(t.layer, arr);
  }
  for (const [layer, layerTraces] of byLayer) {
    const color = layerColors.get(layer) ?? "#7f8c8d";
    L.push(`    <!-- ${netName} — ${layer} -->`);
    L.push(
      `    <g stroke="${color}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">`
    );
    for (const t of layerTraces) {
      const sw = t.width > 0 ? t.width : boardW * 0.003;
      const d = t.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
      L.push(`      <path d="${d}" stroke-width="${sw}"/>`);
    }
    L.push(`    </g>`);
  }

  // SMD pads at pin locations
  L.push(`    <!-- SMD Pads -->`);
  L.push(`    <g>`);
  for (const np of netPins) {
    const comp = compMap.get(np.refdes);
    if (!comp) continue;
    const pkg = packages.get(comp.packageRef);
    if (!pkg) continue;
    const pinDef = pkg.get(np.pin);
    if (!pinDef) continue;
    const pos = transformPin(comp, pinDef, factor);
    const shape = shapes.get(pinDef.shapeId);
    if (!shape) continue;
    const layer = comp.layer || "TOP";
    const color = layerColors.get(layer) ?? "#7f8c8d";

    if (shape.type === "rect") {
      const hw = shape.width / 2;
      const hh = shape.height / 2;
      if (Math.abs(comp.rotation % 180) < 0.1) {
        L.push(
          `      <rect x="${pos.x - hw}" y="${pos.y - hh}" width="${shape.width}" height="${shape.height}" fill="${color}" opacity="0.8"/>`
        );
      } else if (Math.abs((comp.rotation - 90) % 180) < 0.1) {
        L.push(
          `      <rect x="${pos.x - hh}" y="${pos.y - hw}" width="${shape.height}" height="${shape.width}" fill="${color}" opacity="0.8"/>`
        );
      } else {
        const rad = (comp.rotation * Math.PI) / 180;
        L.push(
          `      <rect x="${-hw}" y="${-hh}" width="${shape.width}" height="${shape.height}" fill="${color}" opacity="0.8" transform="translate(${pos.x},${pos.y}) rotate(${rad * (180 / Math.PI)})"/>`
        );
      }
    } else {
      const r = shape.width / 2;
      L.push(`      <circle cx="${pos.x}" cy="${pos.y}" r="${r}" fill="${color}" opacity="0.8"/>`);
    }
  }
  L.push(`    </g>`);

  // Vias
  if (net.vias.length > 0) {
    L.push(`    <!-- Vias -->`);
    L.push(`    <g>`);
    for (const v of net.vias) {
      const viaDef = viaPadSizes.get(v.padstackRef);
      let padDiameter: number;
      if (viaDef) {
        const padShape = shapes.get(viaDef.padShapeId);
        padDiameter = padShape ? padShape.width : v.drillDiameter * 2.25;
      } else {
        padDiameter = v.drillDiameter * 2.25;
      }
      const padR = padDiameter / 2;
      const drillR = v.drillDiameter / 2;
      L.push(
        `      <circle cx="${v.x}" cy="${v.y}" r="${padR}" fill="#c8a415" stroke="#a08410" stroke-width="${boardW * 0.0008}"/>`
      );
      L.push(`      <circle cx="${v.x}" cy="${v.y}" r="${drillR}" fill="#1a1a2e"/>`);
    }
    L.push(`    </g>`);
  }

  // Pin labels
  L.push(`    <!-- Pin labels -->`);
  L.push(
    `    <g font-family="monospace" font-size="${pinFontSize}" fill="#f1c40f" text-anchor="middle">`
  );
  for (const np of netPins) {
    const comp = compMap.get(np.refdes);
    if (!comp) continue;
    const pkg = packages.get(comp.packageRef);
    const pinDef = pkg?.get(np.pin);
    if (pinDef) {
      const pos = transformPin(comp, pinDef, factor);
      L.push(
        `      <text x="${pos.x}" y="${pos.y}" transform="scale(1,-1) translate(0,${-2 * pos.y})" dy="${pinFontSize * 1.8}">${np.refdes}.${np.pin}</text>`
      );
    }
  }
  L.push(`    </g>`);

  // Legend
  const legendX = vbX + margin * 0.3;
  const legendY = boardMaxY + margin * 0.5;
  const legendFS = boardW * 0.01;
  L.push(`    <!-- Legend -->`);
  L.push(
    `    <g font-family="monospace" font-size="${legendFS}" transform="scale(1,-1) translate(0,${-2 * legendY})">`
  );
  let ly = legendY;
  for (const [layer, color] of layerColors) {
    L.push(
      `      <rect x="${legendX}" y="${ly}" width="${legendFS}" height="${legendFS}" fill="${color}"/>`
    );
    L.push(
      `      <text x="${legendX + legendFS * 1.5}" y="${ly + legendFS * 0.85}" fill="#e0e0e0">${layer}</text>`
    );
    ly += legendFS * 1.4;
  }
  L.push(`    </g>`);

  L.push(`  </g>`);
  L.push(`</svg>`);
  return L.join("\n");
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const renderNet = async (
  filePath: string,
  pattern: string
): Promise<RenderNetResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  if (pattern.length > 200) {
    return { error: "Regex pattern too long (max 200 characters)" };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern: '${pattern}'` };
  }

  const lines = await loadAllLines(filePath);

  // Find matching net name
  let matchedNetName: string | null = null;
  scanLines(lines, (line) => {
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        matchedNetName = name;
        return false;
      }
    }
  });

  if (!matchedNetName) {
    return { error: `No net matching pattern '${pattern}' found` };
  }

  const factor = extractMicronFactorFromLines(lines);
  const shapes = extractShapes(lines, factor);
  const packages = extractPackages(lines);
  const viaPadSizes = extractViaPadSizes(lines);
  const components = extractComponents(lines, factor);
  const profile = extractProfile(lines, factor);
  const net = extractNetGeometry(lines, matchedNetName, factor);
  const netPins = extractNetPins(lines, matchedNetName);

  // Count resolved pads
  const compMap = new Map(components.map((c) => [c.refdes, c]));
  let resolvedPads = 0;
  for (const np of netPins) {
    const comp = compMap.get(np.refdes);
    if (!comp) continue;
    const pkg = packages.get(comp.packageRef);
    if (!pkg) continue;
    const pin = pkg.get(np.pin);
    if (pin && shapes.has(pin.shapeId)) resolvedPads++;
  }

  const svg = generateSvg(
    { profile, shapes, packages, viaPadSizes, components, net, netPins, factor },
    matchedNetName
  );

  const layersUsed = [...new Set(net.traces.map((t) => t.layer))].sort();

  return {
    netName: matchedNetName,
    units: "MICRON",
    svg,
    stats: {
      traceCount: net.traces.length,
      viaCount: net.vias.length,
      pinCount: netPins.length,
      resolvedPads,
      layersUsed,
    },
  };
};

// =============================================================================
// export_cadence_board — Cadence IPC-2581 export
// =============================================================================

const serializeExport = createMutex();

const CADENCE_BASE = "C:/Cadence";

/**
 * Scan for Cadence SPB installations that include ipc2581_out.exe.
 */
export const detectCadenceVersions = async (
  cadenceBase = CADENCE_BASE
): Promise<CadenceInstall[]> => {
  const installs: CadenceInstall[] = [];

  try {
    const entries = await readdir(cadenceBase);

    for (const entry of entries) {
      const match = entry.match(/^SPB_(\d+\.\d+)$/);
      if (!match) continue;

      const version = match[1];
      const root = path.join(cadenceBase, entry);
      const exePath = path.join(root, "tools", "bin", "ipc2581_out.exe");

      try {
        await access(exePath);
        installs.push({ version, root, exePath });
      } catch {
        // ipc2581_out.exe not found in this install
      }
    }

    installs.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  } catch {
    // Cadence directory doesn't exist or isn't accessible
  }

  return installs;
};

const REV_B_FLAGS = "-f 1.03 -u MICRON -d -b -l -R -K -n -p -t -c -O -I -D -M -S -k -e";
const REV_C_FLAGS = "-f 1.04 -u MICRON -d -b -l -R -K -G -Y -p -t -c -O -I -D -M -A -B -C -U -k -e";

/**
 * Export a Cadence Allegro .brd file to IPC-2581 XML via ipc2581_out.exe.
 * Windows only. Requires Cadence SPB installation.
 */
export const exportCadenceBoard = async (
  brdPath: string,
  options?: { output?: string; revision?: "B" | "C" }
): Promise<ExportCadenceBoardResult | ErrorResult> => {
  if (process.platform !== "win32") {
    return {
      error:
        "Cadence export is only available on Windows. The ipc2581_out utility requires a Windows environment with Cadence SPB installed.",
    };
  }

  // Validate .brd file
  const resolvedBrd = path.resolve(brdPath);
  if (!resolvedBrd.toLowerCase().endsWith(".brd")) {
    return { error: `Expected a .brd file, got: '${path.basename(resolvedBrd)}'` };
  }
  try {
    const s = await stat(resolvedBrd);
    if (!s.isFile()) {
      return { error: `'${resolvedBrd}' is not a file` };
    }
  } catch {
    return { error: `Board file not found: '${resolvedBrd}'` };
  }

  // Detect Cadence installation
  const installs = await detectCadenceVersions();
  if (installs.length === 0) {
    return {
      error:
        "No Cadence SPB installation with ipc2581_out.exe found in C:/Cadence. Ensure Cadence Allegro/OrCAD PCB Editor is installed.",
    };
  }
  const cadence = installs[0];

  const revision = options?.revision ?? "C";
  const flags = revision === "B" ? REV_B_FLAGS : REV_C_FLAGS;

  // Determine output path
  const brdDir = path.dirname(resolvedBrd);
  const brdName = path.basename(resolvedBrd, ".brd");
  const outputBase = options?.output ?? path.join(brdDir, `${brdName}_ipc2581`);
  // Cadence appends .xml to the output path
  const expectedOutput = outputBase.endsWith(".xml") ? outputBase : `${outputBase}.xml`;

  const command = `"${cadence.exePath}" ${flags} -i "${resolvedBrd}" -o "${outputBase}"`;

  return serializeExport(async () => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: brdDir,
        timeout: 300_000, // 5 minutes
      });

      const log = (stdout + stderr).trim();

      // Check for license failure
      if (log.includes("License checking failed. Terminating")) {
        return {
          error: `Cadence license check failed. Ensure a valid Allegro license is available. Log: ${log}`,
        };
      }

      // Check for success marker
      if (!log.includes("a2ipc2581 complete")) {
        return {
          error: `Export did not complete successfully. Log: ${log}`,
        };
      }

      // Verify output file exists and is non-trivial
      try {
        const outStat = await stat(expectedOutput);
        if (outStat.size < 1024) {
          return {
            error: `Output file is suspiciously small (${outStat.size} bytes): '${expectedOutput}'`,
          };
        }
      } catch {
        return {
          error: `Export reported success but output file not found: '${expectedOutput}'`,
        };
      }

      return {
        success: true,
        outputPath: expectedOutput,
        revision,
        cadenceVersion: cadence.version,
        log: log || undefined,
      };
    } catch (err: unknown) {
      const execError = err as { message?: string; stdout?: string; stderr?: string };
      const combinedLog = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
      return {
        error: `Cadence ipc2581_out failed: ${execError.message ?? "Unknown error"}${combinedLog ? `\nLog: ${combinedLog}` : ""}`,
      };
    }
  });
};
