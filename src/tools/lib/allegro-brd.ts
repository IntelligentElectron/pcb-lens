/**
 * Constraint data from the binary object database of an Allegro `.brd` file.
 *
 * Reads the header, the string table, 0x1B nets, 0x03 fields, 0x1D physical
 * and 0x1E electrical constraint sets, 0x2C tables (net classes, match groups,
 * diff pairs, regions) with their 0x37 member arrays and 0x26 links, and the
 * 0x36 cross-section. Layouts and confidence levels are in
 * docs/allegro-brd-format.md. Allegro 17.x files only.
 */

import type { ConstraintObject } from "./types.js";

export interface BrdInfo {
  magic: number;
  version: string; // "17.2"
  units: string; // board units: "mm", "mils", ...
  divisor: number; // internal units per board unit
  mmPerUnit: number;
  strings: Map<number, string>;
  bodyWord: number; // word index of the first object block
}

const UNITS: Record<number, [string, number]> = {
  1: ["mils", 0.0254],
  2: ["inches", 25.4],
  3: ["mm", 1],
  4: ["cm", 10],
  5: ["um", 0.001],
};

const VERSIONS: Record<number, string> = { 0x13: "16", 0x14: "17", 0x15: "18" };
const RELEASES: Record<number, string> = { 0x1404: "17.2", 0x1409: "17.4", 0x1415: "17.5" };

/** Header and string table, or an error string. */
export const readBrdInfo = (buf: Buffer): BrdInfo | string => {
  if (buf.length < 0x1200 + 4) return "File too small for an Allegro board";
  const magic = buf.readUInt32LE(0);
  const major = VERSIONS[magic >>> 16];
  if (!major) return `Unrecognised Allegro magic 0x${magic.toString(16)}`;
  const version = RELEASES[(magic >>> 8) & 0xffff] ?? `${major}.x`;
  if (major !== "17") return `Allegro ${version} binary layout is not decoded (17.x only)`;

  const [units, mmPer] = UNITS[buf.readUInt8(0x180)] ?? ["unknown", NaN];
  const divisor = buf.readUInt32LE(0x26c);
  const count = buf.readUInt32LE(0x194);
  const strings = new Map<number, string>();
  let p = 0x1200;
  for (let i = 0; i < count && p + 4 < buf.length; i++) {
    const id = buf.readUInt32LE(p);
    const end = buf.indexOf(0, p + 4);
    if (end < 0) break;
    strings.set(id, buf.toString("latin1", p + 4, end));
    p += 4 + ((end - p - 4 + 1 + 3) & ~3); // NUL-terminated, padded to 4 bytes
  }
  return { magic, version, units, divisor, mmPerUnit: mmPer / divisor, strings, bodyWord: p >>> 2 };
};

// 0x03 field codes, verified by matching values against Constraint Manager XML of the same boards
const FIELD_NAMES: Record<number, string> = {
  0x3a: "TOPOLOGY_TEMPLATE_REVISION",
  0x49: "PROPAGATION_DELAY",
  0x55: "MIN_LINE_WIDTH",
  0x5b: "VIA_LIST",
  0x63: "RELATIVE_PROPAGATION_DELAY",
  0x65: "DIFFP_PRIMARY_GAP",
  0x66: "DIFFP_NECK_GAP",
  0x68: "DIFFP_COUPLED_PLUS",
  0x69: "DIFFP_COUPLED_MINUS",
  0x6c: "DIFFP_MIN_SPACE",
  0x6f: "DIFFP_PHASE_TOL",
  0x77: "ELECTRICAL_CONSTRAINT_SET",
  0x7c: "DIFFP_UNCOUPLED_LENGTH",
  0x173: "MAX_LINE_WIDTH",
  0x1a0: "PHYSICAL_CONSTRAINT_SET",
  0x1a1: "SPACING_CONSTRAINT_SET",
  0x1da: "LINE_TO_LINE_SPACING",
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
 * Binary constraint sections of a 17.x board, keyed by section name
 * (BrdPhysicalCSet, BrdElectricalCSet, BrdNetClass, BrdMatchGroup, BrdDiffPair,
 * BrdRegion, BrdXnet, BrdBus, BrdNet, BrdStackup). Lengths are in mm.
 */
export const readBrdConstraints = (
  buf: Buffer,
  info: BrdInfo
): Record<string, ConstraintObject[]> => {
  if (buf.byteOffset % 4) buf = Buffer.from(buf); // shortcut: assumes a little-endian host, as all supported targets are
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2);
  const n = w.length;
  const str = (id: number) => info.strings.get(id);
  const mm = (raw: number) => ((raw | 0) * info.mmPerUnit).toFixed(4);

  // Block candidates by key. Blocks are word aligned and start with [type][key][next]; a data word
  // can look like a block start, so every list walk below re-checks the chain it follows.
  const nets = new Map<number, number[]>();
  const sets = new Map<number, number[]>();
  const tables = new Map<number, number[]>();
  const arrays = new Map<number, number[]>();
  const links: number[] = []; // 0x26 [26][key][?][net key][table key]: diff pair and match group membership
  const crossSections: number[] = []; // 0x36 blocks of substruct 0x10
  const add = (m: Map<number, number[]>, i: number) => {
    const list = m.get(w[i + 1]);
    if (list) list.push(i);
    else m.set(w[i + 1], [i]);
  };
  for (let i = info.bodyWord; i < n - 8; i++) {
    const t = w[i];
    if (t === 0x1b) add(nets, i);
    else if ((t & 0xffff) >= 0x1d && (t & 0xffff) <= 0x1f)
      add(sets, i); // 0x1F carries flags in byte 2
    else if (t === 0x37) add(arrays, i);
    else if (t === 0x26) links.push(i);
    else if (t === 0x00100036) crossSections.push(i);
    else if ((t & 0xff) === 0x2c) add(tables, i);
  }

  // Header list descriptors: [tail sentinel][head key] from 0x3C; a list ends at its tail
  const walk = (
    list: number,
    cands: Map<number, number[]>,
    ok: (i: number, tail: number) => boolean
  ) => {
    const tail = buf.readUInt32LE(0x3c + 8 * list);
    const out: number[] = [];
    const seen = new Set<number>();
    for (let k = buf.readUInt32LE(0x3c + 8 * list + 4); k && k !== tail && !seen.has(k); ) {
      seen.add(k);
      const i = cands.get(k)?.find((c) => ok(c, tail));
      if (i === undefined) break;
      out.push(i);
      k = w[i + 2];
    }
    return out;
  };
  const chained = (cands: Map<number, number[]>) => (i: number, tail: number) =>
    w[i + 2] === tail || cands.has(w[i + 2]);

  const netBlocks = walk(5, nets, chained(nets));
  // list 12 interleaves 0x1D, 0x1E and 0x1F (padstack dimensions, not read)
  const setBlocks = walk(12, sets, chained(sets)).filter((i) => (w[i] & 0xff) !== 0x1f);
  const tableBlocks = walk(15, tables, (i, tail) => w[i + 3] === tail);

  const nameOf = new Map<number, { name: string; kind: string }>();
  for (const i of netBlocks) nameOf.set(w[i + 1], { name: str(w[i + 3]) ?? "", kind: "Net" });
  for (const i of tableBlocks) {
    const kind = TABLE_KINDS[w[i] >>> 16];
    if (kind) nameOf.set(w[i + 1], { name: str(w[i + 6]) ?? "", kind });
  }

  // 0x03 fields: [type 3][0][u16 code] key next owner [u8 subtype][u8][u16 length] 0 value...
  const owners = new Set<number>([...nameOf.keys(), ...setBlocks.map((i) => w[i + 1])]);
  const fields = new Map<number, Record<string, { value: string }>>();
  for (let i = info.bodyWord; i < n - 8; i++) {
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
    else if (sub === 0x64) value = String(w[i + 6]);
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
    for (const [slot, attr] of PHYSICAL_SLOTS) {
      const perLayer = Array.from({ length: nB }, (_, l) =>
        mm(buf.readInt32LE(base + 56 * l + 4 * slot))
      );
      obj.attributes[attr] = {
        value: perLayer.every((v) => v === perLayer[0]) ? perLayer[0] : perLayer.join(":"),
      };
    }
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
    for (let k = w[i + 7], prev = w[i + 1]; k && !seen.has(k); ) {
      seen.add(k);
      const a = arrays.get(k)?.find((c) => w[c + 2] === prev);
      if (a === undefined) break;
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

  // Stackup: 0x36 substruct 0x10 [type][key][next][0][?][count][count - 1][0], then count records of
  // 108 bytes; doubles are two 32-bit words, high word first, thickness in metres
  const dbl = (p: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(buf.readUInt32LE(p), 0);
    b.writeUInt32BE(buf.readUInt32LE(p + 4), 4);
    return b.readDoubleBE(0);
  };
  for (const i of crossSections) {
    const count = w[i + 5];
    if (w[i + 6] !== count - 1 || count < 3 || count > 200 || i + 8 + 27 * count > n) continue;
    const layers = Array.from({ length: count }, (_, j) => {
      const r = (i + 8 + 27 * j) * 4;
      const t = buf.readUInt32LE(r + 24);
      return {
        index: buf.readUInt32LE(r + 8),
        type: LAYER_TYPES[t] ?? String(t),
        attributes: {
          CDS_LAYER_MATERIAL: str(buf.readUInt32LE(r + 40)) ?? "",
          CDS_LAYER_THICKNESS: String(Number((dbl(r + 60) * 1000).toFixed(5))),
          CDS_LAYER_DIELECTRIC_CONSTANT: String(Number(dbl(r + 84).toFixed(4))),
          CDS_LAYER_LOSS_TANGENT: String(Number(dbl(r + 92).toFixed(5))),
          CDS_LAYER_ELECTRICAL_CONDUCTIVITY: String(Number(dbl(r + 100).toPrecision(6))),
        },
      };
    });
    if (layers.some((_, j) => !layers.some((m) => m.index === j))) continue;
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
