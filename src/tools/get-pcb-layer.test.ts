import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { queryLayer, type LayerQueryResult } from "./get-pcb-layer.js";
import { getDesignOverview } from "./get-pcb-metadata.js";
import type { DesignOverview } from "./lib/types.js";

const BBB = path.resolve(
  import.meta.dirname,
  "../../test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BeagleBone Black_PCB_RevC_No Logo_210401.brd"
);

describe.skipIf(!existsSync(BBB))("get_pcb_layer on an Allegro .brd", () => {
  it("summarises the items of matching layers", async () => {
    const r = (await queryLayer(BBB, "PACKAGE_KEEPOUT/TOP")) as LayerQueryResult;
    expect(r.layers).toEqual([
      {
        layer: "PACKAGE_KEEPOUT/TOP",
        shapes: 4,
        filledArea: 180.3357,
        extent: { minX: 10795, minY: -635, maxX: 84455, maxY: 55245 },
      },
    ]);
    expect(r.items).toBeUndefined();
  });

  it("returns items of one component, and only those in an area", async () => {
    const r = (await queryLayer(BBB, "REF_DES/SILK", {
      refdes: "U5",
      detail: "full",
    })) as LayerQueryResult;
    expect(r.items).toEqual([expect.objectContaining({ kind: "text", text: "U5", refdes: "U5" })]);
    const inBox = (await queryLayer(BBB, "REF_DES/SILKSCREEN_TOP", {
      within: "36000,34000,37000,35000",
    })) as LayerQueryResult;
    expect(inBox.itemCount).toBeLessThan(5);
    expect(await queryLayer(BBB, "REF_DES", { within: "1,2,3" })).toHaveProperty("error");
  });

  it("caps full detail and says so", async () => {
    const r = (await queryLayer(BBB, "PACKAGE_GEOMETRY", { detail: "full" })) as LayerQueryResult;
    expect(r.items).toHaveLength(300);
    expect(r.truncated).toBe(true);
  });

  it("lists the layers holding items in get_pcb_metadata", async () => {
    const r = (await getDesignOverview(BBB)) as DesignOverview;
    expect(r.drawingLayers).toContainEqual({ name: "PACKAGE_KEEPOUT/TOP", itemCount: 4 });
  });
});

describe("get_pcb_layer errors", () => {
  it("reads .brd files only and names a layer pattern with no items", async () => {
    expect(await queryLayer("board.xml", "TOP")).toHaveProperty("error");
    if (existsSync(BBB)) expect(await queryLayer(BBB, "NO_SUCH_LAYER")).toHaveProperty("error");
  });
});
