import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import type { ErrorResult } from "./lib/types.js";
import {
  readAttachments,
  readBrdInfo,
  type BrdAttachment,
  type BrdInfo,
} from "./lib/allegro-brd.js";
import { walkBrdBlocks, type BrdBlocks } from "./lib/allegro-blocks.js";
import { isBrdFile } from "./lib/allegro-layout.js";
import { TYPE_NAMES } from "./lib/allegro-names.js";
import { defineTool } from "./registry.js";

const MAX_WORDS = 128;
const MAX_REFS = 50;
const MAX_LIST = 300;
const MAX_TEXT = 20000;

export type Attachment = Omit<BrdAttachment, "payload">;

export type ObjectQueryResult = { fileName: string; layout: string; allegroVersion: string } & (
  | {
      blockCount: number;
      types: Array<{ type: string; name?: string; count: number }>;
      attachments: Attachment[];
    }
  | { type: string; name?: string; count: number; keys: number[]; truncated?: boolean }
  | {
      key: number;
      type: string;
      name?: string;
      byteOffset: number;
      sizeWords: number;
      words: Array<[number, string, string?]>; // [word index, hex value, what it names]
      referencedBy: Array<{ key: number; type: string; word: number }>;
      truncated?: boolean;
    }
  | (Attachment & {
      encoding: "text" | "zip" | "zlib" | "binary";
      text?: string;
      truncated?: boolean;
    })
);

const hex = (n: number, pad = 2) => `0x${n.toString(16).padStart(pad, "0")}`;

let cached: { key: string; buf: Buffer; info: BrdInfo; blocks: BrdBlocks } | undefined;

/** The board's bytes, header and block index; the last board read is kept for repeat calls. */
const load = async (filePath: string) => {
  let s;
  try {
    s = await stat(filePath);
  } catch {
    return `File not found: '${filePath}'`;
  }
  if (!s.isFile()) return `'${filePath}' is not a file`;
  const key = `${path.resolve(filePath)}:${s.size}:${s.mtimeMs}`;
  if (cached?.key === key) return cached;
  let buf = await readFile(filePath);
  if (buf.byteOffset % 4) buf = Buffer.from(buf);
  const info = readBrdInfo(buf);
  if (typeof info === "string") return info;
  const blocks = walkBrdBlocks(new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2), info);
  if (typeof blocks === "string") return blocks;
  cached = { key, buf, info, blocks };
  return cached;
};

export const queryObject = async (
  filePath: string,
  opts: { key?: string; type?: string; attachment?: string } = {}
): Promise<ObjectQueryResult | ErrorResult> => {
  if (!isBrdFile(filePath)) return { error: "get_pcb_object reads Allegro .brd files" };
  const board = await load(filePath);
  if (typeof board === "string") return { error: board };
  const { buf, info, blocks } = board;
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2);
  const { starts } = blocks;
  const base = {
    fileName: path.basename(filePath),
    layout: info.layout,
    allegroVersion: info.version,
  };
  const type = (i: number) => w[i] & 0xff;
  const nameOf = (t: number) => TYPE_NAMES[t];
  const endOf = (k: number) => starts[k + 1] ?? info.streamEnd >>> 2; // block k's end, in words
  const attachments = () => readAttachments(buf, info.streamEnd, info.layout);

  if (opts.attachment !== undefined) {
    const a = attachments().find((x) => x.name === opts.attachment);
    if (!a)
      return {
        error: `No attachment named '${opts.attachment}'; get_pcb_object without arguments lists them`,
      };
    const { payload, ...meta } = a;
    let data = buf.subarray(payload, payload + a.bytes);
    let encoding: "text" | "zip" | "zlib" | "binary" = "binary";
    if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50) encoding = "zip";
    else if (data[0] === 0x78) {
      try {
        data = inflateSync(data);
        encoding = "zlib";
      } catch {
        // not zlib after all
      }
    }
    const text = data.toString("latin1").replace(/\0+$/, "");
    const printable = encoding !== "zip" && /^[\t\n\r\x20-\x7e\x80-\xff]*$/.test(text);
    if (printable && encoding === "binary") encoding = "text";
    return {
      ...base,
      ...meta,
      encoding,
      ...(printable ? { text: text.slice(0, MAX_TEXT) } : {}),
      ...(printable && text.length > MAX_TEXT ? { truncated: true } : {}),
    };
  }

  if (opts.key !== undefined) {
    const key = Number(opts.key);
    const i = Number.isInteger(key) ? blocks.byKey.get(key) : undefined;
    if (i === undefined) return { error: `No block with key ${opts.key}` };
    // the block's index in file order, by binary search on its start
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    const end = endOf(lo);
    const describe = (v: number): string | undefined => {
      const j = blocks.byKey.get(v);
      if (j !== undefined && v > 0xff) return `${hex(type(j))} ${nameOf(type(j)) ?? ""}`.trim();
      const s = info.strings.get(v);
      return s !== undefined && v > 0xff ? JSON.stringify(s) : undefined;
    };
    const words: Array<[number, string, string?]> = [];
    for (let k = 0; k < Math.min(end - i, MAX_WORDS); k++) {
      const d = k ? describe(w[i + k]) : undefined;
      words.push(d ? [k, hex(w[i + k], 8), d] : [k, hex(w[i + k], 8)]);
    }
    // words elsewhere holding this key; coordinates can collide with keys, so this may over-report
    const referencedBy: Array<{ key: number; type: string; word: number }> = [];
    for (let b = 0; b < starts.length; b++) {
      const s = starts[b];
      if (s === i || type(s) === 0x27) continue;
      const e = endOf(b);
      for (let k = 1; k < e - s && referencedBy.length < MAX_REFS; k++)
        if (w[s + k] === key) referencedBy.push({ key: w[s + 1], type: hex(type(s)), word: k });
      if (referencedBy.length >= MAX_REFS) break;
    }
    return {
      ...base,
      key,
      type: hex(type(i)),
      ...(nameOf(type(i)) ? { name: nameOf(type(i)) } : {}),
      byteOffset: i * 4,
      sizeWords: end - i,
      words,
      referencedBy,
      ...(end - i > MAX_WORDS || referencedBy.length >= MAX_REFS ? { truncated: true } : {}),
    };
  }

  if (opts.type !== undefined) {
    const t = Number(opts.type);
    if (!Number.isInteger(t) || t < 0 || t > 0xff)
      return { error: `'type' is a block type number such as 0x1B, not '${opts.type}'` };
    const of = blocks.starts.filter((s) => type(s) === t);
    const keys = [...blocks.byKey].filter(([, s]) => type(s) === t).map(([k]) => k);
    return {
      ...base,
      type: hex(t),
      ...(nameOf(t) ? { name: nameOf(t) } : {}),
      count: of.length,
      keys: keys.slice(0, MAX_LIST),
      ...(keys.length > MAX_LIST ? { truncated: true } : {}),
    };
  }

  const counts = new Map<number, number>();
  for (const s of blocks.starts) counts.set(type(s), (counts.get(type(s)) ?? 0) + 1);
  return {
    ...base,
    blockCount: blocks.starts.length,
    types: [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([t, count]) => ({ type: hex(t), ...(nameOf(t) ? { name: nameOf(t) } : {}), count })),
    attachments: attachments().map(({ payload: _, ...a }) => a),
  };
};

export const tool = defineTool({
  name: "get_pcb_object",
  title: "Raw Allegro database objects",
  description:
    "Look inside the binary database of an Allegro .brd, for data the other tools do not cover. Without arguments: every block type with Allegro's name and count, and the attachments (embedded files such as the last-save record, Constraint Manager archives, 3D models, DBDoctor logs). With 'type': the keys of the blocks of that type. With 'key': that block's words, each word that names another block or a string resolved, and the blocks whose words hold this key. With 'attachment': that attachment's text, decompressed when zlib. Use the named tools first; this is the backstop.",
  inputSchema: {
    file: z.string().describe("Path to an Allegro .brd file (Allegro 16.0 to 25.1)"),
    key: z.string().optional().describe("A block key, decimal or hex (e.g. '81234' or '0x13d52')"),
    type: z.string().optional().describe("A block type number, e.g. '0x1B' (nets) or '0x21'"),
    attachment: z
      .string()
      .optional()
      .describe("An attachment name, e.g. 'ALLEGRO_DESIGN_WAS_LAST_SAVED'"),
  },
  run: ({ file, key, type, attachment }) => queryObject(file, { key, type, attachment }),
});
