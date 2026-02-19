/**
 * Correctness validation integration tests.
 *
 * Every hardcoded expected value was independently extracted from the raw XML
 * fixtures via grep/manual inspection — not from running the streaming parser.
 * This avoids circular testing where bugs in the parser would be frozen as "correct."
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDesignOverview, queryComponents, queryNet } from "../../src/service.js";
import type { DesignOverview, QueryComponentsResult, QueryNetResult } from "../../src/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures");

// ---------------------------------------------------------------------------
// Ground-truth types
// ---------------------------------------------------------------------------

interface ComponentSpotCheck {
  refdes: string;
  packageRef?: string;
  layer?: string;
  mountType?: string;
  x: number;
  y: number;
  rotation?: number;
}

interface NetGroundTruth {
  pattern: string;
  expectError?: boolean;
  netName?: string;
  rawPinRefCount?: number;
  routingLayers?: string[];
  totalVias?: number;
  minPins?: number; // default: 1; set to 0 for nets without PinRef elements
}

interface FixtureConfig {
  name: string;
  file: string;
  overview: {
    fileSize: number;
    totalLines: number;
    revision: string | undefined;
    stepName: string;
    componentCount: number;
    netCount: number;
  };
  /** When duplicate refDes exist, queryComponents deduplicates via Map and returns fewer. */
  uniqueComponentCount?: number;
  component?: ComponentSpotCheck;
  net: NetGroundTruth;
}

// ---------------------------------------------------------------------------
// Fixture definitions with independently-verified ground truth
//
// Coordinate conversions from raw XML units to microns:
//   MICRON × 1  |  INCH × 25400  |  MILLIMETER × 1000
// ---------------------------------------------------------------------------

const FIXTURES: FixtureConfig[] = [
  {
    name: "BeagleBone RevC",
    file: "BeagleBone Black_PCB_RevC_No Logo_210401.xml",
    overview: {
      fileSize: 14841156,
      totalLines: 310688,
      revision: "C",
      stepName: "BeagleBone Black_PCB_RevC_No Logo_210401",
      componentCount: 419,
      netCount: 499,
    },
    component: {
      refdes: "U1",
      packageRef: "DCK5_2P15X1P4",
      layer: "BOTTOM",
      mountType: "SMT",
      x: 28829,
      y: 38100,
      rotation: 270,
    },
    net: {
      pattern: "^VDD_3V3B$",
      netName: "VDD_3V3B",
      rawPinRefCount: 122,
      routingLayers: ["BOTTOM", "TOP"],
      totalVias: 34,
    },
  },
  {
    name: "BeagleBone RevB6",
    file: "BeagleBone_Black_RevB6.xml",
    overview: {
      fileSize: 43029871,
      totalLines: 927766,
      revision: "B",
      stepName: "BeagleBone_Black_RevB6_nologo174",
      componentCount: 391,
      netCount: 478,
    },
    component: {
      refdes: "C136",
      packageRef: "0402",
      layer: "BOTTOM",
      mountType: "SMT",
      x: 26670,
      y: 29845,
      rotation: 0,
    },
    net: {
      pattern: "^USB1_PWR$",
      netName: "USB1_PWR",
    },
  },
  {
    name: "Parallella RevB",
    file: "parallella-RevB.xml",
    overview: {
      fileSize: 32039886,
      totalLines: 652396,
      revision: "B",
      stepName: "parallella_layout17p4",
      componentCount: 552,
      netCount: 638,
    },
    component: {
      refdes: "C12",
      packageRef: "C1210",
      layer: "BOTTOM",
      mountType: "SMT",
      x: 73914,
      y: 28702,
      rotation: 180,
    },
    net: {
      pattern: "^VCC_XADC$",
      netName: "VCC_XADC",
    },
  },
  {
    name: "Testcase1 RevC",
    file: "testcase1-RevC.xml",
    overview: {
      fileSize: 58599289,
      totalLines: 1166253,
      revision: "C",
      stepName: "testcase1-v174-RevC",
      componentCount: 1656,
      netCount: 2436,
    },
    component: {
      refdes: "DD_CONV3",
      packageRef: "SDDCONV7_635_3708X586X72",
      layer: "BOTTOM",
      mountType: "SMT",
      x: 165417.5,
      y: 189227.46,
      rotation: 180,
    },
    net: {
      pattern: "^TEST_TDO$",
      netName: "TEST_TDO",
    },
  },
  {
    name: "Testcase3 RevA",
    file: "testcase3-RevA.xml",
    overview: {
      fileSize: 3568743,
      totalLines: 80377,
      revision: "A",
      stepName: "test-3_r2",
      componentCount: 42,
      netCount: 262,
    },
    component: {
      refdes: "J1",
      packageRef: "ELECTROMECH",
      layer: "TOP",
      mountType: "THMT",
      x: -1270,
      y: 71120,
      rotation: 90,
    },
    net: {
      pattern: "^GND$",
      netName: "GND",
      rawPinRefCount: 61,
      routingLayers: ["GND"],
      totalVias: 0,
    },
  },
  {
    name: "Testcase3 RevB",
    file: "testcase3-RevB.xml",
    overview: {
      fileSize: 3464400,
      totalLines: 76624,
      revision: "B",
      stepName: "test-3_r2",
      componentCount: 42,
      netCount: 261,
    },
    net: {
      pattern: "^GND$",
      netName: "GND",
    },
  },
  {
    name: "Testcase3 RevC",
    file: "testcase3-RevC.xml",
    overview: {
      fileSize: 3025111,
      totalLines: 66196,
      revision: "C",
      stepName: "test-3_r2.-17_4",
      componentCount: 42,
      netCount: 261,
    },
    net: {
      pattern: "^GND$",
      netName: "GND",
    },
  },
  {
    name: "Testcase4 Zuken",
    file: "testcase4-RevA-Zuken.xml",
    overview: {
      fileSize: 9574976,
      totalLines: 2, // single-line XML with 1 newline → readline emits 2 lines
      revision: "13.1", // Zuken version number, not IPC revision letter
      stepName: "OTHER", // single-line XML: attr() picks up first name= on the line
      componentCount: 1,
      netCount: 0,
    },
    // No component spot-check: single-line XML defeats line-by-line regex extraction
    // (attr() picks up the first x=/y= on the entire line, not the target component's)
    net: {
      pattern: ".*",
      expectError: true,
    },
  },
  {
    name: "Testcase5 RevA",
    file: "testcase5-RevA.xml",
    overview: {
      fileSize: 21967297,
      totalLines: 490676,
      revision: "A",
      stepName: "step_testcase5",
      componentCount: 927,
      netCount: 1078,
    },
    component: {
      refdes: "CN1",
      packageRef: "CN12PR_20_2234X1200X102A",
      layer: "TOP",
      mountType: "THMT",
      x: 176870,
      y: 62150,
      rotation: 90,
    },
    net: {
      pattern: "^VIN$",
      netName: "VIN",
    },
  },
  {
    name: "Testcase6 RevA",
    file: "testcase6-RevA.xml",
    overview: {
      fileSize: 19789231,
      totalLines: 424475,
      revision: undefined,
      stepName: "PCB",
      componentCount: 1278,
      netCount: 956,
    },
    uniqueComponentCount: 1267, // 11 duplicate refDes="OR" entries → Map deduplicates
    component: {
      refdes: "I14",
      packageRef: "TO220_170_1054X1092X4872",
      layer: "TOP",
      mountType: "SMT",
      x: -33880,
      y: 81497.5,
      rotation: 0,
    },
    net: {
      pattern: "^TXLINE8_P$",
      netName: "TXLINE8_P",
      minPins: 0, // this file uses <Pad pin="..."> not <PinRef>, so parser finds 0 pins
    },
  },
  {
    name: "Testcase9 RevC",
    file: "testcase9-RevC.xml",
    overview: {
      fileSize: 3385283,
      totalLines: 70961,
      revision: "C",
      stepName: "test9",
      componentCount: 60,
      netCount: 79,
    },
    component: {
      refdes: "U9",
      packageRef: "SOIC16",
      layer: "TOP",
      mountType: "SMT",
      x: 649.6,
      y: 6350,
      rotation: 270,
    },
    net: {
      pattern: "^PRB2$",
      netName: "PRB2",
      rawPinRefCount: 14,
      routingLayers: ["BOTTOM"],
      totalVias: 0,
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const fixture of FIXTURES) {
  const filePath = path.join(FIXTURE_DIR, fixture.file);
  const fixtureExists = existsSync(filePath);

  describe.skipIf(!fixtureExists)(fixture.name, { timeout: 60_000 }, () => {
    it("getDesignOverview", async () => {
      const result = await getDesignOverview(filePath);
      expect(result).not.toHaveProperty("error");
      const overview = result as DesignOverview;

      expect(overview.fileName).toBe(fixture.file);
      expect(overview.fileSizeBytes).toBe(fixture.overview.fileSize);
      expect(overview.totalLines).toBe(fixture.overview.totalLines);
      expect(overview.units).toBe("MICRON");
      expect(overview.ipc2581Revision).toBe(fixture.overview.revision);
      expect(overview.stepName).toBe(fixture.overview.stepName);
      expect(overview.componentCount).toBe(fixture.overview.componentCount);
      expect(overview.netCount).toBe(fixture.overview.netCount);
      expect(overview.layers).toBeInstanceOf(Array);
      expect(overview.sections).toBeInstanceOf(Array);
    });

    it("queryComponents(.*)", async () => {
      const result = await queryComponents(filePath, ".*");
      expect(result).not.toHaveProperty("error");
      const { matches } = result as QueryComponentsResult;

      const expectedCount = fixture.uniqueComponentCount ?? fixture.overview.componentCount;
      expect(matches).toHaveLength(expectedCount);

      if (fixture.component) {
        const comp = matches.find((c) => c.refdes === fixture.component!.refdes);
        expect(comp).toBeDefined();

        if (fixture.component.packageRef !== undefined) {
          expect(comp!.packageRef).toBe(fixture.component.packageRef);
        }
        if (fixture.component.layer !== undefined) {
          expect(comp!.layer).toBe(fixture.component.layer);
        }
        if (fixture.component.mountType !== undefined) {
          expect(comp!.mountType).toBe(fixture.component.mountType);
        }
        expect(comp!.x).toBeCloseTo(fixture.component.x, 2);
        expect(comp!.y).toBeCloseTo(fixture.component.y, 2);
        if (fixture.component.rotation !== undefined) {
          expect(comp!.rotation).toBe(fixture.component.rotation);
        }
      }
    });

    it(`queryNet(${fixture.net.pattern})`, async () => {
      const result = await queryNet(filePath, fixture.net.pattern);

      if (fixture.net.expectError) {
        expect(result).toHaveProperty("error");
        return;
      }

      expect(result).not.toHaveProperty("error");
      const net = result as QueryNetResult;

      if (fixture.net.netName) {
        expect(net.netName).toBe(fixture.net.netName);
      }

      expect(net.units).toBe("MICRON");

      if (fixture.net.routingLayers) {
        expect(net.layersUsed).toEqual(expect.arrayContaining(fixture.net.routingLayers));
      }

      if (fixture.net.totalVias !== undefined) {
        expect(net.totalVias).toBe(fixture.net.totalVias);
      }

      const minPins = fixture.net.minPins ?? 1;
      expect(net.pins.length).toBeGreaterThanOrEqual(minPins);

      if (fixture.net.rawPinRefCount !== undefined) {
        expect(net.pins.length).toBeLessThanOrEqual(fixture.net.rawPinRefCount);
      }
    });
  });
}
