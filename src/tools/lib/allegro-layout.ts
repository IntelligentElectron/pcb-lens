/**
 * Layout geometry from the binary object database of an Allegro 16.x, 17.x or 18.x `.brd` file: copper
 * layers, placed components with their pads, and every net's pads, tracks, vias and shapes.
 * Block layouts and how each field was confirmed are in docs/allegro-brd-format.md
 * (section 10). Lengths are returned in microns, rounded.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readBrdInfo, type BrdInfo } from "./allegro-brd.js";
import { walkBrdBlocks } from "./allegro-blocks.js";
import { boardOutline } from "./geometry.js";
import type { BoardOutline, OutlineContour, RoutingArc } from "./types.js";

export interface BrdPad {
  pin: string;
  x: number;
  y: number;
  shape: "rect" | "circle" | "oval" | "polygon";
  width: number;
  height: number;
  drill: number; // 0 for a surface-mount pad
  net: string;
}

export interface BrdComponent {
  refdes: string;
  packageRef: string;
  deviceType?: string;
  value?: string;
  x: number;
  y: number;
  rotation: number; // degrees counterclockwise, as seen from the component's side
  layer: string; // top or bottom copper layer name
  pads: BrdPad[];
}

export interface BrdTrack {
  id: number; // key of the 0x05 track block; one block can yield several contiguous runs
  layer: string;
  width: number;
  points: [number, number][];
  arcs: RoutingArc[];
  length: number; // straight spans only, like the IPC-2581 reader
}

export interface BrdVia {
  x: number;
  y: number;
  drill: number;
  span: string; // DRILL_<first>-<last>, 1-based copper layers, as IPC-2581 exports name them
}

export interface BrdNet {
  name: string;
  pins: Array<{ refdes: string; pin: string }>;
  tracks: BrdTrack[];
  vias: BrdVia[];
  shapeLayers: string[]; // one entry per copper shape (pour, plane, fill) on the net
}

export interface BrdLayout {
  copperLayers: Array<{ name: string; plane: boolean }>;
  components: BrdComponent[];
  nets: BrdNet[];
  outline?: BoardOutline;
}

const NET_ITEMS = new Set([0x05, 0x0e, 0x28, 0x32, 0x33, 0x2e]);
const SEGMENT_TYPES = new Set([0x01, 0x15, 0x16, 0x17]);
const PAD_SHAPES: Record<number, BrdPad["shape"]> = {
  0x02: "circle",
  0x05: "rect",
  0x06: "rect",
  0x0b: "oval",
  0x0c: "oval",
  0x1b: "rect", // rounded rectangle, reported by its bounding box
  0x1c: "rect", // chamfered rectangle, same
};
const VALUE_FIELD = 2; // 0x03 field code holding a component's value

// Word offsets of the fields read, which move between the 16.x and 17.x layouts
const V17 = {
  netAssign: 7, // 0x1B
  instPart: 10, // 0x2D: rotation, x, y two words on, first pad five words on
  instRot: 7,
  instPad: 12,
  refdes: 7, // 0x07
  padNext: 6, // 0x32
  padDef: 9, // 0x0D: x at 4, y at 5, padstack at 6
  trackSeg: 14, // 0x05
  graphicSeg: 6, // 0x14
  shapeSeg: 10, // 0x28
  segWidth: 6, // line and arc segments: width, then start and end, then an arc's centre
  viaX: 8, // 0x33
  viaPadstack: 11,
  drill: 16, // 0x1C
};
const V16: typeof V17 = {
  netAssign: 6,
  instPart: 3,
  instRot: 6,
  instPad: 10,
  refdes: 5,
  padNext: 5,
  padDef: 8,
  trackSeg: 12,
  graphicSeg: 5,
  shapeSeg: 8,
  segWidth: 5,
  viaX: 6,
  viaPadstack: 9,
  drill: 4,
};

/** Read a board's layout, or an error string when its object stream cannot be walked. */
export const readBrdLayout = (buf: Buffer, info: BrdInfo): BrdLayout | string => {
  if (buf.byteOffset % 4) buf = Buffer.from(buf); // shortcut: assumes a little-endian host, as all supported targets are
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2);
  const n = w.length;
  const blocks = walkBrdBlocks(w, info);
  if (typeof blocks === "string") return blocks;
  const { starts, byKey } = blocks;
  const i32 = (i: number) => w[i] | 0;
  const um = (raw: number) => Math.round(raw * info.mmPerUnit * 1000);
  const str = (id: number) => info.strings.get(id);
  const type = (i: number) => w[i] & 0xff;
  const cls = (i: number) => (w[i] >>> 16) & 0xff;
  const v16 = info.version.startsWith("16");
  const v18 = info.version.startsWith("18");
  const O = v16 ? V16 : V17;
  const pre165 = v16 && Number(info.version) < 16.5;
  // 17.4 inserts a word in some blocks, and 18.x keeps it
  const v174 = v18 || Number(info.version) >= 17.4;

  // the block with this key, if it has type `t`
  const find = (key: number, t: number) => {
    const i = byKey.get(key);
    return i !== undefined && type(i) === t ? i : undefined;
  };

  // Follow a chain of `t` blocks through the next word `nextAt` until `end`
  const chain = (first: number, end: number, t: number, nextAt = 2) => {
    const out: number[] = [];
    const seen = new Set<number>();
    let k = first;
    while (k && k !== end && !seen.has(k)) {
      seen.add(k);
      const i = find(k, t);
      if (i === undefined) break;
      out.push(i);
      k = w[i + nextAt];
    }
    return out;
  };
  // Header list descriptors (from 0x3C, 0x60 in 18.x): [tail][head], a list ends at its tail
  const list = (index: number, t: number, nextAt = 2) =>
    chain(
      w[(info.listBase >>> 2) + 2 * index + 1],
      w[(info.listBase >>> 2) + 2 * index],
      t,
      nextAt
    );

  // Copper layers: the header layer map holds a 0x2A layer list key per class at 0x42C + 8 *
  // class; ETCH is class 6. A list is [0x2A | count << 16], one more word in 17.4, then count
  // entries, then its key. An entry is [name string, flags, 0], or before 16.5 a 32-byte inline
  // name and flags. Flag 0x8000 marks a routable (signal) layer.
  const etchList = w[(0x42c >>> 2) + 2 * 6];
  const extra = v174 ? 1 : 0;
  const entry = pre165 ? 9 : 3;
  let copperLayers: BrdLayout["copperLayers"] = [];
  const etch = etchList ? find(etchList, 0x2a) : undefined;
  if (etch !== undefined) {
    const count = w[etch] >>> 16;
    const e = etch + 1 + extra; // first entry
    copperLayers = Array.from({ length: count }, (_, j) => {
      const name = pre165
        ? buf.toString("latin1", (e + 9 * j) * 4, buf.indexOf(0, (e + 9 * j) * 4))
        : str(w[e + 3 * j]);
      return {
        name: name || `ETCH_${j + 1}`,
        plane: !(w[e + entry * j + (pre165 ? 8 : 1)] & 0x8000),
      };
    });
  }
  const layerName = (index: number) => copperLayers[index]?.name ?? `ETCH_${index + 1}`;
  const topLayer = copperLayers[0]?.name ?? "TOP";
  const bottomLayer = copperLayers.at(-1)?.name ?? "BOTTOM";

  // Item key -> net name, from each 0x1B net (list 5): word 3 its name, then its first 0x04
  // assignment [04][key][next assignment, or the net at the end][net][first item]. A net has one
  // assignment per connected island; each island's items chain through word 2 back to it.
  const nets: BrdNet[] = [];
  const netOf = new Map<number, string>();
  const netItems: number[][] = [];
  for (const ni of list(5, 0x1b)) {
    const name = str(w[ni + 3]) ?? "";
    const items: number[] = [];
    const seen = new Set<number>();
    for (const a of chain(w[ni + O.netAssign], w[ni + 1], 0x04)) {
      let k = w[a + 4];
      while (k && k !== w[a + 1] && !seen.has(k)) {
        seen.add(k);
        const i = byKey.get(k);
        if (i === undefined || !NET_ITEMS.has(type(i))) break;
        items.push(i);
        netOf.set(k, name);
        k = w[i + 2];
      }
    }
    nets.push({ name, pins: [], tracks: [], vias: [], shapeLayers: [] });
    netItems.push(items);
  }

  // Padstack 0x1C: word 3 name, top byte of word 0 the first copper layer, then the drill (0 for
  // none) and the copper layer count (word 11 in 17.x, the upper half of word 12 in 16.x). Fixed
  // components follow the header, then one group per copper layer whose third component is the
  // pad. 17.x: a 48-word header, 21 fixed, 4 per layer, 9 words each as [shape, ?, width,
  // height, ...]. 16.x: a 21-word header (20 before 16.5), 11 fixed (10), 3 per layer, 7 words
  // each as [?, shape, width, height, ...].
  const [psHeader, psFixed, perLayer, compWords] = v16
    ? pre165
      ? [20, 10, 3, 7]
      : [21, 11, 3, 7]
    : [v18 ? 56 : 48, 21, 4, 9];
  const shapeAt = v16 ? 1 : 0;
  const padstack = (key: number) => {
    const p = find(key, 0x1c);
    if (p === undefined) return undefined;
    const layers = v16 ? w[p + 12] >>> 16 : w[p + 11];
    return {
      drill: um(i32(p + O.drill)),
      first: w[p] >>> 24,
      layers,
      pad: (layer: number) => {
        const c = p + psHeader + (psFixed + perLayer * layer + 2) * compWords;
        return c + 3 < n
          ? { shape: w[c + shapeAt] & 0xff, width: um(i32(c + 2)), height: um(i32(c + 3)) }
          : undefined;
      },
    };
  };

  // An instance's (0x07) word 2 leads to its 0x06 part, through the part's other instances
  const partOf = (inst: number) => {
    const seen = new Set<number>();
    let k = w[inst + 2];
    while (k && !seen.has(k)) {
      seen.add(k);
      const part = find(k, 0x06);
      if (part !== undefined) return part;
      const next = find(k, 0x07);
      if (next === undefined) return undefined;
      k = w[next + 2];
    }
    return undefined;
  };
  // A part's word 8 heads its 0x03 fields: [03 | code << 16][key][next, the part after the last],
  // in 17.x then [owner][?], then [subtype | length << 16][value]; subtype 0x68 is a string
  const lengthAt = v16 ? 3 : 4;
  const textField = (part: number, code: number) => {
    const f = chain(w[part + 8], w[part + 1], 0x03).find(
      (i) => w[i] >>> 16 === code && (w[i + lengthAt] & 0xff) === 0x68
    );
    if (f === undefined) return undefined;
    const start = (f + lengthAt + (v16 ? 1 : 2)) * 4;
    const len = w[f + lengthAt] >>> 16;
    const end = buf.indexOf(0, start);
    return buf.toString("latin1", start, end >= 0 && end < start + len ? end : start + len);
  };

  // Components: 0x2B footprint definitions (list 9: word 2 name, word 8 next, word 9 first
  // instance), each with a chain of 0x2D instances through word 2 ending at the definition.
  // 0x2D: byte 2 of word 0 the side (1 bottom), rotation in millidegrees and then x and y, its
  // 0x07 instance (holding the refdes and its 0x06 part, whose word 3 is the device type) and its
  // first 0x32 pad.
  const components: BrdComponent[] = [];
  const pinsByNet = new Map<string, Array<{ refdes: string; pin: string }>>();
  for (const d of list(9, 0x2b, 8)) {
    const packageRef = str(w[d + 2]) ?? "";
    for (const i of chain(w[d + 9], w[d + 1], 0x2d)) {
      const inst = find(w[i + O.instPart], 0x07);
      const refdes = inst === undefined ? undefined : str(w[inst + O.refdes]);
      if (!refdes) continue; // unnamed mechanical symbols
      const part = inst === undefined ? undefined : partOf(inst);
      const bottom = cls(i) === 1;
      const raw = w[i + O.instRot] / 1000;
      const rot = (raw * Math.PI) / 180;
      const X = i32(i + O.instRot + 1);
      const Y = i32(i + O.instRot + 2);
      const pads: BrdPad[] = [];
      // 0x32 placed pad: word 2 its net chain link, then the next pad and its 0x0D pad
      // definition: word 2 pin name, then (one word later in 17.4) local x, y and the 0x1C
      // padstack key
      for (const p of chain(w[i + O.instPad], 0, 0x32, O.padNext)) {
        const pd = find(w[p + O.padDef], 0x0d);
        if (pd === undefined) continue;
        const o = pd + extra;
        const lx = bottom ? -i32(o + 4) : i32(o + 4); // pads are in the footprint's local frame
        const ly = i32(o + 5);
        const ps = padstack(w[o + 6]);
        const geo = ps?.pad(bottom && ps.layers > 1 ? ps.layers - 1 : 0);
        const pin = str(w[pd + 2]) ?? "";
        const net = netOf.get(w[p + 1]) ?? "";
        pads.push({
          pin,
          x: um(X + lx * Math.cos(rot) - ly * Math.sin(rot)),
          y: um(Y + lx * Math.sin(rot) + ly * Math.cos(rot)),
          shape: PAD_SHAPES[geo?.shape ?? 0] ?? "polygon",
          width: geo?.width ?? 0,
          height: geo?.height ?? 0,
          drill: ps?.drill ?? 0,
          net,
        });
        if (net) (pinsByNet.get(net) ?? pinsByNet.set(net, []).get(net)!).push({ refdes, pin });
      }
      components.push({
        refdes,
        packageRef,
        deviceType: part === undefined ? undefined : str(w[part + 3]),
        value: part === undefined ? undefined : textField(part, VALUE_FIELD),
        x: um(X),
        y: um(Y),
        rotation: bottom ? (360 - raw) % 360 : raw,
        layer: bottom ? bottomLayer : topLayer,
        pads,
      });
    }
  }

  // Segments 0x15/0x16/0x17 (lines) and 0x01 (arcs) chain through word 2 back to their owner (a
  // track, graphic or shape), with word 3 the owner, then width, start and end. An arc's byte 3
  // bit 6 marks it clockwise and the next four words hold its centre as two doubles, high word
  // first.
  const dbl = (i: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(w[i], 0);
    b.writeUInt32BE(w[i + 1], 4);
    return b.readDoubleBE(0);
  };
  type Piece = { start: [number, number]; end: [number, number]; width: number; arc?: RoutingArc };
  const segments = (owner: number, first: number) => {
    const out: Piece[] = [];
    const seen = new Set<number>();
    let k = first;
    while (k && k !== w[owner + 1] && !seen.has(k)) {
      seen.add(k);
      const s = byKey.get(k);
      if (s === undefined || !SEGMENT_TYPES.has(type(s))) break;
      k = w[s + 2];
      const c = s + O.segWidth;
      out.push({
        start: [um(i32(c + 1)), um(i32(c + 2))],
        end: [um(i32(c + 3)), um(i32(c + 4))],
        width: um(i32(c)),
        ...(type(s) === 0x01
          ? {
              arc: {
                index: 0,
                centerX: um(dbl(c + 5)),
                centerY: um(dbl(c + 7)),
                clockwise: Boolean((w[s] >>> 24) & 0x40),
              },
            }
          : {}),
      });
    }
    return out;
  };

  // Net geometry. Track 0x05: byte 3 of word 0 its copper layer, then its first segment.
  nets.forEach((net, ni) => {
    net.pins = pinsByNet.get(net.name) ?? [];
    for (const i of netItems[ni]) {
      const t = type(i);
      const layer = layerName(w[i] >>> 24);
      if (t === 0x28 || t === 0x0e) net.shapeLayers.push(layer);
      else if (t === 0x33) {
        // via: x, y, then its padstack
        const ps = padstack(w[i + O.viaPadstack]);
        const first = ps?.first ?? 0;
        const last = ps && ps.layers > 1 ? first + ps.layers - 1 : copperLayers.length - 1;
        net.vias.push({
          x: um(i32(i + O.viaX)),
          y: um(i32(i + O.viaX + 1)),
          drill: ps?.drill ?? 0,
          span: `DRILL_${first + 1}-${Math.max(last, first) + 1}`,
        });
      } else if (t === 0x05) {
        let track: BrdTrack | undefined;
        for (const { start, end, width, arc } of segments(i, w[i + O.trackSeg])) {
          const last = track?.points[track.points.length - 1];
          if (!track || track.width !== width || last![0] !== start[0] || last![1] !== start[1]) {
            track = { id: w[i + 1], layer, width, points: [start], arcs: [], length: 0 };
            net.tracks.push(track);
          }
          track.points.push(end);
          if (arc) track.arcs.push({ ...arc, index: track.points.length - 1 });
          else track.length += Math.hypot(end[0] - start[0], end[1] - start[1]);
        }
      }
    }
  });

  // Board outline: 0x14 graphics, 0x28 shapes and 0x24 rectangles on BOARD_GEOMETRY (class 1)
  // with subclass 0xEA (DESIGN_OUTLINE), else 0xFD (OUTLINE). Board-level items carry their
  // header list's tail in word 3 (list 4 for graphics, lists 7 for shapes and rectangles); items
  // a footprint draws carry its 0x2D instance (or 0x2B definition) there instead. On a board with
  // no board-level outline, the pieces a mechanical symbol (no refdes) draws are read instead.
  const tail = (index: number) => w[(info.listBase >>> 2) + 2 * index];
  // a placed footprint without a refdes: a mechanical symbol
  const mechanical = (key: number) => {
    const i = find(key, 0x2d);
    const inst = i === undefined ? undefined : find(w[i + O.instPart], 0x07);
    return i !== undefined && !(inst !== undefined && str(w[inst + O.refdes]));
  };
  const outlinePieces = (subclass: number, footprint = false) => {
    const out: Piece[] = [];
    for (const i of starts) {
      const t = type(i);
      if ((t !== 0x14 && t !== 0x28 && t !== 0x24) || cls(i) !== 1 || w[i] >>> 24 !== subclass)
        continue;
      const owner = footprint ? mechanical(w[i + 3]) : w[i + 3] === tail(t === 0x14 ? 4 : 7);
      if (!owner) continue;
      if (t === 0x24) {
        // a rectangle holds its corners directly: words 6-9 in 17.x and 18.x, 5-8 in 16.x
        const r = i + (v16 ? 5 : 6);
        const [x1, y1, x2, y2] = [0, 1, 2, 3].map((j) => um(i32(r + j)));
        const corners: [number, number][] = [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1],
        ];
        for (let j = 0; j < 4; j++) out.push({ start: corners[j], end: corners[j + 1], width: 0 });
      } else out.push(...segments(i, w[i + (t === 0x14 ? O.graphicSeg : O.shapeSeg)]));
    }
    return out;
  };
  const outline = boardOutline(
    contours(
      [
        () => outlinePieces(0xea),
        () => outlinePieces(0xfd),
        () => outlinePieces(0xea, true),
        () => outlinePieces(0xfd, true),
      ].reduce<Piece[]>((found, next) => (found.length ? found : next()), [])
    )
  );

  return { copperLayers, components, nets, ...(outline ? { outline } : {}) };
};

/**
 * Join outline pieces end to end into contours, closed where the drawing closes. Pieces may be
 * stored in any order and direction; one is reversed (and its arc's direction with it) to
 * continue a contour. A full circle is one arc from a point back to itself.
 */
const contours = (
  pieces: Array<{ start: [number, number]; end: [number, number]; arc?: RoutingArc }>
) => {
  const same = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
  const left = [...pieces];
  const out: OutlineContour[] = [];
  while (left.length) {
    const first = left.shift()!;
    const c: OutlineContour = { points: [first.start, first.end], arcs: [] };
    if (first.arc) c.arcs!.push({ ...first.arc, index: 1 });
    const circle = Boolean(first.arc) && same(first.start, first.end);
    while (!circle) {
      const end = c.points[c.points.length - 1];
      if (c.points.length > 2 && same(end, c.points[0])) break;
      const j = left.findIndex((p) => same(p.start, end) || same(p.end, end));
      if (j < 0) break;
      const p = left.splice(j, 1)[0];
      const forward = same(p.start, end);
      c.points.push(forward ? p.end : p.start);
      if (p.arc)
        c.arcs!.push({
          ...p.arc,
          index: c.points.length - 1,
          clockwise: forward ? p.arc.clockwise : !p.arc.clockwise,
        });
    }
    if (!circle && !same(c.points[c.points.length - 1], c.points[0])) c.closed = false;
    out.push(c);
  }
  return out;
};

let cached: { key: string; result: { info: BrdInfo; layout: BrdLayout } } | undefined;

/** Read a .brd's layout, or an error string; the last board read is kept for repeat queries. */
export const loadBrdLayout = async (
  filePath: string
): Promise<{ info: BrdInfo; layout: BrdLayout } | string> => {
  let s;
  try {
    s = await stat(filePath);
  } catch {
    return `File not found: '${filePath}'`;
  }
  if (!s.isFile()) return `'${filePath}' is not a file`;
  const key = `${path.resolve(filePath)}:${s.size}:${s.mtimeMs}`;
  if (cached?.key === key) return cached.result;
  const buf = await readFile(filePath);
  const info = readBrdInfo(buf, ["16", "17", "18"]);
  if (typeof info === "string") return info;
  const layout = readBrdLayout(buf, info);
  if (typeof layout === "string") return layout;
  cached = { key, result: { info, layout } };
  return cached.result;
};

export const isBrdFile = (filePath: string) => path.extname(filePath).toLowerCase() === ".brd";
