import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDesignOverview } from "./get-pcb-metadata.js";
import { boardOutline } from "./lib/geometry.js";
import { isErrorResult, type DesignOverview } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures/ipc2581");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

describe("file validation", () => {
  it("returns error for non-existent file", async () => {
    const result = await getDesignOverview("/nonexistent/file.xml");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("File not found");
    }
  });

  it("returns error for non-XML file", async () => {
    // A real, non-XML file (this repo's package.json), resolved from the test
    // location so it's independent of the fixtures dir layout.
    const result = await getDesignOverview(path.resolve(import.meta.dirname, "../../package.json"));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("not an XML file");
    }
  });
});

describe.skipIf(!hasBeagleBoneFixture)("getDesignOverview -- BeagleBone RevC", () => {
  it("returns design metadata", async () => {
    const result = await getDesignOverview(BEAGLEBONE_REVC);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.fileName).toContain("BeagleBone");
      expect(result.totalLines).toBeGreaterThan(100000);
      expect(result.componentCount).toBeGreaterThan(0);
      expect(result.netCount).toBeGreaterThan(0);
      expect(result.layers.length).toBeGreaterThan(0);
    }
  });
});

describe("board outline", () => {
  it("reads the <Profile> edge and cutouts, written on one line, in microns", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "profile-")), "board.xml");
    writeFileSync(
      file,
      '<IPC-2581><CadHeader units="MILLIMETER"/><Step name="s"><Profile><Polygon>' +
        '<PolyBegin x="0" y="0"/><PolyStepSegment x="10" y="0"/>' +
        '<PolyStepCurve x="10" y="20" centerX="10" centerY="10" clockwise="false"/>' +
        '<PolyStepSegment x="0" y="20"/><PolyStepSegment x="0" y="0"/></Polygon>' +
        '<Cutout><PolyBegin x="2" y="2"/><PolyStepSegment x="4" y="2"/><PolyStepSegment x="4" y="4"/>' +
        '<PolyStepSegment x="2" y="2"/></Cutout></Profile></Step></IPC-2581>'
    );
    const r = (await getDesignOverview(file)) as DesignOverview;
    // the half circle bulges to x = 20 mm between its end points
    expect(r.outline).toMatchObject({ width: 20000, height: 20000, minX: 0, maxX: 20000 });
    expect(r.outline!.contours).toHaveLength(2);
    expect(r.outline!.contours[0].arcs).toEqual([
      { index: 2, centerX: 10000, centerY: 10000, clockwise: false },
    ]);
    expect(r.outline!.contours[1]).toEqual({
      points: [
        [2000, 2000],
        [4000, 2000],
        [4000, 4000],
        [2000, 2000],
      ],
    });
  });

  it("measures arcs, keeps the largest contour as the edge and drops stray lines and duplicates", () => {
    const circle = {
      points: [
        [5, 0],
        [5, 0],
      ] as [number, number][],
      arcs: [{ index: 1, centerX: 0, centerY: 0, clockwise: true }],
    };
    const square = (o: number): [number, number][] => [
      [o, o],
      [o + 100, o],
      [o + 100, o + 100],
      [o, o + 100],
      [o, o],
    ];
    const o = boardOutline([
      {
        points: [
          [1, 1],
          [2, 2],
        ],
        closed: false,
      }, // stray, too short to count
      {
        points: [
          [0, 0],
          [50, 0],
          [50, 3],
        ],
        closed: false,
      }, // stray open fragment
      circle,
      { points: square(-50) },
      { points: [...square(-50).slice(1), square(-50)[1]] }, // the same square from another vertex
    ])!;
    expect(o).toMatchObject({ width: 100, height: 100, minX: -50, maxY: 50 });
    expect(o.contours).toHaveLength(2);
    expect(boardOutline([circle])).toMatchObject({ width: 10, height: 10, minX: -5, minY: -5 });
  });
});
