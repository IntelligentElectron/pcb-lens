/**
 * The object stream of an Allegro .brd, read block by block. Blocks follow the string table back to
 * back up to the end-of-stream offset in the header (the last one is the 0x27 sector table); a chain
 * of 0x3B attachments runs from there to the end of the file. Each block starts with a type byte and
 * has a size set by its type and the file's layout family, some sizes growing with a count the
 * block holds. A walk is accepted only when it ends exactly at the end-of-stream offset and, from
 * g14.04, when its block count matches the header's object count.
 */

import { at, LAYOUTS, type BrdInfo } from "./allegro-brd.js";

// Fixed block sizes in bytes, per family: g13.00 g13.04 g13.0C g13.10 g13.15 g14.04 g14.09 g14.14
// g15.00 g15.02 g16.01
const r = (...runs: Array<[number, number]>) => runs.flatMap(([size, n]) => Array(n).fill(size));
const FIXED: Record<number, Array<number | undefined>> = {
  0x01: r([80, 5], [84, 6]), // arc segment
  0x04: r([20, 6], [24, 5]), // net assignment (branch)
  0x05: r([60, 5], [68, 6]), // track
  0x06: r([36, 5], [40, 6]), // part
  0x07: r([40, 5], [48, 6]), // instance
  0x08: r([24, 5], [32, 6]),
  0x09: r([44, 5], [48, 1], [52, 5]),
  0x0a: r([68, 5], [72, 1], [76, 5]), // DRC marker
  0x0c: r([56, 5], [64, 1], [68, 5]),
  0x0d: r([40, 5], [44, 1], [48, 5]), // pad definition
  0x0e: r([60, 5], [68, 6]), // copper rectangle
  0x0f: r([56, 5], [60, 1], [64, 4], [36, 1]),
  0x10: r([32, 5], [36, 1], [40, 5]),
  0x11: r([24, 6], [28, 5]),
  0x12: r([24, 3], [28, 3], [32, 5]),
  0x14: r([32, 5], [36, 6]), // graphic
  0x15: r([40, 5], [44, 6]), // line segments
  0x16: r([40, 5], [44, 6]),
  0x17: r([40, 5], [44, 6]),
  0x1b: r([56, 5], [60, 6]), // net
  0x20: r([40, 6], [80, 5]), // hatch
  0x22: r([40, 5], [44, 6]),
  0x23: r([68, 2], [84, 4], [88, 5]), // ratsnest connection
  0x24: r([52, 5], [56, 6]), // rectangle
  0x26: r([20, 5], [24, 1], [28, 5]),
  0x28: r([68, 5], [76, 6]), // shape
  0x29: r([56, 11]),
  0x2b: r([68, 2], [72, 3], [76, 6]), // footprint definition
  0x2c: r([36, 5], [44, 6]), // table
  0x2d: r([64, 5], [72, 6]), // placed footprint
  0x2e: r([36, 5], [40, 6]),
  0x2f: r([32, 11]), // padstack reference
  0x30: r([44, 5], [56, 1], [60, 3], [64, 2]), // text
  0x32: r([76, 5], [84, 6]), // placed pad
  0x33: r([72, 5], [80, 6]), // via
  0x34: r([32, 5], [36, 6]), // void
  0x35: r([124, 11]), // file reference
  0x37: r([428, 6]), // key array; sized by its capacity from g14.09
  0x38: r([64, 4], [52, 2], [56, 5]), // film
  0x39: r([60, 11]),
  0x3a: r([16, 6], [20, 5]),
  0x3e: r([0, 10], [44, 1]), // g16.01 only; unknown in g15.02
};

// 0x36 table item sizes in bytes, by discriminator (byte 2), per family as above
export const TABLE_ITEM: Record<number, number[]> = {
  0x02: r([88, 2], [100, 3], [108, 6]),
  0x03: r([32, 5], [64, 1], [68, 5]),
  0x05: r([28, 7], [32, 4]),
  0x06: r([208, 5], [8, 6]),
  0x08: r([32, 5], [64, 1], [68, 4], [64, 1]),
  0x0b: r([1016, 11]),
  0x0c: r([232, 11]),
  0x0d: r([200, 11]),
  0x0f: r([20, 11]),
  0x10: r([108, 8], [112, 3]),
  0x11: r([1600, 11]),
  0x12: r([1052, 11]),
};

const ceil4 = (bytes: number) => (bytes + 3) & ~3;

/** Size in bytes of a variable-size block at word `i` of family `f`, or undefined when not known. */
const variableSize = (w: Uint32Array, i: number, f: number): number | undefined => {
  const t = w[i] & 0xff;
  const v16 = f <= at("g13.15");
  const v174 = f >= at("g14.09");
  const u16 = (byte: number) => (w[i + (byte >>> 2)] >>> ((byte & 2) * 8)) & 0xffff;
  switch (t) {
    case 0x03: {
      // field: [03][key][next][owner (g14.04+)][subtype, flags, u16 size][0 (g14.04+)] then a payload
      const head = v16 ? 16 : 24;
      const tw = w[i + (v16 ? 3 : 4)];
      const s = tw & 0xff;
      const z = tw >>> 16;
      const payload = w[i + head / 4];
      if (s === 0x65) return head;
      if (s === 0x64 || s === 0x66 || s === 0x67 || s === 0x6a) return head + 4;
      if (s === 0x69) return head + 8;
      if (s === 0x6c || s === 0x72) return head + 4 + 4 * payload; // a count, then that many words
      if (s === 0x70 || s === 0x74) return head + 4 + (payload >>> 16) + 4 * (payload & 0xffff);
      if (s === 0xf6) return head + 80;
      if ([0x68, 0x6b, 0x6d, 0x6e, 0x6f, 0x71, 0x73, 0x78].includes(s)) return head + ceil4(z);
      return z === 4 || z === 8 ? head + z : undefined;
    }
    case 0x1c: {
      // padstack: header, fixed and per-copper-layer components, then T 40-byte tails (g14.04+)
      if (v16) {
        const [header, fixedComps] = f <= at("g13.0C") ? [80, 10] : [84, 11];
        return header + (fixedComps + 3 * (w[i + 12] >>> 16)) * 28;
      }
      const h = f >= at("g15.00") ? 208 : 176;
      return 16 + h + (21 + 4 * u16(0x2c)) * 36 + 40 * ((w[i] >>> 16) & 0xff);
    }
    case 0x1d: // physical constraint set: 256-byte via slots and 56-byte layer rows
      return (v16 ? 24 : 28) + 256 * u16(0x14) + 56 * u16(0x16);
    case 0x1e: // electrical constraint set: a text of word-5 bytes (word 4 before g13.0C)
      if (f <= at("g13.04")) return 20 + ceil4(w[i + 4]);
      return (v16 ? 24 : f === at("g16.01") ? 32 : 28) + ceil4(w[i + 5]);
    case 0x1f: {
      // spacing constraint set: one row per copper layer
      const [row, tail] =
        f >= at("g14.14")
          ? [384, 8]
          : f >= at("g14.04")
            ? [280, 8]
            : f >= at("g13.04")
              ? [280, 4]
              : [240, 4];
      return 28 + u16(0x1a) * row + tail;
    }
    case 0x21: // word 1 is the size in bytes
      return w[i + 1];
    case 0x2a: // layer list: count entries, then its key
      return (v174 ? 12 : 8) + u16(2) * (f <= at("g13.0C") ? 36 : 12);
    case 0x31: // text string: length in the upper half of word 5
      return (v174 ? 28 : 24) + ceil4(u16(0x16));
    case 0x36: {
      const item = TABLE_ITEM[u16(2)]?.[f];
      if (item === undefined) return undefined;
      if (v16) return 28 + w[i + 3] * item;
      return (v174 ? 36 : 32) + w[i + 4] * item;
    }
    case 0x3c: // key list
      return v174 ? 16 + 4 * w[i + 3] : 12 + 4 * w[i + 2];
    case 0x37: // key array: its capacity from g14.09
      return 32 + 4 * w[i + 4];
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

/** Walk every block from the end of the string table to the end of the stream, or an error string. */
export const walkBrdBlocks = (w: Uint32Array, info: BrdInfo): BrdBlocks | string => {
  const l = info.layout;
  if (!LAYOUTS.includes(l)) return `Allegro layout ${l} is not known`;
  const fail = (what: string) => `Allegro ${info.version} (${l}) ${what}`;
  const end = info.streamEnd >>> 2;
  if (info.streamEnd % 4 || end > w.length || end < info.bodyWord)
    return fail("has no valid end-of-stream offset");
  const f = at(l);
  // fixed sizes of this family by type; 0 for a type sized from its content
  const fixed = new Uint16Array(256);
  for (const [t, sizes] of Object.entries(FIXED)) fixed[Number(t)] = sizes[f] ?? 0;
  if (f >= at("g14.09")) fixed[0x37] = 0;
  const starts: number[] = [];
  const byKey = new Map<number, number>();
  let i = info.bodyWord;
  while (i < end) {
    const t = w[i] & 0xff;
    // the sector table runs to the end of the stream
    const size = t === 0x27 ? (end - i) * 4 : fixed[t] || variableSize(w, i, f);
    // a size of 0, past the end, or misaligned means a wrong layout or an unknown block
    if (!size || size % 4 || i + size / 4 > end || (w[i] >>> 8) & 0x7d)
      return fail(`block 0x${t.toString(16)} at byte 0x${(i * 4).toString(16)} is not decoded`);
    starts.push(i);
    // the key is word 1, except: 0x21 word 2, 0x2A its last word, 0x35 word 30; 0x27 has none
    const key =
      t === 0x21 ? w[i + 2] : t === 0x2a ? w[i + size / 4 - 1] : t === 0x35 ? w[i + 30] : w[i + 1];
    if (t !== 0x27 && key) {
      if (byKey.has(key)) return fail(`key 0x${key.toString(16)} is used twice`);
      byKey.set(key, i);
    }
    i += size / 4;
  }
  // every block except the sector table, plus every string, makes the header's object count
  if (at(l) >= at("g14.04")) {
    const objects =
      starts.length - starts.filter((s) => (w[s] & 0xff) === 0x27).length + info.strings.size;
    if (objects !== w[5]) return fail(`holds ${objects} objects where its header counts ${w[5]}`);
  }
  return { starts, byKey };
};
