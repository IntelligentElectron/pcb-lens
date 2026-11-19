import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { queryFootprint, type FootprintQueryResult } from "./get-pcb-footprint.js";
import { queryComponent } from "./get-pcb-component.js";
import { queryNet } from "./get-pcb-net.js";
import { getDesignOverview } from "./get-pcb-metadata.js";
import type { ComponentResult, DesignOverview, QueryNetsResult } from "./lib/types.js";

const BBB = path.resolve(
  import.meta.dirname,
  "../../test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BeagleBone Black_PCB_RevC_No Logo_210401.brd"
);

// Every padstack's drill, plating and its regular, antipad and thermal figure on each layer equal
// the PadStackDefs of the board's IPC-2581 export (2,280 figures, 116 holes)
describe.skipIf(!existsSync(BBB))("get_pcb_footprint on an Allegro .brd", () => {
  it("describes a through-hole padstack layer by layer", async () => {
    const r = (await queryFootprint(BBB, "^60S32D$")) as FootprintQueryResult;
    expect(r.padstacks).toEqual([
      {
        name: "60S32D",
        drill: 889,
        type: "through",
        plated: true,
        layers: [
          {
            layer: "TOP..BOTTOM",
            pad: { shape: "square", width: 1524, height: 1524 },
            antipad: { shape: "square", width: 2032, height: 2032 },
            thermal: { shape: "rectangle", width: 2642, height: 2642 },
          },
        ],
        soldermaskTop: { shape: "square", width: 1676, height: 1676 },
        soldermaskBottom: { shape: "square", width: 1676, height: 1676 },
        drillSymbol: { figure: 16, width: 889, height: 889 },
      },
    ]);
  });

  it("reads slots, unplated holes and custom pad outlines", async () => {
    const r = (await queryFootprint(
      BBB,
      "^(65X100OB_26X60SLOT|MTG085|SMD10_33_F)$"
    )) as FootprintQueryResult;
    const byName = Object.fromEntries(r.padstacks.map((p) => [p.name, p]));
    expect(byName["65X100OB_26X60SLOT"]).toMatchObject({
      drill: 381,
      slot: { width: 381, height: 1270 },
    });
    expect(byName.MTG085).toMatchObject({ drill: 2159, plated: false });
    // equal to the export's contour for this pad
    expect(byName.SMD10_33_F.layers[0].pad).toEqual({
      shape: "custom",
      width: 230,
      height: 850,
      outline: [
        {
          points: [
            [115, -425],
            [115, 310],
            [-115, 310],
            [-115, -425],
            [115, -425],
          ],
          arcs: [{ index: 2, centerX: 0, centerY: 310, clockwise: false }],
        },
      ],
    });
  });

  it("describes a footprint, its pins and the parts placed with it", async () => {
    const r = (await queryFootprint(BBB, "^MICRO_SD", "full")) as FootprintQueryResult;
    const [fp] = r.footprints;
    expect(fp).toMatchObject({
      name: "MICRO_SD_15X14_3X1_8MM",
      kind: 1,
      refdes: ["P10"],
      pinCount: 14,
    });
    expect(fp.pins).toContainEqual({
      number: "10",
      x: -850,
      y: 8980,
      rotation: 0,
      padstack: "1_3X1_4MM_REC",
    });
    expect(fp.items!.length).toBeGreaterThan(0);
  });

  it("gives a component's pin names, its properties and padstacks", async () => {
    const c = (await queryComponent(BBB, "P10")) as ComponentResult;
    expect(c.characteristics.DEVICE_CLASS).toBe("MicroSD Card_10+4P");
    expect(c.pinFunctions).toContainEqual(["8", "DAT1", "F219"]);
    expect(c.padstacks).toContain("1_88X0_6MM_REC");
  });

  it("gives net and design properties", async () => {
    const n = (await queryNet(BBB, "^DDR_CKE$")) as QueryNetsResult;
    expect(n.matches[0].properties).toEqual({ TOTAL_ETCH_LENGTH: "978MIL:988MIL" });
    const d = (await getDesignOverview(BBB)) as DesignOverview;
    expect(d.properties).toMatchObject({ PHYSICAL_CONSTRAINT_SET: "DEFAULT" });
  });
});

describe("get_pcb_footprint errors", () => {
  it("reads .brd files only and names a pattern with no match", async () => {
    expect(await queryFootprint("board.xml", "X")).toHaveProperty("error");
    if (existsSync(BBB))
      expect(await queryFootprint(BBB, "NO_SUCH_FOOTPRINT")).toHaveProperty("error");
  });
});
