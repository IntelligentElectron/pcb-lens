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
  const info = readBrdInfo(buf, ["16", "17", "18"]) as BrdInfo;
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

describe("walkBrdBlocks on blocks seen in one release only", () => {
  it("sizes 0x2F and the 0x36 substruct 0x12 in 17.2", () => {
    const w = new Uint32Array(8 + 8 + 263 + 5);
    w.set([0x0c00002f, 1], 0); // 8 words
    w.set([0x00120036, 2, 0, 0, 1], 8); // 8-word header, one 263-word record
    w.set([0x04, 3], 8 + 8 + 263); // a 5-word net assignment ends the file
    const blocks = walkBrdBlocks(w, { version: "17.2", bodyWord: 0 } as BrdInfo);
    expect(blocks).toEqual({
      starts: [0, 8, 279],
      byKey: new Map([
        [1, 0],
        [2, 8],
        [3, 279],
      ]),
    });
  });

  it("stops on 0x2F in a release whose size is not known", () => {
    const w = new Uint32Array([0x2f, 1, 0, 0, 0, 0, 0, 0]);
    expect(walkBrdBlocks(w, { version: "17.4", bodyWord: 0 } as BrdInfo)).toMatch(/0x2f at/);
  });

  it("reads release code 0x1405 as 17.2", () => {
    const buf = Buffer.alloc(0x1300);
    buf.writeUInt32LE(0x00140500, 0);
    buf.writeUInt8(3, 0x180); // mm
    buf.writeUInt32LE(10000, 0x26c);
    expect((readBrdInfo(buf) as BrdInfo).version).toBe("17.2");
  });
});

describe("walkBrdBlocks errors", () => {
  it("names a block it cannot size", () => {
    const info = { version: "17.2", bodyWord: 0 } as BrdInfo;
    expect(walkBrdBlocks(new Uint32Array([0x3f, 1, 2, 3]), info)).toBe(
      "Allegro 17.2 block 0x3f at byte 0x0 is not decoded"
    );
    // a 0x36 table of an unknown substruct
    expect(walkBrdBlocks(new Uint32Array([0x00ff0036, 1, 2, 3, 0]), info)).toMatch(/0x36 at/);
    // a block running past the end
    expect(walkBrdBlocks(new Uint32Array([0x1b, 1, 2]), info)).toMatch(/0x1b at/);
  });

  it("rejects a 0x27 whose header end offset points back at an earlier block", () => {
    const w = new Uint32Array(0x110);
    w.set([0x04, 7, 0, 0, 0], 0x100); // a 5-word net assignment, then the 0x27
    w[0x105] = 0x27;
    w[0x18c >>> 2] = 0x100 * 4 + 1; // end offset + 1: back to the net assignment
    expect(walkBrdBlocks(w, { version: "17.2", bodyWord: 0x100 } as BrdInfo)).toBe(
      "Allegro 17.2 block 0x27 at byte 0x414 is not decoded"
    );
  });

  it("stops at zero padding", () => {
    const info = { version: "17.2", bodyWord: 0 } as BrdInfo;
    const w = new Uint32Array(8);
    w.set([0x04, 7, 0, 0, 0]); // a 5-word 0x04 net assignment, then zeros
    expect(walkBrdBlocks(w, info)).toEqual({ starts: [0], byKey: new Map([[7, 0]]) });
  });
});
