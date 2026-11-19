import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { queryDrc, type DrcQueryResult } from "./get-pcb-drc.js";
import { queryObject } from "./get-pcb-object.js";
import { getDesignOverview } from "./get-pcb-metadata.js";
import type { DesignOverview } from "./lib/types.js";

const CADENCE = path.resolve(import.meta.dirname, "../../test/fixtures/cadence");
const BBB = path.join(
  CADENCE,
  "BeagleBone-Black/ALLEGRO/BeagleBone Black_PCB_RevC_No Logo_210401.brd"
);
const J401 = path.join(
  CADENCE,
  "OSHW-Jetson-Series/reComputer Jetson carrier board/reComputer J401/Layout/reComputer J401_V1.0.brd"
);

describe.skipIf(!existsSync(J401))("get_pcb_drc on an Allegro .brd", () => {
  it("counts the markers by check and the checks by state", async () => {
    const r = (await queryDrc(J401)) as DrcQueryResult;
    expect(r).toMatchObject({
      markerCount: 367,
      byCheck: [{ check: "PACKAGE_PACKAGE", count: 367 }],
      checkStates: { on: 75, off: 975, batch: 0 },
    });
  });

  it("names the objects in conflict, where the two place bounds meet", async () => {
    const r = (await queryDrc(J401, "PACKAGE", "full")) as DrcQueryResult;
    // Q7's place bound ends at x = -236519, inside J11's
    expect(r.markers).toContainEqual(
      expect.objectContaining({
        check: "PACKAGE_PACKAGE",
        x: -236492,
        y: 273379,
        objects: [
          "rectangle of Q7 (PACKAGE_GEOMETRY/PLACE_BOUND_TOP)",
          "shape of J11 (PACKAGE_GEOMETRY/PLACE_BOUND_TOP)",
        ],
      })
    );
    expect(r.checksOn).toContain("PACKAGE_KEEPIN"); // the filter applies to the checks too
  });
});

describe.skipIf(!existsSync(BBB))("films and raw objects of an Allegro .brd", () => {
  it("lists the artwork films and their layers", async () => {
    const r = (await getDesignOverview(BBB)) as DesignOverview;
    expect(r.films).toContainEqual({
      name: "lyr3",
      layers: [
        "BOARD_GEOMETRY/SC_DNREV_1",
        "BOARD_GEOMETRY/TOOLING_CORNERS",
        "VIA_CLASS/LYR3",
        "PIN/LYR3",
        "ETCH/LYR3",
        "DRAWING_FORMAT/TITLE_BLOCK",
      ],
    });
  });

  it("inventories block types and attachments, and reads an attachment", async () => {
    const inv = (await queryObject(BBB)) as {
      types: Array<{ type: string; name?: string; count: number }>;
      attachments: Array<{ name: string }>;
    };
    expect(inv.types).toContainEqual({ type: "0x1b", name: "NET", count: 506 });
    expect(inv.attachments.map((a) => a.name)).toContain("ALLEGRO_DESIGN_WAS_LAST_SAVED");
    expect(await queryObject(BBB, { attachment: "ALLEGRO_DESIGN_WAS_LAST_SAVED" })).toMatchObject({
      encoding: "text",
      text: "allegro 17.2 S062 - 11/25/2019",
    });
  });

  it("shows a block's words and the blocks that point at it", async () => {
    const list = (await queryObject(BBB, { type: "0x1B" })) as { keys: number[] };
    const r = (await queryObject(BBB, { key: String(list.keys[1]) })) as {
      type: string;
      words: Array<[number, string, string?]>;
      referencedBy: unknown[];
    };
    expect(r.type).toBe("0x1b");
    expect(r.words[0]).toEqual([0, "0x0000001b"]);
    expect(r.referencedBy.length).toBeGreaterThan(0);
    expect(await queryObject(BBB, { key: "1" })).toHaveProperty("error");
    expect(await queryObject(BBB, { attachment: "NO_SUCH" })).toHaveProperty("error");
  });
});
