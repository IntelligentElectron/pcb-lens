/**
 * Geometry extraction from IPC-2581 XML lines.
 *
 * Extracts pad shapes, package pin definitions, via padstack sizes,
 * and component placements. Used by render-net and get-via-in-pad.
 */

import { attr, numAttr, scanLines } from "./xml-utils.js";

// =============================================================================
// Types
// =============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  type: "rect" | "circle" | "oval" | "polygon";
  width: number;
  height: number;
}

export interface PinDef {
  offsetX: number;
  offsetY: number;
  /** Inline pad shape id; absent when the shape is reached via `padstackRef`. */
  shapeId?: string;
  /**
   * Padstack referenced by the pad (`padstackDefRef`). Used to resolve the pad
   * shape when the pad has no inline `<StandardPrimitiveRef>` (common for chip
   * passives in some Cadence exports), via `extractPadstackShapes`.
   */
  padstackRef?: string;
}

export interface ComponentPlacement {
  refdes: string;
  packageRef: string;
  x: number;
  y: number;
  rotation: number;
  mirror: boolean;
  layer: string;
}

// =============================================================================
// Extraction functions
// =============================================================================

export const extractShapes = (lines: string[], f: number): Map<string, Shape> => {
  const shapes = new Map<string, Shape>();
  let currentId = "";
  // Bounding-box accumulator for polygon/contour pad shapes, which span multiple
  // lines (a sequence of PolyBegin/PolyStepSegment points) rather than carrying
  // width/height attributes on a single primitive element.
  let inContour = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let contourPoints = 0;

  scanLines(lines, (line) => {
    if (line.includes("<EntryStandard ")) {
      currentId = attr(line, "id") ?? "";
      // Reset the contour state, including the bounding box, so a missing
      // </Contour> in malformed XML cannot bleed stale bounds into the next shape.
      inContour = false;
      contourPoints = 0;
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
    }
    // Rectangular primitives (RectCenter and rounded/chamfered/cornered variants)
    // all expose width/height; we model them all as a rectangle.
    if (
      currentId &&
      (line.includes("<RectCenter ") ||
        line.includes("<RectRound ") ||
        line.includes("<RectCham ") ||
        line.includes("<RectCorner "))
    ) {
      const w = numAttr(line, "width");
      const h = numAttr(line, "height");
      if (w !== undefined && h !== undefined) {
        shapes.set(currentId, { type: "rect", width: w * f, height: h * f });
      }
      currentId = "";
    }
    if (currentId && line.includes("<Oval ")) {
      const w = numAttr(line, "width");
      const h = numAttr(line, "height");
      if (w !== undefined && h !== undefined) {
        shapes.set(currentId, { type: "oval", width: w * f, height: h * f });
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
    // Polygon/Contour pad shapes (common for chip passives in some exports): no
    // width/height attribute, so report the bounding box of the outline points.
    // We enter on either tag but emit only on </Contour>, matching the standard
    // <Contour><Polygon>...</Polygon></Contour> wrapper this export uses.
    if (currentId && (line.includes("<Contour") || line.includes("<Polygon"))) {
      inContour = true;
    }
    if (
      currentId &&
      inContour &&
      (line.includes("<PolyBegin ") || line.includes("<PolyStepSegment "))
    ) {
      const x = numAttr(line, "x");
      const y = numAttr(line, "y");
      if (x !== undefined && y !== undefined) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        contourPoints++;
      }
    }
    if (currentId && inContour && line.includes("</Contour>")) {
      if (contourPoints > 0 && !shapes.has(currentId)) {
        shapes.set(currentId, {
          type: "polygon",
          width: (maxX - minX) * f,
          height: (maxY - minY) * f,
        });
      }
      inContour = false;
      contourPoints = 0;
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      currentId = "";
    }
    if (line.includes("</Content>")) return false;
  });

  return shapes;
};

export const extractPackages = (lines: string[]): Map<string, Map<string, PinDef>> => {
  const packages = new Map<string, Map<string, PinDef>>();
  let currentPkg = "";
  let inPad = false;
  let inPin = false;
  let padPin = "";
  let padOffset: Point = { x: 0, y: 0 };
  let padShapeId = "";
  let padstackRef = "";

  const commitPad = () => {
    // Keep the pad if we have either an inline shape or a padstack reference the
    // caller can resolve later. Chip passives in some exports carry only the
    // latter, so requiring an inline shape here silently dropped their pads.
    if (currentPkg && padPin && (padShapeId || padstackRef)) {
      packages.get(currentPkg)!.set(padPin, {
        offsetX: padOffset.x,
        offsetY: padOffset.y,
        ...(padShapeId ? { shapeId: padShapeId } : {}),
        ...(padstackRef ? { padstackRef } : {}),
      });
    }
    padPin = "";
    padOffset = { x: 0, y: 0 };
    padShapeId = "";
    padstackRef = "";
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

    if (line.includes("<Pad") && (line.includes("<Pad>") || line.includes("<Pad "))) {
      inPad = true;
      padPin = "";
      padOffset = { x: 0, y: 0 };
      padShapeId = "";
      padstackRef = attr(line, "padstackDefRef") ?? "";
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

    if (!inPad && line.includes("<Pin ") && line.includes("number=")) {
      inPin = true;
      padPin = attr(line, "number") ?? "";
      padOffset = { x: 0, y: 0 };
      padShapeId = "";
      padstackRef = attr(line, "padstackDefRef") ?? "";
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

export const extractViaPadSizes = (
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

/**
 * Map of padstack name -> the shape id of its REGULAR (copper) pad.
 *
 * Used to resolve a pad's shape when the pad references a padstack
 * (`padstackDefRef`) instead of carrying an inline `<StandardPrimitiveRef>`.
 * Unlike `extractViaPadSizes`, this does not require a drilled hole, so it also
 * covers surface-mount pads (e.g. chip-passive land patterns).
 */
export const extractPadstackShapes = (lines: string[]): Map<string, string> => {
  const padstacks = new Map<string, string>();
  let currentName = "";
  let foundRegular = false;

  scanLines(lines, (line) => {
    if (line.includes("<PadStackDef ")) {
      currentName = attr(line, "name") ?? "";
      foundRegular = false;
    }
    if (currentName && !foundRegular && line.includes('padUse="REGULAR"')) {
      foundRegular = true;
    }
    if (currentName && foundRegular && line.includes("<StandardPrimitiveRef ")) {
      const id = attr(line, "id") ?? "";
      if (id && !padstacks.has(currentName)) {
        padstacks.set(currentName, id);
      }
      foundRegular = false;
    }
    if (line.includes("</PadStackDef>")) {
      currentName = "";
    }
    // PadStackDef elements precede Package definitions in the IPC-2581 CadData
    // ordering, so stop scanning once packages begin (same as extractViaPadSizes).
    if (line.includes("<Package ")) return false;
  });

  return padstacks;
};

export const extractComponents = (lines: string[], f: number): ComponentPlacement[] => {
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

export const transformPin = (comp: ComponentPlacement, pinDef: PinDef, f: number): Point => {
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
