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
