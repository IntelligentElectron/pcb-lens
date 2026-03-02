/**
 * Streaming XML utilities for IPC-2581 files.
 *
 * IPC-2581 XML is well-formatted (one element per line), so regex
 * attribute extraction works without a DOM/SAX parser. This keeps dependencies
 * minimal and avoids loading 14MB+ (300K+ line) files into memory.
 *
 * Usage guidance:
 * - Use `loadAllLines` + `scanLines` when a tool needs multiple passes over
 *   the same file (e.g., render_net does 7+ passes). Avoids re-reading from disk.
 * - Use `streamAllLines` for single-pass tools where memory efficiency matters.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const attrRegexCache = new Map<string, RegExp>();

/**
 * Extract an XML attribute value from a line by name.
 * Returns undefined if the attribute is not found.
 */
export const attr = (line: string, name: string): string | undefined => {
  let regex = attrRegexCache.get(name);
  if (!regex) {
    regex = new RegExp(`${name}="([^"]*)"`, "i");
    attrRegexCache.set(name, regex);
  }
  const match = line.match(regex);
  return match?.[1];
};

/**
 * Extract a numeric XML attribute value from a line.
 * Returns undefined if the attribute is not found or is not a valid number.
 */
export const numAttr = (line: string, name: string): number | undefined => {
  const value = attr(line, name);
  if (value === undefined) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
};

/**
 * Callback for processing lines within a streamed section.
 * Return `false` to stop streaming early.
 */
export type LineHandler = (line: string, lineNumber: number) => void | false;

/**
 * Count total lines in a file efficiently.
 */
export const countLines = async (filePath: string): Promise<number> => {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;
  for await (const _line of rl) {
    count++;
  }

  rl.close();
  stream.destroy();
  return count;
};

/**
 * Stream every line of a file through a handler.
 * The handler can return `false` to stop early.
 */
export const streamAllLines = async (filePath: string, handler: LineHandler): Promise<void> => {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    if (handler(line, lineNumber) === false) {
      break;
    }
  }

  rl.close();
  stream.destroy();
};

/**
 * Load an entire file into memory as a string array.
 * Use when multiple passes over the same file are needed (avoids re-reading from disk).
 */
export const loadAllLines = async (filePath: string): Promise<string[]> =>
  (await readFile(filePath, "utf-8")).split("\n");

/**
 * Iterate an in-memory line array with the same LineHandler interface as streamAllLines.
 */
export const scanLines = (lines: string[], handler: LineHandler): void => {
  for (let i = 0; i < lines.length; i++) {
    if (handler(lines[i], i + 1) === false) break;
  }
};
