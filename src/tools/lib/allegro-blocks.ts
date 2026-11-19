/**
 * The object stream of an Allegro .brd, read block by block. Blocks follow the string table back to
 * back up to the end of the file (or into all-zero padding); each starts with a type byte and has
 * a size set by its type and the file's release, some sizes growing with a count the block holds.
 * Every block of 75 board files (16.4 to 18.0) is walked this way to the exact end of its file. Sizes
 * and how they were found are in docs/allegro-brd-format.md (section 11).
 */

import type { BrdInfo } from "./allegro-brd.js";

/** Release families whose block sizes differ, oldest first. */
type Family = 0 | 1 | 2 | 3 | 4 | 5; // 16.4 and older, 16.5, 16.6, 17.2, 17.4 and 17.5, 18.x

// Fixed block sizes in words, per family [16.4, 16.5, 16.6, 17.2, 17.4, 18]
const FIXED: Record<number, Array<number | undefined>> = {
  0x01: [20, 20, 20, 21, 21, 21], // arc segment
  0x04: [5, 5, 5, 5, 6, 6], // net assignment
  0x05: [15, 15, 15, 17, 17, 17], // track
  0x06: [9, 9, 9, 10, 10, 10], // part
  0x07: [10, 10, 10, 12, 12, 12], // instance
  0x08: [6, 6, 6, 8, 8, 8],
  0x09: [11, 11, 11, 12, 13, 13],
  0x0a: [17, 17, 17, 18, 19, 19], // DRC marker
  0x0c: [14, 14, 14, 16, 17, 17],
  0x0d: [10, 10, 10, 11, 12, 12], // pad definition
  0x0e: [15, 15, 15, 17, 17, 17], // copper rectangle
  0x0f: [14, 14, 14, 15, 16, 16],
  0x10: [8, 8, 8, 9, 10, 10],
  0x11: [6, 6, 6, 6, 7, 7],
  0x12: [6, 7, 7, 7, 8, 8],
  0x14: [8, 8, 8, 9, 9, 9], // graphic
  0x15: [10, 10, 10, 11, 11, 11], // line segments
  0x16: [10, 10, 10, 11, 11, 11],
  0x17: [10, 10, 10, 11, 11, 11],
  0x1b: [14, 14, 14, 15, 15, 15], // net
  0x22: [11, 11, 11, 11, 11, 11],
  0x23: [21, 21, 21, 21, 22, 22], // ratsnest connection
  0x24: [13, 13, 13, 14, 14, 14], // rectangle
  0x26: [5, 5, 5, 6, 7, 7],
  0x28: [17, 17, 17, 19, 19, 19], // shape
  0x2b: [18, 18, 18, 19, 19, 19], // footprint definition
  0x2c: [9, 9, 9, 11, 11, 11], // table
  0x2d: [16, 16, 16, 18, 18, 18], // placed footprint
  0x2e: [9, 9, 9, 10, 10, 10],
  0x2f: [undefined, undefined, undefined, 8, undefined, undefined], // seen on 17.2 only
  0x30: [11, 11, 11, 14, 15, 15], // text
  0x32: [19, 19, 19, 21, 21, 21], // placed pad
  0x33: [18, 18, 18, 20, 20, 20], // via
  0x34: [8, 8, 8, 9, 9, 9], // keepout
  0x35: [31, 31, 31, 31, 31, 31], // file reference
  0x38: [16, 16, 13, 13, 14, 14], // film
  0x39: [15, 15, 15, 15, 15, 15],
  0x3a: [4, 4, 4, 4, 5, 5],
};

// 0x03 field payloads in words for a type byte whose length half is zero
const FIELD_WORDS: Record<number, number> = {
  0x64: 1,
  0x65: 0,
  0x66: 1,
  0x67: 1,
  0x69: 2,
  0x6a: 1,
};

// 0x36 table record sizes in words, by substruct (byte 2), with per-family overrides
const TABLE_RECORD: Record<number, number> = {
  0x02: 27,
  0x06: 2,
  0x08: 16,
  0x0b: 254,
  0x0f: 5,
  0x10: 27,
};
const TABLE_RECORD_16 = { 0x02: 25, 0x03: 8, 0x06: 52, 0x08: 8 };
const TABLE_RECORD_BY_FAMILY: Partial<Record<Family, Record<number, number>>> = {
  0: TABLE_RECORD_16,
  1: TABLE_RECORD_16,
  2: TABLE_RECORD_16,
  3: { 0x12: 263 }, // 0x12 seen on one 17.2 board only
  4: { 0x08: 17 },
  5: { 0x08: 17, 0x10: 28 },
};

const family = (version: string): Family | undefined => {
  const [major, minor] = version.split(".").map(Number);
  if (major === 16) return minor < 5 ? 0 : minor === 5 ? 1 : 2;
  if (major === 17) return minor < 4 ? 3 : 4;
  if (major === 18) return 5;
  return undefined;
};

const words = (bytes: number) => (bytes + 3) >>> 2;

/** Size in words of the block at word `i`, or undefined for a block type or variant not known. */
const blockSize = (w: Uint32Array, i: number, f: Family): number | undefined => {
  const t = w[i] & 0xff;
  const fixed = FIXED[t];
  if (fixed) return fixed[f];
  const v16 = f <= 2;
  const v174 = f >= 4;
  switch (t) {
    case 0x03: {
      // field: [03][key][next][owner (17.x only)][type | length << 16][0 (17.x only)] then a payload
      const head = v16 ? 4 : 6;
      const tw = w[i + (v16 ? 3 : 4)];
      const sub = tw & 0xff;
      const len = tw >>> 16;
      if (sub === 0x6c) return head + (v16 ? len >>> 2 : len >>> 3);
      if (sub === 0x74) return head + 3 + ((len - 12) >>> 3);
      if (len) return head + words(len);
      return FIELD_WORDS[sub] === undefined ? undefined : head + FIELD_WORDS[sub];
    }
    case 0x1c: {
      // padstack: header, then fixed and per-copper-layer components
      const [header, fixedComps, perLayer, compWords] = v16
        ? f === 0
          ? [20, 10, 3, 7]
          : [21, 11, 3, 7]
        : [f === 5 ? 56 : 48, 21, 4, 9];
      const layers = v16 ? w[i + 12] >>> 16 : w[i + 11];
      return header + (fixedComps + perLayer * layers) * compWords;
    }
    case 0x1d: // physical constraint set: per-layer 14-word and via-slot 64-word records
      return (v16 ? 6 : 7) + (w[i + 5] >>> 16) * 14 + (w[i + 5] & 0xffff) * 64;
    case 0x1e: // electrical constraint set: a text of word-5 bytes
      return (v16 ? 6 : 7) + words(w[i + 5]);
    case 0x1f: // padstack dimensions: per copper layer
      return (v16 ? 8 : 9) + (f === 5 ? 96 : 70) * (w[i + 6] >>> 16);
    case 0x21: // word 1 is the size in bytes
      return w[i + 1] >>> 2;
    case 0x27: {
      // runs to the offset (+1) in the header, or to the end of the file when that is 0
      const end = w[(f === 5 ? 0x28 : 0x18c) >>> 2];
      return (end ? (end - 1) >>> 2 : w.length) - i;
    }
    case 0x2a: // layer list: count entries, then its key
      return 2 + (v174 ? 1 : 0) + (w[i] >>> 16) * (f === 0 ? 9 : 3);
    case 0x31: // text string: length in the upper half of word 5
      return (v174 ? 7 : 6) + words(w[i + 5] >>> 16);
    case 0x36: {
      const sub = (w[i] >>> 16) & 0xff;
      const record = TABLE_RECORD_BY_FAMILY[f]?.[sub] ?? TABLE_RECORD[sub];
      if (record === undefined) return undefined;
      if (v16) return 7 + w[i + 3] * record;
      return (v174 ? 9 : 8) + w[i + 4] * record;
    }
    case 0x37: // key array: capacity in word 4
      return (v174 ? 8 : 7) + w[i + 4];
    case 0x3b: // named property: a 128-byte name, then a value of word-1 bytes
      return (v16 ? 44 : 45) + words(w[i + 1]);
    case 0x3c: // key list
      return v174 ? 4 + w[i + 3] : 3 + w[i + 2];
    default:
      return undefined;
  }
};

export interface BrdBlocks {
  /** Word offset of every block, in file order. */
  starts: number[];
  /** Block word offset by key. */
  byKey: Map<number, number>;
}

/** Walk every block from the end of the string table to the end of the file, or an error string. */
export const walkBrdBlocks = (w: Uint32Array, info: BrdInfo): BrdBlocks | string => {
  const f = family(info.version);
  if (f === undefined) return `Allegro ${info.version} block layout is not known`;
  const n = w.length;
  const starts: number[] = [];
  const byKey = new Map<number, number>();
  let i = info.bodyWord;
  while (i < n) {
    if (!w[i] && w.subarray(i).every((x) => !x)) break; // zero padding to the end
    const t = w[i] & 0xff;
    const size = blockSize(w, i, f);
    // a size from a header offset can point backwards, which would loop
    if (size === undefined || size <= 0 || i + size > n || (w[i] >>> 8) & 0xfd)
      return `Allegro ${info.version} block 0x${t.toString(16)} at byte 0x${(i * 4).toString(16)} is not decoded`;
    starts.push(i);
    // the key is word 1, except: 0x21 word 2, 0x2A its last word; 0x27 and 0x3B have none
    const key = t === 0x21 ? w[i + 2] : t === 0x2a ? w[i + size - 1] : w[i + 1];
    if (t !== 0x27 && t !== 0x3b && key) byKey.set(key, i);
    i += size;
  }
  return { starts, byKey };
};
