import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryComponent } from "./get-pcb-component.js";
import { isErrorResult } from "./lib/types.js";
import { MAX_COORD_ROWS } from "./shared.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures/ipc2581");
const BEAGLEBONE_REVB6 = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVB6);
const PARALLELLA_REVB = path.join(FIXTURE_DIR, "parallella-RevB.xml");
const hasParallellaFixture = existsSync(PARALLELLA_REVB);
const TESTCASE1_REVC = path.join(FIXTURE_DIR, "testcase1-RevC.xml");
const hasTestcase1Fixture = existsSync(TESTCASE1_REVC);

// ---------------------------------------------------------------------------
// Inline fixtures
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <Component refDes="U1" packageRef="BGA256_1MM" layerRef="TOP">
      <Location x="10" y="20"/>
    </Component>
    <Component refDes="R1" packageRef="RES_0402" layerRef="TOP">
      <Location x="70" y="80"/>
    </Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "components.xml");
  writeFileSync(inlineXml, INLINE_XML);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Basic lookup
// ---------------------------------------------------------------------------
describe("queryComponent -- basic", () => {
  it("finds a component by exact refdes", async () => {
    const result = await queryComponent(inlineXml, "U1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.refdes).toBe("U1");
      expect(result.packageRef).toBe("BGA256_1MM");
      expect(result.x).toBe(10000);
      expect(result.y).toBe(20000);
      expect(result.units).toBe("MICRON");
    }
  });

  it("returns error for non-existent refdes", async () => {
    const result = await queryComponent(inlineXml, "ZZZZZ");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("not found");
    }
  });

  it("rejects refdes over 200 characters", async () => {
    const result = await queryComponent(inlineXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
  });

  it("rejects empty refdes", async () => {
    const result = await queryComponent(inlineXml, "");
    expect(isErrorResult(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------
describe.skipIf(!hasBeagleBoneFixture)("queryComponent -- BeagleBone RevB6", () => {
  it("finds U5 (AM335x BGA)", async () => {
    const result = await queryComponent(BEAGLEBONE_REVB6, "U5");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.refdes).toBe("U5");
      expect(result.packageRef).toBe("AM33XX_15X15");
      expect(result.layer).toBe("TOP");
    }
  });

  it("finds U6 with BOM data", async () => {
    const result = await queryComponent(BEAGLEBONE_REVB6, "U6");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.refdes).toBe("U6");
      expect(result.characteristics).toBeDefined();
      expect(Object.keys(result.characteristics).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Parsed package info
// ---------------------------------------------------------------------------
describe("queryComponent -- parsed package", () => {
  it("includes parsed package for recognized Cadence naming", async () => {
    const result = await queryComponent(inlineXml, "U1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.packageFamily).toBe("BGA");
      expect(result.parsed!.pinCount).toBe(256);
    }
  });

  it("omits parsed field for unrecognized package names", async () => {
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <Component refDes="X1" packageRef="_CUSTOM_PKG_" layerRef="TOP">
      <Location x="0" y="0"/>
    </Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "custom-pkg.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "X1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.parsed).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Pad geometry
// ---------------------------------------------------------------------------
const PAD_XML = `<IPC-2581>
  <Content>
    <EntryStandard id="PAD_RECT">
      <RectCenter width="0.5" height="0.3"/>
    </EntryStandard>
    <EntryStandard id="PAD_CIRCLE">
      <Circle diameter="0.4"/>
    </EntryStandard>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad>
    <CadData>
      <Package name="PKG2">
        <Pin number="1">
          <Location x="0" y="0"/>
          <StandardPrimitiveRef id="PAD_RECT"/>
        </Pin>
        <Pin number="2">
          <Location x="1.0" y="0"/>
          <StandardPrimitiveRef id="PAD_CIRCLE"/>
        </Pin>
      </Package>
    </CadData>
  </Ecad>
  <Step>
    <Component refDes="U1" packageRef="PKG2" layerRef="TOP">
      <Location x="10" y="20"/>
    </Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;

describe("queryComponent -- pad geometry", () => {
  let padXml: string;

  beforeAll(() => {
    padXml = path.join(tempDir, "pads.xml");
    writeFileSync(padXml, PAD_XML);
  });

  it("includes padRows and deduplicated padShapes", async () => {
    const result = await queryComponent(padXml, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.padRows).toBeDefined();
      expect(result.padRows).toHaveLength(2);
      expect(result.padColumns).toEqual(["pin", "x", "y", "shapeIndex"]);
      expect(result.padShapes).toBeDefined();
      expect(result.padShapes).toHaveLength(2); // rect + circle
    }
  });

  it("returns correct pad shapes via shapeIndex", async () => {
    const result = await queryComponent(padXml, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const rows = result.padRows!;
      const shapes = result.padShapes!;

      const pin1 = rows.find((r) => r[0] === "1")!;
      const shape1 = shapes[pin1[3]];
      expect(shape1.shape).toBe("rect");
      expect(shape1.width).toBe(500);
      expect(shape1.height).toBe(300);

      const pin2 = rows.find((r) => r[0] === "2")!;
      const shape2 = shapes[pin2[3]];
      expect(shape2.shape).toBe("circle");
      expect(shape2.width).toBe(400);
    }
  });

  it("pads have correct positions in microns", async () => {
    const result = await queryComponent(padXml, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const rows = result.padRows!;
      const pin1 = rows.find((r) => r[0] === "1")!;
      expect(pin1[1]).toBe(10000);
      expect(pin1[2]).toBe(20000);

      const pin2 = rows.find((r) => r[0] === "2")!;
      expect(pin2[1]).toBe(11000);
      expect(pin2[2]).toBe(20000);
    }
  });

  it("pads are sorted by pin number", async () => {
    const result = await queryComponent(padXml, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const rows = result.padRows!;
      expect(rows[0][0]).toBe("1");
      expect(rows[1][0]).toBe("2");
    }
  });

  // Issue #40: chip-passive pads that reference their shape only through a
  // padstack (no inline <StandardPrimitiveRef>) must still resolve, and oval
  // primitives must be supported. Previously these returned empty pad geometry.
  it("resolves pad shape via padstackDefRef when there is no inline primitive", async () => {
    const xml = `<IPC-2581>
  <Content>
    <EntryStandard id="OVAL_1"><Oval width="0.3" height="0.4"/></EntryStandard>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad><CadData>
    <PadStackDef name="CHIP_PAD">
      <PadstackPadDef padUse="REGULAR"><StandardPrimitiveRef id="OVAL_1"/></PadstackPadDef>
    </PadStackDef>
    <Package name="RES0402">
      <LandPattern>
        <Pad padstackDefRef="CHIP_PAD"><Location x="-0.5" y="0"/><PinRef pin="1"/></Pad>
        <Pad padstackDefRef="CHIP_PAD"><Location x="0.5" y="0"/><PinRef pin="2"/></Pad>
      </LandPattern>
    </Package>
  </CadData></Ecad>
  <Step>
    <Component refDes="R1" packageRef="RES0402" layerRef="TOP"><Location x="10" y="20"/></Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "passive-padstack.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "R1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      // #40: pads are populated, not empty.
      expect(result.padRows).toHaveLength(2);
      expect(result.padCount).toBe(2);
      expect(result.padShapes).toHaveLength(1);
      expect(result.padShapes![0].shape).toBe("oval");
      expect(result.padShapes![0].width).toBe(300);
      expect(result.padShapes![0].height).toBe(400);
      // #38: pin count is the real pad count (2), not the case-size code (402).
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.packageFamily).toBe("RES");
      expect(result.parsed!.pinCount).toBe(2);
    }
  });

  // Issue #40: pad shapes defined as a <Contour><Polygon> (no width/height
  // attribute) must be reported by their bounding box, not dropped.
  it("resolves a polygon/contour pad shape by bounding box", async () => {
    const xml = `<IPC-2581>
  <Content>
    <EntryStandard id="SHAPE_LS_POLY">
      <Contour>
        <Polygon>
          <PolyBegin x="-0.2" y="-0.3"/>
          <PolyStepSegment x="0.2" y="-0.3"/>
          <PolyStepSegment x="0.2" y="0.3"/>
          <PolyStepSegment x="-0.2" y="0.3"/>
          <PolyStepSegment x="-0.2" y="-0.3"/>
        </Polygon>
      </Contour>
    </EntryStandard>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad><CadData>
    <Package name="SR0603">
      <Pin number="1" type="SURFACE"><Location x="-0.5" y="0"/><StandardPrimitiveRef id="SHAPE_LS_POLY"/></Pin>
      <Pin number="2" type="SURFACE"><Location x="0.5" y="0"/><StandardPrimitiveRef id="SHAPE_LS_POLY"/></Pin>
    </Package>
  </CadData></Ecad>
  <Step>
    <Component refDes="R7" packageRef="SR0603" layerRef="TOP"><Location x="10" y="20"/></Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "passive-contour.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "R7", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.padRows).toHaveLength(2);
      expect(result.padShapes).toHaveLength(1);
      expect(result.padShapes![0].shape).toBe("polygon");
      expect(result.padShapes![0].width).toBe(400); // 0.4mm bbox -> 400 micron
      expect(result.padShapes![0].height).toBe(600); // 0.6mm bbox -> 600 micron
    }
  });

  // Issue #38: without geometry, a chip-passive case size must NOT be emitted as
  // a pin count; the family is still surfaced.
  it("does not invent a pin count from a chip-passive case size", async () => {
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <Component refDes="C9" packageRef="C0402" layerRef="TOP"><Location x="0" y="0"/></Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "passive-nogeo.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "C9");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.packageFamily).toBe("C");
      expect(result.parsed!.pinCount).toBeUndefined();
    }
  });

  // Per-pin pad coordinates are heavy, so they are omitted by default and
  // returned only when detail="full" is requested. The pad count and deduped
  // shapes remain available in both modes.
  it("omits raw padRows by default but keeps padCount and padShapes (summary)", async () => {
    const summary = await queryComponent(padXml, "U1");
    expect(isErrorResult(summary)).toBe(false);
    if (!isErrorResult(summary)) {
      expect(summary.padCount).toBe(2);
      expect(summary.padShapes).toHaveLength(2);
      expect(summary).not.toHaveProperty("padRows");
      expect(summary).not.toHaveProperty("padColumns");
    }
    const full = await queryComponent(padXml, "U1", "full");
    expect(isErrorResult(full)).toBe(false);
    if (!isErrorResult(full)) {
      expect(full.padRows).toHaveLength(2);
      expect(full.padColumns).toEqual(["pin", "x", "y", "shapeIndex"]);
    }
  });

  // Even detail="full" caps the raw padRows array and flags truncated, while
  // padCount still reports the true pad total.
  it("caps padRows at the budget and flags truncated (detail=full)", async () => {
    const PAD_COUNT = MAX_COORD_ROWS + 100;
    const pins = Array.from(
      { length: PAD_COUNT },
      (_, i) => `<Pin number="${i + 1}"><Location x="0" y="0"/><StandardPrimitiveRef id="P"/></Pin>`
    ).join("\n      ");
    const xml = `<IPC-2581>
  <Content><EntryStandard id="P"><Circle diameter="0.2"/></EntryStandard></Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad><CadData>
    <Package name="BIGPKG">
      ${pins}
    </Package>
  </CadData></Ecad>
  <Step>
    <Component refDes="U1" packageRef="BIGPKG" layerRef="TOP"><Location x="0" y="0"/></Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "many-pads.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.padCount).toBe(PAD_COUNT); // true total preserved
      expect(result.padRows!.length).toBe(MAX_COORD_ROWS); // capped
      expect(result.truncated).toBe(true);
    }
  });

  it("deduplicates identical pad shapes", async () => {
    const xml = `<IPC-2581>
  <Content>
    <EntryStandard id="PAD_CIRCLE"><Circle diameter="0.4"/></EntryStandard>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad><CadData>
    <Package name="BGA4">
      <Pin number="A1"><Location x="0" y="0"/><StandardPrimitiveRef id="PAD_CIRCLE"/></Pin>
      <Pin number="A2"><Location x="0.8" y="0"/><StandardPrimitiveRef id="PAD_CIRCLE"/></Pin>
      <Pin number="B1"><Location x="0" y="0.8"/><StandardPrimitiveRef id="PAD_CIRCLE"/></Pin>
      <Pin number="B2"><Location x="0.8" y="0.8"/><StandardPrimitiveRef id="PAD_CIRCLE"/></Pin>
    </Package>
  </CadData></Ecad>
  <Step>
    <Component refDes="U1" packageRef="BGA4" layerRef="TOP"><Location x="10" y="20"/></Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "dedup.xml");
    writeFileSync(f, xml);
    const result = await queryComponent(f, "U1", "full");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.padShapes).toHaveLength(1);
      expect(result.padRows).toHaveLength(4);
      for (const row of result.padRows!) {
        expect(row[3]).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Real-world chip passives (issues #38 / #40) on a Cadence Allegro export.
// Ground truth: every chip passive is a two-terminal part, so pinCount must be
// 2 and pad geometry must be non-empty -- regardless of the case-size digits in
// the footprint name.
// ---------------------------------------------------------------------------
describe.skipIf(!hasParallellaFixture)("queryComponent -- parallella passives", () => {
  it("reports pinCount 2 and two pads for a chip capacitor (C0402)", async () => {
    const result = await queryComponent(PARALLELLA_REVB, "C162");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.packageRef).toMatch(/^C0402/);
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.pinCount).toBe(2);
      // Summary mode (default) reports padCount; pads still resolved (issue #40).
      expect(result.padCount).toBe(2);
      expect(result.padShapes!.length).toBeGreaterThan(0);
    }
  });

  it("reports pinCount 2 for a ferrite bead (F0603)", async () => {
    const result = await queryComponent(PARALLELLA_REVB, "F1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.pinCount).toBe(2);
    }
  });

  it("keeps an authoritative pin count for a multi-pin IC (TSSOP24)", async () => {
    const result = await queryComponent(PARALLELLA_REVB, "U37");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.packageFamily).toBe("TSSOP");
      expect(result.parsed!.pinCount).toBe(24);
    }
  });
});

// ---------------------------------------------------------------------------
// Real-world chip passives whose pads are defined as <Contour><Polygon> shapes
// (issue #40, the encoding used by this Cadence RevC export). R1 is a chip
// resistor in the SR0603_85 land pattern: two pads, pinCount 2.
// ---------------------------------------------------------------------------
describe.skipIf(!hasTestcase1Fixture)("queryComponent -- testcase1 RevC contour pads", () => {
  it("returns two pads and pinCount 2 for a chip resistor with polygon pads", async () => {
    const result = await queryComponent(TESTCASE1_REVC, "R1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.packageRef).toMatch(/^SR0603/);
      expect(result.parsed!.pinCount).toBe(2);
      expect(result.padCount).toBe(2);
      expect(result.padShapes!.length).toBeGreaterThan(0);
    }
  });
});
