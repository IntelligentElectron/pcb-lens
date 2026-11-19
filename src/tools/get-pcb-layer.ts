import path from "node:path";
import { z } from "zod";
import type { ErrorResult } from "./lib/types.js";
import { isBrdFile, loadBrdLayout, type BrdItem, type BrdLayout } from "./lib/allegro-layout.js";
import { capRowsStratified, MAX_COORD_ROWS, validatePattern, type Detail } from "./shared.js";
import { contourExtent } from "./lib/geometry.js";
import { defineTool } from "./registry.js";

export interface LayerSummary {
  layer: string;
  lines?: number;
  rectangles?: number;
  shapes?: number;
  texts?: number;
  /** Square millimetres of filled shapes and rectangles, voids excluded */
  filledArea?: number;
  extent?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LayerQueryResult {
  fileName: string;
  units: "MICRON";
  itemCount: number;
  layers: LayerSummary[];
  items?: BrdItem[]; // detail="full" only, capped
  truncated?: boolean;
}

const KIND_KEY = {
  line: "lines",
  rectangle: "rectangles",
  shape: "shapes",
  text: "texts",
} as const;

/** Every drawn item of a board: graphics, text and shapes, copper shapes included. */
export const allItems = (layout: BrdLayout): BrdItem[] => [
  ...layout.items,
  ...layout.nets.flatMap((n) => n.shapes),
];

const extentOf = (it: BrdItem) => {
  const boxes = it.contours?.filter((c) => c.points.length).map(contourExtent) ?? [];
  if (it.x !== undefined) boxes.push([it.x, it.y!, it.x, it.y!]);
  if (!boxes.length) return undefined;
  return {
    minX: Math.min(...boxes.map((b) => b[0])),
    minY: Math.min(...boxes.map((b) => b[1])),
    maxX: Math.max(...boxes.map((b) => b[2])),
    maxY: Math.max(...boxes.map((b) => b[3])),
  };
};

export const queryLayer = async (
  filePath: string,
  pattern: string,
  opts: { refdes?: string; within?: string; detail?: Detail } = {}
): Promise<LayerQueryResult | ErrorResult> => {
  if (!isBrdFile(filePath))
    return { error: "get_pcb_layer reads Allegro .brd files; for IPC-2581 use get_pcb_metadata" };
  const v = validatePattern(pattern);
  if ("error" in v) return v;
  let box: number[] | undefined;
  if (opts.within) {
    box = opts.within.split(",").map(Number);
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n)))
      return { error: `'within' must be minX,minY,maxX,maxY in microns, not '${opts.within}'` };
  }
  const brd = await loadBrdLayout(filePath);
  if (typeof brd === "string") return { error: brd };

  const items = allItems(brd.layout).filter((it) => {
    if (!v.regex.test(it.layer) || (opts.refdes && it.refdes !== opts.refdes)) return false;
    if (!box) return true;
    const e = extentOf(it);
    return (
      Boolean(e) && e!.maxX >= box[0] && e!.minX <= box[2] && e!.maxY >= box[1] && e!.minY <= box[3]
    );
  });
  if (!items.length)
    return {
      error: `No items on layers matching '${pattern}'${opts.refdes ? ` drawn by ${opts.refdes}` : ""}${box ? " in that area" : ""}. get_pcb_metadata lists the layers that hold items.`,
    };

  const byLayer = new Map<string, LayerSummary>();
  for (const it of items) {
    const s = byLayer.get(it.layer) ?? byLayer.set(it.layer, { layer: it.layer }).get(it.layer)!;
    s[KIND_KEY[it.kind]] = (s[KIND_KEY[it.kind]] ?? 0) + 1;
    if (it.area) s.filledArea = (s.filledArea ?? 0) + it.area;
    const e = extentOf(it);
    if (e)
      s.extent = s.extent
        ? {
            minX: Math.min(s.extent.minX, e.minX),
            minY: Math.min(s.extent.minY, e.minY),
            maxX: Math.max(s.extent.maxX, e.maxX),
            maxY: Math.max(s.extent.maxY, e.maxY),
          }
        : e;
  }
  const layers = [...byLayer.values()].sort((a, b) => a.layer.localeCompare(b.layer));
  for (const s of layers) if (s.filledArea) s.filledArea = Math.round(s.filledArea * 1e4) / 1e4;

  const result: LayerQueryResult = {
    fileName: path.basename(filePath),
    units: "MICRON",
    itemCount: items.length,
    layers,
  };
  if (opts.detail === "full") {
    const capped = capRowsStratified(items, MAX_COORD_ROWS, (it) => it.layer);
    result.items = capped.rows;
    if (capped.truncated) result.truncated = true;
  }
  return result;
};

export const tool = defineTool({
  name: "get_pcb_layer",
  title: "Items on a layer",
  description:
    "List what is drawn on the layers of an Allegro .brd whose CLASS/SUBCLASS name matches a pattern: lines, rectangles, shapes (copper pours, keepouts, place bounds, soldermask openings, outlines) and text (refdes and value labels, pin numbers, notes). Layers are named as Allegro names them, e.g. 'BOARD_GEOMETRY/SILKSCREEN_TOP', 'PACKAGE_GEOMETRY/PLACE_BOUND_TOP', 'ETCH/TOP'; get_pcb_metadata lists the layers that hold items. The summary gives per-layer counts, filled area and extent. Set detail='full' for each item's geometry and text. Routed tracks and vias are reported by get_pcb_net.",
  inputSchema: {
    file: z.string().describe("Path to an Allegro .brd file (Allegro 16.0 to 25.1)"),
    layer: z
      .string()
      .describe(
        "Case-insensitive regex on CLASS/SUBCLASS layer names (e.g. 'SILKSCREEN_TOP', '^PACKAGE_GEOMETRY/PLACE_BOUND', 'KEEPOUT')"
      ),
    refdes: z.string().optional().describe("Only items drawn by this component (exact refdes)"),
    within: z
      .string()
      .optional()
      .describe("Only items overlapping this box: 'minX,minY,maxX,maxY' in microns"),
    detail: z
      .enum(["summary", "full"])
      .default("summary")
      .describe(
        "'summary' (default) gives counts, filled area and extent per layer. 'full' adds every item's geometry and text, sampled across layers when there are very many."
      ),
  },
  run: ({ file, layer, refdes, within, detail }) =>
    queryLayer(file, layer, { refdes, within, detail }),
});
