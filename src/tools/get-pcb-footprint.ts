import path from "node:path";
import { z } from "zod";
import type { ErrorResult } from "./lib/types.js";
import {
  isBrdFile,
  loadBrdLayout,
  type BrdFootprint,
  type BrdPadstack,
} from "./lib/allegro-layout.js";
import { capDetailRows, MAX_COORD_ROWS, validatePattern, type Detail } from "./shared.js";
import { defineTool } from "./registry.js";

const MAX_DEFINITIONS = 50;
const MAX_REFDES = 50;

type FootprintRow = Omit<BrdFootprint, "items" | "pins"> & {
  pinCount: number;
  padstacks: string[];
  pins?: BrdFootprint["pins"];
  items?: BrdFootprint["items"];
};
type PadstackRow = Omit<BrdPadstack, "layers"> & {
  // consecutive conductors with the same figures are merged: "LAYER_2..LAYER_13"
  layers: Array<BrdPadstack["layers"][number] & { layer: string }>;
};

export interface FootprintQueryResult {
  fileName: string;
  units: "MICRON";
  footprints: FootprintRow[];
  padstacks: PadstackRow[];
  truncated?: boolean;
}

const mergeLayers = (layers: BrdPadstack["layers"]) => {
  const out: PadstackRow["layers"] = [];
  let key = "";
  for (const l of layers) {
    const { layer, ...figures } = l;
    const k = JSON.stringify(figures);
    const last = out[out.length - 1];
    if (last && k === key) last.layer = `${last.layer.split("..")[0]}..${layer}`;
    else out.push({ ...l });
    key = k;
  }
  return out;
};

export const queryFootprint = async (
  filePath: string,
  pattern: string,
  detail: Detail = "summary"
): Promise<FootprintQueryResult | ErrorResult> => {
  if (!isBrdFile(filePath))
    return {
      error: "get_pcb_footprint reads Allegro .brd files; for IPC-2581 use get_pcb_component",
    };
  const v = validatePattern(pattern);
  if ("error" in v) return v;
  const brd = await loadBrdLayout(filePath);
  if (typeof brd === "string") return { error: brd };

  const fps = brd.layout.footprints.filter((f) => v.regex.test(f.name));
  const pss = brd.layout.padstacks.filter((p) => v.regex.test(p.name));
  if (!fps.length && !pss.length)
    return {
      error: `No footprint or padstack named like '${pattern}'. get_pcb_component gives a component's footprint (packageRef).`,
    };
  let truncated = fps.length > MAX_DEFINITIONS || pss.length > MAX_DEFINITIONS;
  const footprints = fps.slice(0, MAX_DEFINITIONS).map(({ items, pins, refdes, ...f }) => {
    const row: FootprintRow = {
      ...f,
      refdes: refdes.slice(0, MAX_REFDES),
      pinCount: pins.length,
      padstacks: [...new Set(pins.flatMap((p) => p.padstack ?? []))].sort(),
    };
    if (refdes.length > MAX_REFDES) truncated = true;
    if (detail === "full") {
      const p = capDetailRows(pins, MAX_COORD_ROWS);
      const i = capDetailRows(items, MAX_COORD_ROWS);
      row.pins = p.rows;
      row.items = i.rows;
      if (p.truncated || i.truncated) truncated = true;
    }
    return row;
  });
  const padstacks = pss
    .slice(0, MAX_DEFINITIONS)
    .map((p) => ({ ...p, layers: mergeLayers(p.layers) }));
  return {
    fileName: path.basename(filePath),
    units: "MICRON",
    footprints,
    padstacks,
    ...(truncated ? { truncated } : {}),
  };
};

export const tool = defineTool({
  name: "get_pcb_footprint",
  title: "Footprint and padstack definitions",
  description:
    "Look up footprint (package symbol) and padstack definitions of an Allegro .brd by name pattern. A footprint gives its kind, the components placed with it, its pin count, the padstacks its pins use, its extent and properties; detail='full' adds each pin's position, rotation and padstack in the footprint's own frame, and its template drawing (silkscreen, assembly, place bound). A padstack gives its drill, slot, plating and type (smd, through, blind/buried), the pad, antipad and thermal figure on each copper layer, the soldermask and pastemask openings, custom pad outlines and the drill symbol. get_pcb_component gives a component's footprint name (packageRef) and each pad's padstack.",
  inputSchema: {
    file: z.string().describe("Path to an Allegro .brd file (Allegro 16.0 to 25.1)"),
    pattern: z
      .string()
      .describe(
        "Case-insensitive regex on footprint and padstack names (e.g. '^SOIC', 'QFN48', 'VIA')"
      ),
    detail: z
      .enum(["summary", "full"])
      .default("summary")
      .describe(
        "'summary' (default) describes each definition. 'full' adds footprint pins and template drawing, capped."
      ),
  },
  run: ({ file, pattern, detail }) => queryFootprint(file, pattern, detail),
});
