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

  it("stops at zero padding", () => {
    const info = { version: "17.2", bodyWord: 0 } as BrdInfo;
    const w = new Uint32Array(8);
    w.set([0x04, 7, 0, 0, 0]); // a 5-word 0x04 net assignment, then zeros
    expect(walkBrdBlocks(w, info)).toEqual({ starts: [0], byKey: new Map([[7, 0]]) });
  });
});
