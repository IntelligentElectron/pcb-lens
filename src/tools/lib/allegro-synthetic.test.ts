import { describe, it, expect } from "vitest";
import { readBrdInfo, type BrdInfo } from "./allegro-brd.js";
import { readBrdLayout } from "./allegro-layout.js";

/**
 * A minimal board: one net N1 with two pads of U1, two 0x23 ratsnest pairs between them (one
 * connected, one not) and a 0x0A DRC marker naming both pads. `late` builds it in the g14.09
 * layout (17.4), else in g14.04 (17.2), where these blocks are one word shorter.
 */
const board = (late: boolean) => {
  const strings = ["N1", "FP", "U1", "1", "2", "SET_A"]; // ids 0x100 to 0x105
  const S = (s: string) => 0x100 + strings.indexOf(s);
  const k = {
    net: 0x200,
    branch: 0x201,
    padA: 0x202,
    padB: 0x203,
    def: 0x204,
    inst: 0x205,
    comp: 0x206,
  };
  const K = { ...k, pinA: 0x207, pinB: 0x208, ratOpen: 0x209, ratDone: 0x20a, drc: 0x20b };
  const x = late ? 1 : 0; // the word g14.09 inserts in 0x04, 0x0D, 0x23 and 0x0A
  const blocks: number[][] = [];
  const block = (size: number, set: Record<number, number>) => {
    const b = new Array(size).fill(0);
    for (const [i, v] of Object.entries(set)) b[Number(i)] = v;
    blocks.push(b);
  };
  block(15, { 0: 0x1b, 1: K.net, 2: 1 + 5, 3: S("N1"), 7: K.branch }); // net, list 5
  block(5 + x, { 0: 0x04, 1: K.branch, 2: K.net, 3: K.net, 4: K.padA }); // its one branch
  for (const [pad, next, pin, link] of [
    [K.padA, K.padB, K.pinA, K.padB],
    [K.padB, K.branch, K.pinB, 0],
  ])
    block(21, { 0: 0x000c0032, 1: pad, 2: next, 6: link, 9: pin }); // placed pads
  block(19, { 0: 0x00010000 | 0x2b, 1: K.def, 2: S("FP"), 8: 1 + 9, 9: K.inst }); // footprint, list 9
  block(18, { 0: 0x2d, 1: K.inst, 2: K.def, 10: K.comp, 12: K.padA }); // placed at the origin
  block(12, { 0: 0x07, 1: K.comp, 7: S("U1") });
  block(11 + x, { 0: 0x0d, 1: K.pinA, 2: S("1"), [4 + x]: 1000 }); // footprint pins
  block(11 + x, { 0: 0x0d, 1: K.pinB, 2: S("2"), [4 + x]: -1000 });
  for (const [key, connected] of [
    [K.ratOpen, 0],
    [K.ratDone, 1],
  ])
    block(21 + x, {
      0: 0x23 | (connected << 24),
      1: key,
      2: K.net,
      [5 + x]: K.padA,
      [7 + x]: K.padB,
    });
  // DRC marker, list 11: point (500, 0), set SET_A, both pads, check 0x16 LINE_TO_LINE_SPACING
  block(18 + x, {
    0: 0x0a | (5 << 16) | (0xfd << 24),
    1: K.drc,
    2: 1 + 11,
    5: 500,
    7: 500,
    9: S("SET_A"),
    10: K.padA,
    11: K.padB,
    [12 + x]: 0x16,
  });

  const table = strings.flatMap((s, i) => {
    const b = Buffer.alloc(4 + ((s.length + 1 + 3) & ~3));
    b.writeUInt32LE(0x100 + i, 0);
    b.write(s, 4, "latin1");
    return [...new Uint32Array(b.buffer, b.byteOffset, b.length >>> 2)];
  });
  const body = [...table, ...blocks.flat()];
  const buf = Buffer.alloc(0x1200 + body.length * 4);
  buf.writeUInt32LE(late ? 0x00140900 : 0x00140400, 0);
  buf.writeUInt32LE(blocks.length + strings.length, 0x14); // object count
  buf.writeUInt8(3, 0x180); // mm
  buf.writeUInt32LE(10000, 0x26c);
  buf.writeUInt32LE(strings.length, 0x194);
  buf.writeUInt32LE(buf.length + 1, 0x18c); // the stream runs to the end of the file
  for (const [list, head] of [
    [5, K.net],
    [9, K.def],
    [11, K.drc],
  ]) {
    buf.writeUInt32LE(1 + list, 0x3c + 8 * list); // sentinel
    buf.writeUInt32LE(head, 0x3c + 8 * list + 4);
  }
  body.forEach((v, i) => buf.writeUInt32LE(v >>> 0, 0x1200 + 4 * i));
  return buf;
};

describe.each([
  ["g14.04", false],
  ["g14.09", true],
])("a synthetic %s board", (layout, late) => {
  const buf = board(late);
  const info = readBrdInfo(buf) as BrdInfo;
  const L = readBrdLayout(buf, info);
  if (typeof L === "string") throw new Error(L);

  it("frames in its own layout", () => expect(info.layout).toBe(layout));

  it("reports the pair the routing does not connect", () => {
    expect(L.nets.find((n) => n.name === "N1")?.unrouted).toEqual([["U1.1", "U1.2"]]);
  });

  it("reads a DRC marker's check, position, constraint set and both objects", () => {
    expect(L.drc.markers).toEqual([
      {
        check: "LINE_TO_LINE_SPACING",
        x: 50,
        y: 0,
        objects: ["U1.1", "U1.2"],
        constraintSet: "SET_A",
      },
    ]);
  });
});
