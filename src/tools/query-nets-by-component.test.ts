import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryNetsByComponent } from "./query-nets-by-component.js";
import { isErrorResult } from "./lib/types.js";
import type { QueryNetsByComponentResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE);

// ---------------------------------------------------------------------------
// Inline fixture
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content>
    <EntryLineDesc id="LD1"><LineDesc lineWidth="0.15"/></EntryLineDesc>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="NET_A">
    <PinRef pin="1" componentRef="U1"/>
    <PinRef pin="2" componentRef="R1"/>
  </LogicalNet>
  <LogicalNet name="NET_B">
    <PinRef pin="3" componentRef="U1"/>
    <PinRef pin="1" componentRef="C1"/>
  </LogicalNet>
  <LogicalNet name="GND">
    <PinRef pin="GND" componentRef="U1"/>
    <PinRef pin="1" componentRef="C2"/>
  </LogicalNet>
  <LogicalNet name="AGND">
    <PinRef pin="AGND" componentRef="U1"/>
  </LogicalNet>
  <LogicalNet name="VSS_CORE">
    <PinRef pin="VSS" componentRef="U1"/>
  </LogicalNet>
  <LogicalNet name="UNRELATED">
    <PinRef pin="1" componentRef="U2"/>
    <PinRef pin="2" componentRef="R2"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup>
      <PhyNet name="NET_A">
        <PhyNetPoint x="0" y="0" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="NET_B">
        <PhyNetPoint x="2" y="2" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="GND">
        <PhyNetPoint x="3" y="3" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="AGND">
        <PhyNetPoint x="4" y="4" layerRef="BOTTOM" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="VSS_CORE">
        <PhyNetPoint x="5" y="5" layerRef="BOTTOM" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="UNRELATED">
        <PhyNetPoint x="6" y="6" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
    </PhyNetGroup>
    <LayerFeature layerRef="TOP">
      <Set net="NET_A">
        <Polyline/>
        <LineDescRef id="LD1"/>
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;
let minimalXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "inline.xml");
  writeFileSync(inlineXml, INLINE_XML);
  minimalXml = path.join(tempDir, "minimal.xml");
  writeFileSync(minimalXml, "<IPC-2581/>");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const expectSuccess = (result: unknown): QueryNetsByComponentResult => {
  expect(isErrorResult(result)).toBe(false);
  return result as QueryNetsByComponentResult;
};

// ---------------------------------------------------------------------------
// Basic functionality
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- basic", () => {
  it("returns nets connected to U1 (excluding ground by default)", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    // Should have NET_A and NET_B, but not GND/AGND/VSS_CORE
    expect(r.matches).toHaveLength(2);
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).toContain("NET_A");
    expect(netNames).toContain("NET_B");
    expect(netNames).not.toContain("GND");
    expect(netNames).not.toContain("AGND");
    expect(netNames).not.toContain("VSS_CORE");
  });

  it("includes ground nets when include_ground is true", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1", true));
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).toContain("NET_A");
    expect(netNames).toContain("GND");
    expect(netNames).toContain("AGND");
    expect(netNames).toContain("VSS_CORE");
    expect(r.matches.length).toBe(5);
  });

  it("returns empty for non-existent component", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "NONEXISTENT"));
    expect(r.matches).toHaveLength(0);
  });

  it("does not include nets from unrelated components", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).not.toContain("UNRELATED");
  });

  it("returns only the net connected to R1", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "R1"));
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].netName).toBe("NET_A");
  });
});

// ---------------------------------------------------------------------------
// Pin data
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- pin data", () => {
  it("includes all pins on NET_A (not just the queried component)", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netA = r.matches.find((m) => m.netName === "NET_A")!;
    expect(netA.pins.U1).toContain("1");
    expect(netA.pins.R1).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// Routing data
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- routing", () => {
  it("includes routing data for NET_A", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netA = r.matches.find((m) => m.netName === "NET_A")!;
    expect(netA.routing).toBeDefined();
    expect(netA.routing![0].layerName).toBe("TOP");
    expect(netA.routing![0].traceWidths).toContain(150); // 0.15mm = 150 microns
  });
});

// ---------------------------------------------------------------------------
// Ground pattern matching
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- ground filtering", () => {
  it("filters GND", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).not.toContain("GND");
  });

  it("filters AGND", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).not.toContain("AGND");
  });

  it("filters VSS variants", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).not.toContain("VSS_CORE");
  });
});

// ---------------------------------------------------------------------------
// Result metadata
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- metadata", () => {
  it("units field is always MICRON", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    expect(r.units).toBe("MICRON");
  });

  it("refdes field reflects input", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    expect(r.refdes).toBe("U1");
  });

  it("includeGround defaults to false", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    expect(r.includeGround).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- validation", () => {
  it("rejects empty refdes", async () => {
    const result = await queryNetsByComponent(inlineXml, "");
    expect(isErrorResult(result)).toBe(true);
  });

  it("rejects refdes over 200 characters", async () => {
    const result = await queryNetsByComponent(inlineXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await queryNetsByComponent("/nonexistent.xml", "U1");
    expect(isErrorResult(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture tests (conditional)
// ---------------------------------------------------------------------------
describe.skipIf(!hasBeagleBoneFixture)("queryNetsByComponent -- BeagleBone RevB6", () => {
  it("returns nets for a known component", async () => {
    const r = expectSuccess(await queryNetsByComponent(BEAGLEBONE, "R157"));
    expect(r.matches.length).toBeGreaterThan(0);
    const netNames = r.matches.map((m) => m.netName);
    expect(netNames).toContain("VDD_3V3B");
  });

  it("excludes ground nets by default", async () => {
    const r = expectSuccess(await queryNetsByComponent(BEAGLEBONE, "R157"));
    const netNames = r.matches.map((m) => m.netName);
    for (const name of netNames) {
      expect(name).not.toMatch(/^(A?D?GND\d*|VSS\w*)$/i);
    }
  });
});
