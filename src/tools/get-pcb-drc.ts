import path from "node:path";
import { z } from "zod";
import type { ErrorResult } from "./lib/types.js";
import { isBrdFile, loadBrdLayout, type BrdDrcMarker } from "./lib/allegro-layout.js";
import { capRowsStratified, MAX_COORD_ROWS, validatePattern, type Detail } from "./shared.js";
import { defineTool } from "./registry.js";

export interface DrcQueryResult {
  fileName: string;
  units: "MICRON";
  markerCount: number;
  /** marker count by check, most first */
  byCheck: Array<{ check: string; count: number }>;
  /** how many DRC checks the board has on, off and in batch mode */
  checkStates: { on: number; off: number; batch: number };
  markers?: BrdDrcMarker[]; // detail="full", capped
  checksOn?: string[]; // detail="full"
  truncated?: boolean;
}

export const queryDrc = async (
  filePath: string,
  check?: string,
  detail: Detail = "summary"
): Promise<DrcQueryResult | ErrorResult> => {
  if (!isBrdFile(filePath)) return { error: "get_pcb_drc reads Allegro .brd files" };
  let regex: RegExp | undefined;
  if (check) {
    const v = validatePattern(check);
    if ("error" in v) return v;
    regex = v.regex;
  }
  const brd = await loadBrdLayout(filePath);
  if (typeof brd === "string") return { error: brd };
  const { markers, checks } = brd.layout.drc;
  const matched = regex ? markers.filter((m) => regex.test(m.check)) : markers;
  const counts = new Map<string, number>();
  for (const m of matched) counts.set(m.check, (counts.get(m.check) ?? 0) + 1);
  const states = { on: 0, off: 0, batch: 0 };
  for (const s of Object.values(checks)) states[s]++;
  const result: DrcQueryResult = {
    fileName: path.basename(filePath),
    units: "MICRON",
    markerCount: matched.length,
    byCheck: [...counts]
      .map(([c, count]) => ({ check: c, count }))
      .sort((a, b) => b.count - a.count),
    checkStates: states,
  };
  if (detail === "full") {
    const capped = capRowsStratified(matched, MAX_COORD_ROWS, (m) => m.check);
    result.markers = capped.rows;
    if (capped.truncated) result.truncated = true;
    result.checksOn = Object.entries(checks)
      .filter(([c, s]) => s !== "off" && (!regex || regex.test(c)))
      .map(([c]) => c)
      .sort();
  }
  return result;
};

export const tool = defineTool({
  name: "get_pcb_drc",
  title: "DRC markers and checks",
  description:
    "Report the DRC markers an Allegro .brd holds from its last DRC run, counted by check (e.g. LINE_TO_LINE_SPACING, PACKAGE_PACKAGE), and how many DRC checks the board has on, off or in batch mode. Set detail='full' for each marker's position, layer, constraint set and the two objects in conflict (pins as REFDES.PIN, vias, tracks and shapes with their net and layer), and the list of checks that are on. Markers are what the last DRC run found; edits since then are not reflected.",
  inputSchema: {
    file: z.string().describe("Path to an Allegro .brd file (Allegro 17.2 to 25.1)"),
    check: z
      .string()
      .optional()
      .describe(
        "Only checks whose name matches this case-insensitive regex (e.g. 'SPACING', 'PACKAGE')"
      ),
    detail: z
      .enum(["summary", "full"])
      .default("summary")
      .describe(
        "'summary' (default) gives counts. 'full' adds each marker (sampled across checks) and the checks that are on."
      ),
  },
  run: ({ file, check, detail }) => queryDrc(file, check, detail),
});
