/**
 * Constraint data from the binary object database of an Allegro `.brd` file.
 *
 * Reads the header, the string table, 0x1B nets, 0x03 fields, 0x1D physical
 * and 0x1E electrical constraint sets, 0x2C tables (net classes, match groups,
 * diff pairs, regions) with their 0x37 member arrays and 0x26 links, and the
 * 0x36 cross-section. Layouts and confidence levels are in
 * docs/allegro-brd-format.md. Layout families g14.04 (Allegro 17.2) and later.
 */

import { walkBrdBlocks } from "./allegro-blocks.js";
import type { ConstraintObject } from "./types.js";

/**
 * Layout families, oldest first, named by the generation and revision bytes of the magic word.
 * The family fixes the header and every block layout; one Allegro release can write several.
 */
export const LAYOUTS = [
  "g13.00",
  "g13.04",
  "g13.0C",
  "g13.10",
  "g13.15",
  "g14.04",
  "g14.09",
  "g14.14",
  "g15.00",
  "g15.02",
  "g16.01",
] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Position of a family in LAYOUTS, for "this family or later" tests. */
export const at = (l: Layout) => LAYOUTS.indexOf(l);

export interface BrdInfo {
  version: string; // release that last saved the file: "17.2", "23.1", ...
  layout: Layout;
  units: string; // board units: "mm", "mils", ...
  mmPerUnit: number; // mm per internal unit
  strings: Map<number, string>;
  bodyWord: number; // word index of the first object block
  listBase: number; // byte offset of the header list descriptors
  streamEnd: number; // byte offset where the blocks end and the attachment chain starts
}

const UNITS: Record<number, [string, number]> = {
  1: ["mils", 0.0254],
  2: ["inches", 25.4],
  3: ["mm", 1],
  4: ["cm", 10],
  5: ["um", 0.001],
};

// Family of each known `magic >>> 8`; generation 0x13 by revision range
const MAGICS: Record<number, Layout> = {
  0x1404: "g14.04",
  0x1405: "g14.04",
  0x1406: "g14.04",
  0x1407: "g14.04",
  0x1409: "g14.09",
  0x140e: "g14.09",
  0x1411: "g14.09",
  0x1412: "g14.09",
  0x1414: "g14.14",
  0x1415: "g14.14",
  0x1417: "g14.14",
  0x1500: "g15.00",
  0x1502: "g15.02",
  0x1601: "g16.01",
};
const g13 = (rev: number): Layout =>
  rev < 0x04
    ? "g13.00"
    : rev < 0x0c
      ? "g13.04"
      : rev < 0x10
        ? "g13.0C"
        : rev < 0x15
          ? "g13.10"
          : "g13.15";
// Release named when the file holds no last-save record
const RELEASE: Record<Layout, string> = {
  "g13.00": "16.0",
  "g13.04": "16.2",
  "g13.0C": "16.4",
  "g13.10": "16.5",
  "g13.15": "16.6",
  "g14.04": "17.2",
  "g14.09": "17.4",
  "g14.14": "17.4",
  "g15.00": "23.1",
  "g15.02": "25.1",
  "g16.01": "25.1",
};

// Header offsets, by header layout: g14 (generations 0x13 and 0x14), g15 (g15.00), g16 (g15.02, g16.01)
const HEADERS = {
  g14: { lists: 0x3c, units: 0x180, divisor: 0x26c, strings: 0x194, end: 0x18c },
  g15: { lists: 0x60, units: 0x18c, divisor: 0x26c, strings: 0x34, end: 0x28 },
  g16: { lists: 0x60, units: 0x1ac, divisor: 0x28c, strings: 0x34, end: 0x28 },
};
const header = (l: Layout) =>
  HEADERS[at(l) <= at("g14.14") ? "g14" : l === "g15.00" ? "g15" : "g16"];

/**
 * Header and string table, or an error string. `layout` overrides the family the magic names, to
 * try a family for a magic no file has shown yet.
 */
export const readBrdInfo = (buf: Buffer, layout?: Layout): BrdInfo | string => {
  if (buf.length < 0x1200 + 4) return "File too small for an Allegro board";
  const magic = buf.readUInt32LE(0);
  const gen = magic >>> 16;
  layout ??= gen === 0x13 ? g13((magic >>> 8) & 0xff) : MAGICS[magic >>> 8];
  if (!layout) {
    // a revision no file has shown yet: keep the first family of its generation that frames it
    for (const l of LAYOUTS.filter((l) => parseInt(l.slice(1, 3), 16) === gen)) {
      const info = readBrdInfo(buf, l);
      const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2);
      if (
        typeof info === "object" &&
        !(buf.byteOffset % 4) &&
        typeof walkBrdBlocks(w, info) === "object"
      )
        return info;
    }
    return `Allegro database 0x${(magic >>> 8).toString(16)} has no known layout`;
  }
  const h = header(layout);
  const unitCode = buf.readUInt8(h.units);
  if (!UNITS[unitCode]) return `Unknown Allegro board units code ${unitCode}`;
  const [units, mmPer] = UNITS[unitCode];
  const divisor = buf.readUInt32LE(h.divisor); // internal units per board unit
  if (!divisor) return "Allegro board header has a zero units divisor";
  const count = buf.readUInt32LE(h.strings);
  const strings = new Map<number, string>();
  let p = 0x1200;
  for (let i = 0; i < count && p + 4 < buf.length; i++) {
    const id = buf.readUInt32LE(p);
    const end = buf.indexOf(0, p + 4);
    if (end < 0) break;
    strings.set(id, buf.toString("latin1", p + 4, end));
    p += 4 + ((end - p - 4 + 1 + 3) & ~3); // NUL-terminated, padded to 4 bytes
  }
  // 0 on files without attachments: the blocks run to the end of the file
  const end = buf.readUInt32LE(h.end);
  const streamEnd = end ? end - 1 : buf.length & ~3;
  return {
    version: lastSaved(buf, streamEnd, layout) ?? RELEASE[layout],
    layout,
    units,
    mmPerUnit: mmPer / divisor,
    strings,
    bodyWord: p >>> 2,
    listBase: h.lists,
    streamEnd,
  };
};

/**
 * The release in the ALLEGRO_DESIGN_WAS_LAST_SAVED attachment ("allegro 17.4 S037 - 3/2/2023").
 * Attachments run from the end of the blocks to the end of the file: [3B][0][?][0][payload
 * length], a 128-byte name and a 32-byte class, a time and two more words, then the payload
 * padded to 4 bytes; the header is one word shorter before g14.04.
 */
const lastSaved = (buf: Buffer, start: number, layout: Layout) => {
  const head = at(layout) < at("g14.04") ? 176 : 180;
  let p = start;
  while (p > 0 && p + head <= buf.length && buf[p] === 0x3b) {
    const n = buf.readUInt32LE(p + 4);
    if (buf.toString("latin1", p + 8, buf.indexOf(0, p + 8)) === "ALLEGRO_DESIGN_WAS_LAST_SAVED") {
      const line = buf.toString("latin1", p + head, Math.min(p + head + n, buf.length));
      return line.match(/^\S+ (\d+\.\d+)\b/)?.[1];
    }
    p += head + ((n + 3) & ~3);
  }
  return undefined;
};

// 0x03 field codes, verified by matching values and field order against Constraint Manager XML
// of the same boards (docs/allegro-brd-format.md section 7)
export const FIELD_NAMES: Record<number, string> = {
  0x3a: "TOPOLOGY_TEMPLATE_REVISION",
  0x3c: "STUB_LENGTH",
  0x49: "PROPAGATION_DELAY",
  0x55: "MIN_LINE_WIDTH",
  0x58: "MIN_BVIA_GAP",
  0x5b: "VIA_LIST",
  0x5c: "MIN_NECK_WIDTH",
  0x63: "RELATIVE_PROPAGATION_DELAY",
  0x65: "DIFFP_PRIMARY_GAP",
  0x66: "DIFFP_NECK_GAP",
  0x68: "DIFFP_COUPLED_PLUS",
  0x69: "DIFFP_COUPLED_MINUS",
  0x6a: "MIN_NOISE_MARGIN",
  0x6c: "DIFFP_MIN_SPACE",
  0x6d: "DIFFP_GATHER_CONTROL",
  0x6f: "DIFFP_PHASE_TOL",
  0x70: "MIN_FIRST_SWITCH",
  0x71: "MAX_FINAL_SETTLE",
  0x77: "ELECTRICAL_CONSTRAINT_SET",
  0x78: "RATSNEST_SCHEDULE",
  0x7c: "DIFFP_UNCOUPLED_LENGTH",
  0xd3: "IMPEDANCE_RULE",
  0xe6: "NET_SCHEDULE",
  0x173: "MAX_LINE_WIDTH",
  0x1a0: "PHYSICAL_CONSTRAINT_SET",
  0x1a1: "SPACING_CONSTRAINT_SET",
  0x1ce: "THRUPIN_TO_THRUPIN_SPACING",
  0x1d0: "THRUPIN_TO_THRUVIA_SPACING",
  0x1d1: "LINE_TO_THRUPIN_SPACING",
  0x1d2: "THRUPIN_TO_SHAPE_SPACING",
  0x1d3: "SMDPIN_TO_SMDPIN_SPACING",
  0x1d4: "SMDPIN_TO_THRUVIA_SPACING",
  0x1d5: "LINE_TO_SMDPIN_SPACING",
  0x1d6: "SHAPE_TO_SMDPIN_SPACING",
  0x1d7: "THRUVIA_TO_THRUVIA_SPACING",
  0x1d8: "LINE_TO_THRUVIA_SPACING",
  0x1d9: "SHAPE_TO_THRUVIA_SPACING",
  0x1da: "LINE_TO_LINE_SPACING",
  0x1db: "LINE_TO_SHAPE_SPACING",
  0x1dc: "SHAPE_TO_SHAPE_SPACING",
  0x1dd: "BBV_TO_BBV_SPACING",
  0x1de: "BBV_TO_THRUPIN_SPACING",
  0x1df: "BBV_TO_SMDPIN_SPACING",
  0x1e0: "BBV_TO_THRUVIA_SPACING",
  0x1e1: "BBV_TO_LINE_SPACING",
  0x1e2: "BBV_TO_SHAPE_SPACING",
  0x1e3: "BBV_TO_TESTPIN_SPACING",
  0x1e4: "BBV_TO_TESTVIA_SPACING",
  0x1e5: "TESTPIN_TO_TESTPIN_SPACING",
  0x1e6: "TESTPIN_TO_THRUPIN_SPACING",
  0x1e7: "SMDPIN_TO_TESTPIN_SPACING",
  0x1e8: "TESTPIN_TO_THRUVIA_SPACING",
  0x1e9: "TESTPIN_TO_TESTVIA_SPACING",
  0x1ea: "LINE_TO_TESTPIN_SPACING",
  0x1eb: "SHAPE_TO_TESTPIN_SPACING",
  0x1ec: "TESTVIA_TO_TESTVIA_SPACING",
  0x1ed: "TESTVIA_TO_THRUPIN_SPACING",
  0x1ee: "SMDPIN_TO_TESTVIA_SPACING",
  0x1ef: "TESTVIA_TO_THRUVIA_SPACING",
  0x1f0: "LINE_TO_TESTVIA_SPACING",
  0x1f1: "SHAPE_TO_TESTVIA_SPACING",
  0x1f5: "BONDPAD_TO_THRUVIA_SPACING",
  0x1f6: "BONDPAD_TO_LINE_SPACING",
  0x1f7: "BONDPAD_TO_SHAPE_SPACING",
  0x1f8: "BONDPAD_TO_BBV_SPACING",
  0x1f9: "BONDPAD_TO_TESTPIN_SPACING",
  0x1fa: "BONDPAD_TO_TESTVIA_SPACING",
  0x1fb: "MAXIMUM_NECK_LENGTH",
  0x22d: "SN_LINE_TO_SHAPE_SPACING",
  0x253: "HOLE_TO_LINE_SPACING",
  0x25f: "SAME_NET_SPACING_CONSTRAINT_SET",
  0x268: "MVIA_TO_MVIA_SPACING",
  0x269: "MVIA_TO_THRUPIN_SPACING",
  0x26a: "MVIA_TO_SMDPIN_SPACING",
  0x26b: "MVIA_TO_THRUVIA_SPACING",
  0x26c: "MVIA_TO_BBV_SPACING",
  0x26d: "MVIA_TO_LINE_SPACING",
  0x26e: "MVIA_TO_SHAPE_SPACING",
  0x26f: "MVIA_TO_TESTPIN_SPACING",
  0x270: "MVIA_TO_TESTVIA_SPACING",
  0x271: "BONDPAD_TO_MVIA_SPACING",
  0x278: "SN_MVIA_TO_SHAPE_SPACING",
  0x62d: "CDS_SKILL_DEFINED",
};
// Integer fields that hold an enumeration, as the values Constraint Manager XML writes; codes
// not seen yet are reported as numbers
export const FIELD_ENUMS: Record<number, Record<number, string>> = {
  0x6d: { 0: "INCLUDE", 1: "IGNORE" },
  0x78: { 0: "MIN_TREE", 1: "MIN_DAISY_CHAIN", 5: "TEMPLATE", 6: "POWER_AND_GROUND" },
  0xe6: { 0: "DO_NOT_VERIFY", 1: "VERIFY" },
};
const LOGICAL_PATH = 0x37;

// 0x2C table subtypes (upper 16 bits of the first word)
const TABLE_KINDS: Record<number, string> = {
  0x06: "MatchGroup",
  0x15: "NetClass",
  0x16: "Region",
  0x102: "Xnet",
  0x103: "DiffPair",
  0x104: "Bus",
};

// Upper half of 0x1D slot 6; other codes are reported as numbers
const PAD_PAD_MODES: Record<number, string> = {
  0: "ALL_ALLOWED",
  5: "MICROVIAS_MICROVIAS_COINCIDENT_ONLY",
};

// Cross-section layer type codes; names as CDS_LAYER_FUNCTION in Constraint Manager XML
const LAYER_TYPES: Record<number, string> = {
  0: "SURFACE",
  1: "CONDUCTOR",
  2: "DIELECTRIC",
  3: "PLANE",
  21: "DIELECTRIC_PREPREG",
};

// 56-byte per-layer record of a 0x1D block: int32 slot -> Constraint Manager name
const PHYSICAL_SLOTS: Array<[number, string]> = [
  [1, "MIN_LINE_WIDTH"],
  [2, "MIN_NECK_WIDTH"],
  [3, "MAXIMUM_NECK_LENGTH"],
  [4, "MIN_BVIA_STAGGER"],
  [5, "MAX_BVIA_STAGGER"],
  [7, "DIFFP_PRIMARY_GAP"],
  [8, "DIFFP_NECK_GAP"],
  [9, "MAX_LINE_WIDTH"],
  [10, "DIFFP_MIN_SPACE"],
  [11, "DIFFP_COUPLED_PLUS"],
  [12, "DIFFP_COUPLED_MINUS"],
];

const newObject = (name: string): ConstraintObject => ({
  name,
  attributes: {},
  references: [],
  members: [],
});

/**
 * Binary constraint sections of a g14.04 or later board, keyed by section name
 * (BrdPhysicalCSet, BrdElectricalCSet, BrdNetClass, BrdMatchGroup, BrdDiffPair,
 * BrdRegion, BrdXnet, BrdBus, BrdNet, BrdStackup), or an error string when the board's object
 * stream cannot be walked. Lengths are in mm.
 */
export const readBrdConstraints = (
  buf: Buffer,
  info: BrdInfo
): Record<string, ConstraintObject[]> | string => {
  if (at(info.layout) < at("g14.04"))
    return `Allegro ${info.version} constraint blocks are not decoded (17.2 and later only)`;
  if (buf.byteOffset % 4) buf = Buffer.from(buf); // shortcut: assumes a little-endian host, as all supported targets are
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2);
  const n = w.length;
  const str = (id: number) => info.strings.get(id);
  const mm = (raw: number) => ((raw | 0) * info.mmPerUnit).toFixed(4);

  const blocks = walkBrdBlocks(w, info);
  if (typeof blocks === "string") return blocks;
  const { starts, byKey } = blocks;
  const type = (i: number) => w[i] & 0xff;
  // 0x26 [26][key][?][net key][table key]: diff pair and match group membership
  const links = starts.filter((i) => w[i] === 0x26);
  const crossSections = starts.filter((i) => w[i] === 0x00100036); // 0x36 of substruct 0x10

  // Header list descriptors: [tail sentinel][head key]; a list ends at its tail
  const walk = (list: number, ok: (t: number) => boolean) => {
    const tail = buf.readUInt32LE(info.listBase + 8 * list);
    const out: number[] = [];
    const seen = new Set<number>();
    let k = buf.readUInt32LE(info.listBase + 8 * list + 4);
    while (k && k !== tail && !seen.has(k)) {
      seen.add(k);
      const i = byKey.get(k);
      if (i === undefined || !ok(type(i))) break;
      out.push(i);
      k = w[i + 2];
    }
    return out;
  };

  const netBlocks = walk(5, (t) => t === 0x1b);
  // list 12 interleaves 0x1D, 0x1E and 0x1F (padstack dimensions, not read)
  const setBlocks = walk(12, (t) => t >= 0x1d && t <= 0x1f).filter((i) => type(i) !== 0x1f);
  const tableBlocks = walk(15, (t) => t === 0x2c);

  const nameOf = new Map<number, { name: string; kind: string }>();
  for (const i of netBlocks) nameOf.set(w[i + 1], { name: str(w[i + 3]) ?? "", kind: "Net" });
  for (const i of tableBlocks) {
    const kind = TABLE_KINDS[w[i] >>> 16];
    if (kind) nameOf.set(w[i + 1], { name: str(w[i + 6]) ?? "", kind });
  }

  // 0x03 fields: [type 3][0][u16 code] key next owner [u8 subtype][u8][u16 length] 0 value...
  const owners = new Set<number>([...nameOf.keys(), ...setBlocks.map((i) => w[i + 1])]);
  const fields = new Map<number, Record<string, { value: string }>>();
  for (const i of starts) {
    if ((w[i] & 0xffff) !== 3 || !owners.has(w[i + 3])) continue;
    const code = w[i] >>> 16;
    if (!code || code === LOGICAL_PATH) continue;
    const sub = w[i + 4] & 0xff;
    let value: string | undefined;
    if (sub === 0x68) {
      const len = w[i + 4] >>> 16;
      const start = (i + 6) * 4;
      const end = buf.indexOf(0, start);
      value = buf.toString("latin1", start, end >= 0 && end < start + len ? end : start + len);
    } else if (sub === 0x6a) value = str(w[i + 6]);
    else if (sub === 0x66) value = mm(w[i + 6]);
    else if (sub === 0x64) value = FIELD_ENUMS[code]?.[w[i + 6]] ?? String(w[i + 6]);
    else if (sub === 0x65) value = "";
    if (value === undefined) continue; // other subtypes hold records not decoded here
    const rec = fields.get(w[i + 3]) ?? {};
    rec[FIELD_NAMES[code] ?? `FIELD_0x${code.toString(16)}`] = { value };
    fields.set(w[i + 3], rec);
  }

  const out: Record<string, ConstraintObject[]> = {};
  const push = (section: string, obj: ConstraintObject) => (out[section] ??= []).push(obj);

  for (const i of setBlocks) {
    const name = str(w[i + 3]);
    if (name === undefined) continue;
    const obj = newObject(name);
    Object.assign(obj.attributes, fields.get(w[i + 1]));
    if ((w[i] & 0xff) === 0x1e) {
      push("BrdElectricalCSet", obj);
      continue;
    }
    // 0x1D: 24-byte header, nB 56-byte layer records, nA 256-byte via name slots; the live via
    // list ends at the first empty slot, later slots keep stale names
    const nA = buf.readUInt16LE(i * 4 + 20);
    const nB = buf.readUInt16LE(i * 4 + 22);
    const base = i * 4 + 24;
    if (nB > 256 || base + 56 * nB + 256 * nA > buf.length) continue;
    const perLayer = (f: (l: number) => string) => {
      const v = Array.from({ length: nB }, (_, l) => f(base + 56 * l));
      return { value: v.every((x) => x === v[0]) ? v[0] : v.join(":") };
    };
    for (const [slot, attr] of PHYSICAL_SLOTS) {
      obj.attributes[attr] = perLayer((r) => mm(buf.readInt32LE(r + 4 * slot)));
    }
    // slot 6: bit 0 allows routing on the layer, bits 16+ the pad-to-pad connect mode
    obj.attributes.ALLOW_ON_ETCH_SUBCLASS = perLayer((r) =>
      buf.readUInt32LE(r + 24) & 1 ? "TRUE" : "FALSE"
    );
    obj.attributes.PAD_PAD_DIRECT_CONNECT = perLayer((r) => {
      const code = buf.readUInt32LE(r + 24) >>> 16;
      return PAD_PAD_MODES[code] ?? String(code);
    });
    const vias: string[] = [];
    for (let s = 0; s < nA; s++) {
      const p = base + 56 * nB + 256 * s + 4;
      const v = buf.toString("latin1", p, buf.indexOf(0, p));
      if (!v) break;
      vias.push(v);
    }
    if (vias.length) obj.attributes.VIA_LIST = { value: vias.join(":") };
    push("BrdPhysicalCSet", obj);
  }

  const linked = new Map<number, Set<number>>();
  for (const i of links) {
    const member = nameOf.get(w[i + 3])?.kind;
    if ((member !== "Net" && member !== "Xnet") || !nameOf.has(w[i + 4])) continue;
    (linked.get(w[i + 4]) ?? linked.set(w[i + 4], new Set()).get(w[i + 4])!).add(w[i + 3]);
  }

  for (const i of tableBlocks) {
    const kind = TABLE_KINDS[w[i] >>> 16];
    if (!kind) continue;
    const obj = newObject(nameOf.get(w[i + 1])!.name);
    Object.assign(obj.attributes, fields.get(w[i + 1]));
    const keys = new Set<number>(linked.get(w[i + 1]));
    // members: chained 0x37 arrays [37][key][previous][next][capacity][used][capacity + 1 key slots],
    // where previous is the table for the first array; empty slots hold 0
    const seen = new Set<number>();
    let k = w[i + 7];
    let prev = w[i + 1];
    while (k && !seen.has(k)) {
      seen.add(k);
      const a = byKey.get(k);
      if (a === undefined || type(a) !== 0x37 || w[a + 2] !== prev) break;
      for (let j = 0; j <= Math.min(w[a + 4], n - a - 7); j++) {
        if (nameOf.has(w[a + 6 + j])) keys.add(w[a + 6 + j]);
      }
      prev = k;
      k = w[a + 3];
    }
    for (const key of keys)
      obj.members.push({ kind: nameOf.get(key)!.kind, name: nameOf.get(key)!.name });
    push(`Brd${kind}`, obj);
  }

  // Stackup: 0x36 substruct 0x10 [type][key][next][0][capacity][layers][last slot][0], one more 0
  // from g14.09, then last slot + 1 records of 108 bytes (112 from g15.00, 4 more before the
  // thickness), empty ones all zero; doubles are two 32-bit words, high word first, in metres
  const dbl = (p: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(buf.readUInt32LE(p), 0);
    b.writeUInt32BE(buf.readUInt32LE(p + 4), 4);
    return b.readDoubleBE(0);
  };
  const header = at(info.layout) >= at("g14.09") ? 9 : 8;
  const row = at(info.layout) >= at("g15.00") ? 28 : 27;
  const x = row === 28 ? 4 : 0; // the thickness and later fields move by one word
  const readLayers = (i: number) => {
    const count = w[i + 5];
    const slots = w[i + 6] + 1;
    if (count < 3 || slots < count || slots > 256 || i + header + row * slots > n) return undefined;
    const layers = Array.from({ length: slots }, (_, j) => (i + header + row * j) * 4)
      .filter((r) => str(buf.readUInt32LE(r + 40)) !== undefined)
      .map((r) => {
        const t = buf.readUInt32LE(r + 24);
        return {
          index: buf.readUInt32LE(r + 8),
          type: LAYER_TYPES[t] ?? String(t),
          attributes: {
            CDS_LAYER_MATERIAL: str(buf.readUInt32LE(r + 40)) ?? "",
            CDS_LAYER_THICKNESS: String(Number((dbl(r + x + 60) * 1000).toFixed(5))),
            CDS_LAYER_DIELECTRIC_CONSTANT: String(Number(dbl(r + x + 84).toFixed(4))),
            CDS_LAYER_LOSS_TANGENT: String(Number(dbl(r + x + 92).toFixed(5))),
            CDS_LAYER_ELECTRICAL_CONDUCTIVITY: String(Number(dbl(r + x + 100).toPrecision(6))),
          },
        };
      });
    const valid =
      layers.length === count && layers.every((_, j) => layers.some((m) => m.index === j));
    return valid ? layers : undefined;
  };
  for (const i of crossSections) {
    const layers = readLayers(i);
    if (!layers) continue;
    const obj = newObject("PRIMARY");
    obj.crossSection = {
      layers: layers
        .sort((a, b) => a.index - b.index)
        .map(({ type, attributes }) => ({ type, attributes })),
    };
    push("BrdStackup", obj);
  }

  // nets keep the named constraint fields only; most nets carry unnamed bookkeeping codes
  const named = new Set(Object.values(FIELD_NAMES));
  for (const i of netBlocks) {
    const rec = Object.entries(fields.get(w[i + 1]) ?? {}).filter(([k]) => named.has(k));
    if (!rec.length) continue;
    const obj = newObject(nameOf.get(w[i + 1])!.name);
    obj.attributes = Object.fromEntries(rec);
    push("BrdNet", obj);
  }
  return out;
};
