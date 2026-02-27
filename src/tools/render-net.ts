import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { z } from "zod";
import type { ErrorResult, RenderNetResult } from "./lib/types.js";
import { isErrorResult } from "./lib/types.js";
import { attr, numAttr, loadAllLines, scanLines } from "./lib/xml-utils.js";
import {
  extractMicronFactorFromLines,
  formatResult,
  validateFile,
  validatePattern,
} from "./shared.js";

// =============================================================================
// WASM Initialization
// =============================================================================

declare const BUILD_VERSION: string | undefined;

let wasmInitialized = false;

const resolveWasmBuffer = async (): Promise<Buffer> => {
  if (typeof BUILD_VERSION !== "undefined") {
    const { default: wasmPath } = await import("./lib/wasm-embed.js");
    return readFile(wasmPath);
  }
  const wasmUrl = import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm");
  return readFile(fileURLToPath(wasmUrl));
};

const ensureWasmInitialized = async (): Promise<void> => {
  if (wasmInitialized) return;
  await initWasm(await resolveWasmBuffer());
  wasmInitialized = true;
};

const formatRenderResult = async (
  result: RenderNetResult
): Promise<{
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
}> => {
  await ensureWasmInitialized();
  const resvg = new Resvg(result.svg, { fitTo: { mode: "width", value: 1200 } });
  const png = resvg.render().asPng();

  return {
    content: [
      {
        type: "image",
        data: Buffer.from(png).toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "text",
        text: JSON.stringify(
          { netName: result.netName, units: result.units, stats: result.stats },
          null,
          2
        ),
      },
    ],
  };
};

// =============================================================================
// Layer Colors
// =============================================================================

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
  "#3498db", // (fallback blue variant)
  "#e84393", // pink
  "#00cec9", // cyan
];

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

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Extraction passes (in-memory line scanning)
// =============================================================================

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

// =============================================================================
// Geometry helpers
// =============================================================================

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

// =============================================================================
// SVG generation
// =============================================================================

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

// =============================================================================
// Public API
// =============================================================================

export const renderNet = async (
  filePath: string,
  pattern: string
): Promise<RenderNetResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

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

export const register = (server: McpServer): void => {
  server.registerTool(
    "render_net",
    {
      description:
        "Render a net's routing geometry as SVG from an IPC-2581 file. Returns an SVG showing board outline, trace paths by layer, exact SMD pad shapes, via annular rings, and pin labels.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        pattern: z.string().describe("Regex pattern for net name (e.g., '^VDD_3V3B$', 'CLK')"),
      },
    },
    async ({ file, pattern }) => {
      const result = await renderNet(file, pattern);
      if (isErrorResult(result)) return formatResult(result);
      return await formatRenderResult(result);
    }
  );
};
