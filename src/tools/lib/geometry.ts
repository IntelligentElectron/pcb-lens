/**
 * Geometry extraction from IPC-2581 XML lines.
 *
 * Extracts pad shapes, package pin definitions, via padstack sizes,
 * and component placements. Used by render-net and get-via-in-pad.
 */

import type { BoardOutline, OutlineContour } from "./types.js";
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

// =============================================================================
// Board outline
// =============================================================================

/** [minX, minY, maxX, maxY] of a contour, arcs measured to the axis-crossings their sweep passes. */
export const contourExtent = (c: OutlineContour) => {
  const xs = c.points.map((p) => p[0]);
  const ys = c.points.map((p) => p[1]);
  for (const a of c.arcs ?? []) {
    const [sx, sy] = c.points[a.index - 1];
    const [ex, ey] = c.points[a.index];
    const r = Math.hypot(sx - a.centerX, sy - a.centerY);
    const from = Math.atan2(sy - a.centerY, sx - a.centerX);
    const to = Math.atan2(ey - a.centerY, ex - a.centerX);
    const full = sx === ex && sy === ey;
    // counterclockwise sweep from `from` to `to`; a clockwise arc is the same sweep reversed
    const [lo, hi] = a.clockwise ? [to, from] : [from, to];
    const span = full ? 2 * Math.PI : (((hi - lo) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (let q = 0; q < 4; q++) {
      const ang = (q * Math.PI) / 2;
      const d = (((ang - lo) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d > span) continue;
      xs.push(Math.round(a.centerX + r * Math.cos(ang)));
      ys.push(Math.round(a.centerY + r * Math.sin(ang)));
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/**
 * Extent and order of outline contours: the largest is the board edge, closed or not; the
 * other open fragments are dropped. An arc's extent includes the axis-crossings its sweep
 * passes, so a rounded or circular edge is measured to its true limit.
 */
export const boardOutline = (contours: OutlineContour[]): BoardOutline | undefined => {
  const extent = contourExtent;
  const area = (e: number[]) => (e[2] - e[0]) * (e[3] - e[1]);
  const seen = new Set<string>();
  const sized = contours
    .filter((c) => c.points.length >= 3 || c.arcs?.length)
    .map((c) => ({ c, e: extent(c) }))
    .sort((a, b) => area(b.e) - area(a.e))
    // the board edge is the largest contour; other open fragments are stray lines
    .filter(({ c }, i) => i === 0 || c.closed !== false)
    // some boards draw a contour twice, from another vertex or in the other direction
    .filter(({ c }) => {
      const pts = c.closed === false ? c.points : c.points.slice(1); // closing point repeats
      const key = JSON.stringify([...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]));
      return !seen.has(key) && seen.add(key);
    });
  if (!sized.length) return undefined;
  const [minX, minY, maxX, maxY] = sized[0].e;
  return {
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
    maxX,
    maxY,
    contours: sized.map(({ c }) => {
      const { arcs, ...rest } = c;
      return arcs?.length ? c : rest;
    }),
  };
};
