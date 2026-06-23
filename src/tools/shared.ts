/**
 * Shared utilities used by multiple tools.
 */

import { stat } from "node:fs/promises";
import type { ErrorResult } from "./lib/types.js";
import { attr, numAttr, streamAllLines, scanLines } from "./lib/xml-utils.js";

// =============================================================================
// MCP Response Formatting
// =============================================================================

export const formatResult = (result: unknown): { content: { type: "text"; text: string }[] } => ({
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
});

// =============================================================================
// Response Detail / Token Budget
//
// These tools are meant to be a token-efficient way for an agent to inspect a
// layout, so no single response should be large enough to blow the caller's
// context. By default, heavy per-coordinate arrays (per-via, per-pad) are
// summarized into compact rollups; callers that genuinely need every coordinate
// pass detail="full". As a hard backstop, even "full" responses cap the raw
// arrays and flag the result as truncated.
//
// Two caps, because the rows differ in cost and value:
//   - MAX_COORD_ROWS: heavy per-coordinate arrays (viaRows/padRows) requested via
//     detail="full". Each row is a numeric tuple, so a few hundred already cost
//     thousands of tokens; this is kept low so even a "full" response on the
//     largest net stays within a typical tool-response budget. At 300 rows a full
//     response is ~18 KB (~4-5k tokens) on the largest known net, a comfortable
//     margin under common tool-response budgets.
//   - MAX_PIN_ROWS: the connectivity pin list, which is the core payload of a net
//     query and far more valuable per row (a short refdes.pin string). It is kept
//     higher so a high-fanout net (e.g. a 1000+ pin GND) still returns useful
//     connectivity rather than being truncated down to the coordinate budget.
// =============================================================================

export type Detail = "summary" | "full";

export const MAX_COORD_ROWS = 300;
export const MAX_PIN_ROWS = 2000;

/**
 * Cap a detail array to `cap` rows. Returns the (possibly sliced) array and
 * whether it was truncated, so callers can surface an explicit `truncated` flag
 * alongside the true total count.
 */
export const capDetailRows = <T>(rows: T[], cap: number): { rows: T[]; truncated: boolean } => {
  const limit = Math.max(0, cap); // defensive: never slice with a negative bound
  return rows.length > limit
    ? { rows: rows.slice(0, limit), truncated: true }
    : { rows, truncated: false };
};

/**
 * Cap grouped coordinate rows to `cap`, apportioning the budget across groups in
 * proportion to each group's share of the total (largest-remainder / Hamilton
 * method) rather than head-slicing, which would bias the sample toward whichever
 * group appears first in the file (e.g. all vias from one drill span). Order is
 * preserved within a group and across groups, so the result is deterministic;
 * `truncated` is true whenever a row was dropped, and a single group reduces to
 * a head-slice. A group whose proportional share rounds below one row may get
 * zero rows (a property of the method), so this does not guarantee every group
 * is represented; callers needing the true per-group totals should read those
 * from the rollup (e.g. `viaCounts`), which is unaffected by this cap.
 */
export const capRowsStratified = <T>(
  rows: T[],
  cap: number,
  groupKey: (row: T) => number | string
): { rows: T[]; truncated: boolean } => {
  const limit = Math.max(0, cap); // defensive: never allocate against a negative bound
  if (rows.length <= limit) return { rows, truncated: false };
  if (limit === 0) return { rows: [], truncated: true };

  // Group rows, preserving first-appearance order of groups and original order
  // within each group.
  const groups = new Map<number | string, T[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const buckets = [...groups.values()];
  const total = rows.length;

  // Largest-remainder apportionment of `limit` across groups by size. Since
  // limit < total, every quota is strictly below its group size, so a base
  // floor plus at most one remainder row can never exceed the group's size.
  const quotas = buckets.map((b) => (b.length * limit) / total);
  const alloc = quotas.map((q) => Math.floor(q));
  let remaining = limit - alloc.reduce((sum, n) => sum + n, 0);
  const byRemainder = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < byRemainder.length && remaining > 0; j++) {
    alloc[byRemainder[j].i]++;
    remaining--;
  }

  // slice() naturally clamps to the bucket length, so no separate guard is
  // needed even though by construction alloc[i] never exceeds it.
  const out = buckets.flatMap((bucket, i) => bucket.slice(0, alloc[i]));

  return { rows: out, truncated: out.length < rows.length };
};

// =============================================================================
// File Validation
// =============================================================================

export const validateFile = async (filePath: string): Promise<ErrorResult | null> => {
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
//
// All tool responses normalize physical values (coordinates, trace widths) to
// microns, regardless of the source file's native unit (MICRON, MILLIMETER,
// INCH). The conversion factor is extracted from <CadHeader units="...">.
// =============================================================================

const UNIT_TO_MICRON: Record<string, number> = {
  MICRON: 1,
  MILLIMETER: 1_000,
  MM: 1_000,
  INCH: 25_400,
};

export const extractMicronFactor = async (filePath: string): Promise<number> => {
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

export const extractMicronFactorFromLines = (lines: string[]): number => {
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

export const buildLineDescDict = async (filePath: string): Promise<Map<string, number>> => {
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
    if (line.includes("</Content>")) {
      return false;
    }
  });

  return dict;
};

// =============================================================================
// Regex Validation
// =============================================================================

export const validatePattern = (pattern: string): { error: string } | { regex: RegExp } => {
  if (pattern.length > 200) {
    return { error: "Regex pattern too long (max 200 characters)" };
  }
  try {
    return { regex: new RegExp(pattern, "i") };
  } catch {
    return { error: `Invalid regex pattern: '${pattern}'` };
  }
};

// =============================================================================
// Net Accumulator (used by get-pcb-net)
// =============================================================================

import type { NetPin, RoutingSegment } from "./lib/types.js";

export interface RawVia {
  x: number;
  y: number;
  diameter: number;
  layer: string;
}

/**
 * Raw per-trace routing geometry collected during scanning. Same shape as the
 * response `RoutingSegment`; only populated when detail="full" is requested.
 */
export type RawSegment = RoutingSegment;

export interface NetAccumulator {
  pins: NetPin[];
  pinsSeen: Set<string>;
  phyNetLayers: Set<string>;
  routeMap: Map<string, { widths: Set<number>; segments: number; traceLength: number }>;
  vias: RawVia[];
  segments: RawSegment[];
}

export const makeAccumulator = (): NetAccumulator => ({
  pins: [],
  pinsSeen: new Set(),
  phyNetLayers: new Set(),
  routeMap: new Map(),
  vias: [],
  segments: [],
});

export const addPin = (acc: NetAccumulator, refdes: string, pin: string): void => {
  const key = `${refdes}.${pin}`;
  if (!acc.pinsSeen.has(key)) {
    acc.pinsSeen.add(key);
    acc.pins.push({ refdes, pin });
  }
};

export const groupPinsByRefdes = (pins: NetPin[]): Record<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const { refdes, pin } of pins) {
    if (!grouped.has(refdes)) {
      grouped.set(refdes, []);
    }
    grouped.get(refdes)!.push(pin);
  }

  const result: Record<string, string[]> = {};
  const sortedRefdes = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  for (const refdes of sortedRefdes) {
    result[refdes] = grouped.get(refdes)!.sort((a, b) => a.localeCompare(b));
  }

  return result;
};
