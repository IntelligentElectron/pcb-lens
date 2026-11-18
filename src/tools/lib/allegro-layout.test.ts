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

const BBB_XML = path.resolve(
  import.meta.dirname,
  "../../../test/fixtures/ipc2581/BeagleBone Black_PCB_RevC_No Logo_210401.xml"
);
describe.skipIf(!existsSync(BBB) || !existsSync(BBB_XML))("board outline from a .brd", () => {
  it("equals the outline in the board's IPC-2581 export", async () => {
    const brd = (await getDesignOverview(BBB)) as DesignOverview;
    const xml = (await getDesignOverview(BBB_XML)) as DesignOverview;
    expect(brd.outline).toMatchObject({ width: 86360, height: 54610, minX: 0, minY: 0 });
    expect(brd.outline).toEqual(xml.outline);
  });
});

describe("board outline on other boards", () => {
  // CC13xx: KiCad's Edge.Cuts. J401: the edge drawn twice, and six mounting-hole cutouts
  it.skipIf(!existsSync(BOARDS[2][0]))("reads a 16.x outline shape", async () => {
    const brd = await loadBrdLayout(BOARDS[2][0]);
    if (typeof brd === "string") throw new Error(brd);
    expect(brd.layout.outline).toMatchObject({
      width: 37775,
      height: 44850,
      minX: 107350,
      minY: 94500,
    });
  });
  const J401 = path.join(
    JETSON,
    "reComputer Jetson carrier board/reComputer J401/Layout/reComputer J401_V1.0.brd"
  );
  it.skipIf(!existsSync(J401))("keeps cutouts and drops a repeated edge", async () => {
    const brd = await loadBrdLayout(J401);
    if (typeof brd === "string") throw new Error(brd);
    const o = brd.layout.outline!;
    expect(o).toMatchObject({ width: 100000, height: 79000 });
    expect(o.contours).toHaveLength(7);
    expect(o.contours.slice(1).every((c) => c.points.length === 2 && c.arcs?.length === 1)).toBe(
      true
    );
  });
});

const CC13 = BOARDS[2][0];
describe.skipIf(!existsSync(CC13))("parts on a 16.x board", () => {
  // 16.x instances reach their part through the part's other instances
  it("reads the device type and value of every part", async () => {
    const brd = await loadBrdLayout(CC13);
    if (typeof brd === "string") throw new Error(brd);
    expect(brd.layout.components.every((c) => c.deviceType)).toBe(true);
    const c5 = brd.layout.components.find((c) => c.refdes === "C5")!;
    expect(c5).toMatchObject({ value: "22uF" });
    expect(c5.deviceType).toMatch(/^CAPACITOR_CAPC1608X100A2L_22UF/);
  });
});

describe("loadBrdLayout headers", () => {
  const dir = mkdtemp(path.join(tmpdir(), "brd-"));
  const board = async (name: string, fill: (b: Buffer) => void) => {
    const file = path.join(await dir, name);
    const buf = Buffer.alloc(0x1400);
    fill(buf);
    await writeFile(file, buf);
    return file;
  };

  it("names a missing file and an unknown format", async () => {
    expect(await loadBrdLayout("/no/such/board.brd")).toMatch(/not found/);
    const file = await board("v19.brd", (b) => b.writeUInt32LE(0x00160000, 0));
    expect(await loadBrdLayout(file)).toMatch(/Unrecognised Allegro magic/);
    expect(await queryNet(file, "X")).toHaveProperty("error");
  });

  it("reads an 18.x header: units at 0x18C, string count at 0x34, lists from 0x60", async () => {
    const file = await board("v18.brd", (b) => {
      b.writeUInt32LE(0x00150000, 0);
      b.writeUInt32LE(1, 0x34);
      b.writeUInt8(3, 0x18c);
      b.writeUInt32LE(10000, 0x26c);
      b.writeUInt32LE(0x7d, 0x1200);
      b.write("TOP\0", 0x1204, "latin1");
    });
    const brd = await loadBrdLayout(file);
    if (typeof brd === "string") throw new Error(brd);
    expect(brd.info).toMatchObject({ version: "18.0", units: "mm", listBase: 0x60 });
    expect(brd.info.strings.get(0x7d)).toBe("TOP");
    expect(brd.layout.components).toEqual([]);
  });
});
