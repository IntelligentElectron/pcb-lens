import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryComponent } from "./get-pcb-component.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVB6 = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVB6);

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
    const result = await queryComponent(padXml, "U1");
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
    const result = await queryComponent(padXml, "U1");
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
    const result = await queryComponent(padXml, "U1");
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
    const result = await queryComponent(padXml, "U1");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const rows = result.padRows!;
      expect(rows[0][0]).toBe("1");
      expect(rows[1][0]).toBe("2");
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
    const result = await queryComponent(f, "U1");
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
