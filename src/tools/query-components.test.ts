import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryComponents } from "./query-components.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

// ---------------------------------------------------------------------------
// Inline fixture for package_pattern tests
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <Component refDes="U1" packageRef="BGA256_1MM" layerRef="TOP">
      <Location x="10" y="20"/>
    </Component>
    <Component refDes="U2" packageRef="QFP64_0.5MM" layerRef="TOP">
      <Location x="30" y="40"/>
    </Component>
    <Component refDes="U3" packageRef="BGA484_0.8MM" layerRef="BOTTOM">
      <Location x="50" y="60"/>
    </Component>
    <Component refDes="R1" packageRef="RES_0402" layerRef="TOP">
      <Location x="70" y="80"/>
    </Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;
let minimalXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "components.xml");
  writeFileSync(inlineXml, INLINE_XML);
  minimalXml = path.join(tempDir, "test.xml");
  writeFileSync(minimalXml, "<IPC-2581/>");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------
describe.skipIf(!hasBeagleBoneFixture)("queryComponents -- BeagleBone RevC", () => {
  it("finds a specific component by exact refdes", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^U1$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches.length).toBeGreaterThanOrEqual(1);
      expect(result.matches[0].refdes).toBe("U1");
    }
  });

  it("finds multiple components by prefix pattern", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^C\\d+$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches.length).toBeGreaterThan(1);
      for (const c of result.matches) {
        expect(c.refdes).toMatch(/^C\d+$/);
      }
    }
  });

  it("returns empty matches for non-existent refdes", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^ZZZZZ$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("rejects invalid regex", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regex pattern guard
// ---------------------------------------------------------------------------
describe("queryComponents -- regex pattern guard", () => {
  it("rejects pattern over 200 characters", async () => {
    const result = await queryComponents(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("accepts pattern of exactly 200 characters", async () => {
    const result = await queryComponents(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });
});

// ---------------------------------------------------------------------------
// Package pattern filtering
// ---------------------------------------------------------------------------
describe("queryComponents -- package_pattern", () => {
  it("filters components by package pattern", async () => {
    const result = await queryComponents(inlineXml, "^U", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].refdes).toBe("U1");
      expect(result.matches[1].refdes).toBe("U3");
      for (const c of result.matches) {
        expect(c.packageRef).toMatch(/BGA/i);
      }
    }
  });

  it("ANDs refdes and package patterns together", async () => {
    const result = await queryComponents(inlineXml, "^U1$", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].refdes).toBe("U1");
    }
  });

  it("returns empty when package pattern matches none", async () => {
    const result = await queryComponents(inlineXml, "^U", "SOIC");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("returns empty when refdes matches but package does not", async () => {
    const result = await queryComponents(inlineXml, "^R1$", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("rejects invalid package pattern regex", async () => {
    const result = await queryComponents(inlineXml, "^U", "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });

  it("includes package in result when provided", async () => {
    const result = await queryComponents(inlineXml, "^U", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.package).toBe("BGA");
    }
  });

  it("omits package from result when not provided", async () => {
    const result = await queryComponents(inlineXml, "^U");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.package).toBeUndefined();
    }
  });

  it("works with broad refdes pattern and specific package", async () => {
    const result = await queryComponents(inlineXml, ".", "QFP");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].refdes).toBe("U2");
    }
  });
});

// ---------------------------------------------------------------------------
// Parsed package info
// ---------------------------------------------------------------------------
describe("queryComponents -- parsed package", () => {
  it("includes parsed package for recognized Cadence naming", async () => {
    const result = await queryComponents(inlineXml, "^U1$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(1);
      const comp = result.matches[0];
      expect(comp.parsed).toBeDefined();
      expect(comp.parsed!.packageFamily).toBe("BGA");
      expect(comp.parsed!.pinCount).toBe(256);
    }
  });

  it("omits parsed field for unrecognized package names", async () => {
    // Create XML with an unrecognizable package name
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
    const result = await queryComponents(f, "^X1$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches[0].parsed).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// include_pads
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

describe("queryComponents -- include_pads", () => {
  let padXml: string;

  beforeAll(() => {
    padXml = path.join(tempDir, "pads.xml");
    writeFileSync(padXml, PAD_XML);
  });

  it("omits pads by default", async () => {
    const result = await queryComponents(padXml, "^U1$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches[0].pads).toBeUndefined();
    }
  });

  it("includes pads when include_pads is true", async () => {
    const result = await queryComponents(padXml, "^U1$", undefined, true);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const comp = result.matches[0];
      expect(comp.pads).toBeDefined();
      expect(comp.pads).toHaveLength(2);
    }
  });

  it("returns correct pad shapes", async () => {
    const result = await queryComponents(padXml, "^U1$", undefined, true);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const pads = result.matches[0].pads!;
      const pin1 = pads.find((p) => p.pin === "1")!;
      expect(pin1.shape).toBe("rect");
      expect(pin1.width).toBe(500); // 0.5mm = 500 microns
      expect(pin1.height).toBe(300); // 0.3mm = 300 microns

      const pin2 = pads.find((p) => p.pin === "2")!;
      expect(pin2.shape).toBe("circle");
      expect(pin2.width).toBe(400); // 0.4mm diameter
    }
  });

  it("pads have correct positions in microns", async () => {
    const result = await queryComponents(padXml, "^U1$", undefined, true);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const pads = result.matches[0].pads!;
      const pin1 = pads.find((p) => p.pin === "1")!;
      // Component at (10,20)mm, pin offset (0,0) -> (10000, 20000) microns
      expect(pin1.x).toBe(10000);
      expect(pin1.y).toBe(20000);

      const pin2 = pads.find((p) => p.pin === "2")!;
      // Component at (10,20)mm, pin offset (1,0) -> (11000, 20000) microns
      expect(pin2.x).toBe(11000);
      expect(pin2.y).toBe(20000);
    }
  });

  it("pads are sorted by pin number", async () => {
    const result = await queryComponents(padXml, "^U1$", undefined, true);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      const pads = result.matches[0].pads!;
      expect(pads[0].pin).toBe("1");
      expect(pads[1].pin).toBe("2");
    }
  });
});
