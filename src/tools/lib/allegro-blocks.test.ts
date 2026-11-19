import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { walkBrdBlocks } from "./allegro-blocks.js";
import { readBrdInfo, type BrdInfo } from "./allegro-brd.js";

const CADENCE = path.resolve(import.meta.dirname, "../../../test/fixtures/cadence");
const FIXTURES = existsSync(CADENCE)
  ? readdirSync(CADENCE, { recursive: true, encoding: "utf8" })
      .filter((f) => f.toLowerCase().endsWith(".brd"))
      .map((f) => path.join(CADENCE, f))
  : [];

const load = (file: string) => {
  const buf = readFileSync(file);
  const info = readBrdInfo(buf) as BrdInfo;
  return { w: new Uint32Array(buf.buffer, buf.byteOffset, buf.length >>> 2), info };
};

describe.each(FIXTURES.map((f) => [path.basename(f), f]))("walkBrdBlocks on %s", (_, file) => {
  it("walks every block to the end of the file", () => {
    const { w, info } = load(file);
    const blocks = walkBrdBlocks(w, info);
    if (typeof blocks === "string") throw new Error(blocks);
    expect(blocks.starts[0]).toBe(info.bodyWord);
    // each net (0x1B) is indexed under its key
    const net = blocks.starts.find((i) => (w[i] & 0xff) === 0x1b)!;
    expect(blocks.byKey.get(w[net + 1])).toBe(net);
  });
});

// a synthetic stream of `w` words in `layout`, with no strings and no header object count check
const synth = (layout: BrdInfo["layout"], words: number, bodyWord = 0) =>
  ({ version: "x", layout, bodyWord, streamEnd: words * 4, strings: new Map() }) as BrdInfo;

describe("walkBrdBlocks sizes by layout family", () => {
  it("sizes 0x2F and the 0x36 discriminator 0x12 in g14.04", () => {
    const w = new Uint32Array(8 + 8 + 263 + 5);
    w.set([0x0c00002f, 1], 0); // 32 bytes
    w.set([0x00120036, 2, 0, 0, 1], 8); // 32-byte header, one 1052-byte item
    w.set([0x04, 3], 8 + 8 + 263); // a 20-byte net assignment ends the stream
    w[5] = 3; // object count
    const blocks = walkBrdBlocks(w, synth("g14.04", w.length));
    expect(blocks).toEqual({
      starts: [0, 8, 279],
      byKey: new Map([
        [1, 0],
        [2, 8],
        [3, 279],
      ]),
    });
  });

  it("sizes 0x1F by the g14.14 row", () => {
    const w = new Uint32Array(9 + 96);
    w.set([0x1f, 1, 0, 0, 0, 0, 1 << 16]); // one copper layer row
    w[5] = 1;
    expect(walkBrdBlocks(w, synth("g14.14", w.length))).toMatchObject({ starts: [0] });
    expect(walkBrdBlocks(w, synth("g14.09", w.length))).toMatch(/block 0x0 at byte 0x13c/); // 280-byte rows
  });

  it("tries each family of the generation for a revision no file has shown", () => {
    const buf = Buffer.alloc(0x1200 + 20);
    buf.writeUInt32LE(0x00140800, 0); // revision 0x08: between g14.04 and g14.09
    buf.writeUInt8(3, 0x180);
    buf.writeUInt32LE(10000, 0x26c);
    buf.writeUInt32LE(0x1200 + 20 + 1, 0x18c); // stream end + 1
    buf.writeUInt32LE(0x04, 0x1200); // no strings, then a net assignment: 20 bytes only in g14.04
    buf.writeUInt32LE(1, 0x14);
    expect((readBrdInfo(buf) as BrdInfo).layout).toBe("g14.04");
  });

  it("reads the release from the last-save attachment", () => {
    const buf = Buffer.alloc(0x1300 + 180 + 32);
    buf.writeUInt32LE(0x00140902, 0);
    buf.writeUInt8(3, 0x180);
    buf.writeUInt32LE(10000, 0x26c);
    buf.writeUInt32LE(0x1300 + 1, 0x18c);
    buf.writeUInt8(0x3b, 0x1300);
    buf.writeUInt32LE(27, 0x1304);
    buf.write("ALLEGRO_DESIGN_WAS_LAST_SAVED\0", 0x1308, "latin1");
    buf.write("allegro 22.1 S004 - 1/2/2024", 0x1300 + 180, "latin1");
    expect(readBrdInfo(buf)).toMatchObject({ layout: "g14.09", version: "22.1" });
  });
});

describe("walkBrdBlocks errors", () => {
  it("names a block it cannot size", () => {
    const info = synth("g14.04", 4);
    expect(walkBrdBlocks(new Uint32Array([0x3f, 1, 2, 3]), info)).toBe(
      "Allegro x (g14.04) block 0x3f at byte 0x0 is not decoded"
    );
    // a 0x36 table of an unknown discriminator
    expect(walkBrdBlocks(new Uint32Array([0x00ff0036, 1, 2, 3, 0]), synth("g14.04", 5))).toMatch(
      /0x36 at/
    );
    // a block running past the end of the stream
    expect(walkBrdBlocks(new Uint32Array([0x1b, 1, 2]), synth("g14.04", 3))).toMatch(/0x1b at/);
  });

  it("rejects a stream whose blocks disagree with the header object count", () => {
    const w = new Uint32Array(13);
    w[5] = 7; // header object count
    w.set([0x04, 7], 8);
    expect(walkBrdBlocks(w, synth("g14.04", 13, 8))).toMatch(
      /holds 1 objects where its header counts 7/
    );
  });

  it("rejects a key used twice", () => {
    const w = new Uint32Array(10);
    w.set([0x04, 7, 0, 0, 0, 0x04, 7]);
    expect(walkBrdBlocks(w, synth("g13.15", 10))).toMatch(/key 0x7 is used twice/);
  });
});
