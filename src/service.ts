/**
 * PCB Layout Service
 *
 * IPC-2581 XML streaming query methods.
 * All methods take a file path to an IPC-2581 XML as input.
 * All physical values (coordinates, trace widths) are normalized to microns.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { attr, numAttr, streamAllLines } from "./xml-utils.js";
import type {
  ErrorResult,
  DesignOverview,
  LayerInfo,
  SectionInfo,
  ComponentResult,
  ComponentInfo,
  QueryComponentsResult,
  QueryNetResult,
  NetPin,
  NetRouteInfo,
  NetViaInfo,
} from "./types.js";

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

    // Detect <Set net="..."> matching our target net
    if (line.includes("<Set ")) {
      const netName = attr(line, "net");
      insideMatchedSet = netName === matchedNetName;
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
