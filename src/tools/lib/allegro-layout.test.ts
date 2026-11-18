import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBrdLayout, type BrdLayout } from "./allegro-layout.js";
import { getDesignOverview } from "../get-pcb-metadata.js";
import { queryComponent } from "../get-pcb-component.js";
import { queryNet } from "../get-pcb-net.js";
import type { ComponentResult, DesignOverview, QueryNetsResult } from "./types.js";

const CADENCE = path.resolve(import.meta.dirname, "../../../test/fixtures/cadence");
const JETSON = path.join(CADENCE, "OSHW-Jetson-Series");
const BBB = path.join(
  CADENCE,
  "BeagleBone-Black/ALLEGRO/BeagleBone Black_PCB_RevC_No Logo_210401.brd"
);
const TI = path.join(CADENCE, "LAUNCHXL-CC1310/doc/hardware/cc1310");

// Expected counts are KiCad 10's independent reading of each board (its Allegro importer), which
// this reader matches on every component, pad net, track segment and via
const BOARDS = [
  [BBB, "17.2", 413, 1769, 7071, 860, ["TOP", "LYR2_GND", "LYR3", "LYR4", "LYR5_PWR", "BOTTOM"]],
  [
    path.join(
      JETSON,
      "reComputer Jetson carrier board/reComputer Industrial J201/Layout/reComputer Industrial J201_V1.2.brd"
    ),
    "17.4",
    1123,
    3639,
    14620,
    3337,
    ["TOP", "GND02", "LAY3", "LAY4", "PWR05", "BOTTOM"],
  ],
  [
    path.join(TI, "cc1310emk/swrc315_design_files/Cadence/CC13xxEM_5XD_7793_4L.brd"),
    "16.6",
    48,
    165,
    349,
    258,
    ["TOP", "L2", "L3", "BOTTOM"],
  ],
  // islands: nets with several assignment blocks
  [
    path.join(TI, "launchpad/design_files/Cadence/Allegro/LAUNCHXL-CC1310.brd"),
    "16.6",
    143,
    637,
    1452,
    522,
    ["TOP", "L2", "L3", "BOTTOM"],
  ],
  [
    path.join(CADENCE, "BeagleBoard-xM/PCB/ALLEGRO/BeagleBoard-xM.brd"),
    "16.4",
    439,
    2155,
    11208,
    1457,
    ["TOP", "LYR2-GND", "LYR3-SIG", "LYR4-SIG", "LYR5-PWR", "BOTTOM"],
  ],
] as const;

const segments = (l: BrdLayout) =>
  l.nets.reduce((s, n) => s + n.tracks.reduce((t, r) => t + r.points.length - 1, 0), 0);

describe.each(BOARDS)("readBrdLayout on %s", (file, version, comps, pads, segs, vias, layers) => {
  it.skipIf(!existsSync(file))("matches KiCad's reading of the board", async () => {
    const brd = await loadBrdLayout(file);
    if (typeof brd === "string") throw new Error(brd);
    const { layout } = brd;
    expect(brd.info.version).toBe(version);
    expect(layout.copperLayers.map((l) => l.name)).toEqual(layers);
    expect(layout.components).toHaveLength(comps);
    expect(layout.components.reduce((s, c) => s + c.pads.length, 0)).toBe(pads);
    expect(segments(layout)).toBe(segs);
    expect(layout.nets.reduce((s, n) => s + n.vias.length, 0)).toBe(vias);
  });
});

describe.skipIf(!existsSync(BBB))("geometry tools on an Allegro .brd", () => {
  it("reports the copper stackup", async () => {
    const r = (await getDesignOverview(BBB)) as DesignOverview;
    expect(r).toMatchObject({ allegroVersion: "17.2", units: "MICRON", componentCount: 413 });
    expect(r.layers[1]).toEqual({ name: "LYR2_GND", side: "INTERNAL", layerFunction: "PLANE" });
    expect(r.layers[5]).toEqual({ name: "BOTTOM", side: "BOTTOM", layerFunction: "CONDUCTOR" });
  });

  // placement, package and BOM values as the board's IPC-2581 export reports them
  it("places a bottom-side component with its pads and nets", async () => {
    const r = (await queryComponent(BBB, "P10", "full")) as ComponentResult;
    expect(r).toMatchObject({
      packageRef: "MICRO_SD_15X14_3X1_8MM",
      x: 70610,
      y: 31260,
      rotation: 90,
      layer: "BOTTOM",
      mountType: "SMT",
      characteristics: {
        DEVICE_TYPE: "MICROSD CARD_10+4P_MICRO_SD_15X",
        COMP_VALUE: "YL004-030-001",
      },
      padCount: 14,
    });
    expect(r.netRows).toContainEqual(["GND_EARTH", ["S1", "S3", "S4"], 20]);
    const s1 = r.padRows!.find((p) => p[0] === "S1")!;
    expect(s1.slice(1, 3)).toEqual([70610, 43710]);
    expect(r.padShapes![s1[3]]).toEqual({ shape: "rect", width: 1700, height: 1500 });
  });

  it("routes a net on every copper layer", async () => {
    const r = (await queryNet(BBB, "^I2C0_SDA$", "full")) as QueryNetsResult;
    const net = r.matches[0];
    expect(net.pins).toEqual({ R4: ["2"], U11: ["51"], U2: ["27"], U5: ["C17"], U7: ["3"] });
    // TOP and BOTTOM equal the IPC-2581 export, which leaves the inner layers out
    expect(net.routing).toContainEqual({
      layerName: "TOP",
      traceWidths: [121],
      segmentCount: 8,
      traceLength: 9151,
    });
    expect(net.routing).toContainEqual({
      layerName: "BOTTOM",
      traceWidths: [121],
      segmentCount: 2,
      traceLength: 7128,
    });
    expect(net.routing!.map((l) => l.layerName)).toEqual(["BOTTOM", "LYR3", "LYR4", "TOP"]);
    expect(net.viaCounts).toEqual([{ diameter: 203, layer: "DRILL_1-6", count: 4 }]);
    expect(net.viaRows).toContainEqual([66167, 45212, 0]);
    expect(net.segments!.every((s) => s.points.length >= 2)).toBe(true);
  });

  it("rejects a pattern that matches every net", async () => {
    expect(await queryNet(BBB, ".*")).toHaveProperty("error");
  });
});

const J201 = BOARDS[1][0];
describe.skipIf(!existsSync(J201))("arcs", () => {
  it("returns an arc's centre and direction", async () => {
    const r = (await queryNet(J201, "^RF_S1$", "full")) as QueryNetsResult;
    const arc = r.matches[0].segments!.find((s) => s.arcs)!;
    expect(arc.arcs![0]).toMatchObject({ centerX: -327692, centerY: 244004, clockwise: true });
    expect(arc.points[arc.arcs![0].index]).toEqual([-329225, 244004]);
  });
});

describe("loadBrdLayout errors", () => {
  it("names a missing file and an unsupported version", async () => {
    expect(await loadBrdLayout("/no/such/board.brd")).toMatch(/not found/);
    const dir = await mkdtemp(path.join(tmpdir(), "brd-"));
    const file = path.join(dir, "v18.brd");
    const buf = Buffer.alloc(0x1400);
    buf.writeUInt32LE(0x00150000, 0);
    await writeFile(file, buf);
    expect(await loadBrdLayout(file)).toMatch(
      /18\.x binary layout is not decoded \(16\.x, 17\.x only\)/
    );
    expect(await queryNet(file, "X")).toHaveProperty("error");
  });
});
