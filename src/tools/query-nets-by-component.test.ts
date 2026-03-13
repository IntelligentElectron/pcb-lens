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
  <Content></Content>
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
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "inline.xml");
  writeFileSync(inlineXml, INLINE_XML);
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
  it("returns nets connected to U1 (excluding ground by default)", () => async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).toContain("NET_A");
    expect(netNames).toContain("NET_B");
    expect(netNames).not.toContain("GND");
    expect(netNames).not.toContain("AGND");
    expect(netNames).not.toContain("VSS_CORE");
  });

  it("includes ground nets when include_ground is true", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1", true));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).toContain("NET_A");
    expect(netNames).toContain("GND");
    expect(netNames).toContain("AGND");
    expect(netNames).toContain("VSS_CORE");
    expect(r.nets.length).toBe(5);
  });

  it("returns empty for non-existent component", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "NONEXISTENT"));
    expect(r.nets).toHaveLength(0);
  });

  it("does not include nets from unrelated components", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).not.toContain("UNRELATED");
  });

  it("returns only the net connected to R1", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "R1"));
    expect(r.nets).toHaveLength(1);
    expect(r.nets[0].netName).toBe("NET_A");
  });
});

// ---------------------------------------------------------------------------
// Pin data
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- pins", () => {
  it("returns component's own pins on NET_A", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netA = r.nets.find((n) => n.netName === "NET_A");
    expect(netA).toBeDefined();
    expect(netA!.pins).toEqual(["1"]);
  });

  it("returns component's own pins on NET_B", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netB = r.nets.find((n) => n.netName === "NET_B");
    expect(netB).toBeDefined();
    expect(netB!.pins).toEqual(["3"]);
  });

  it("pinCount reflects total pins on the net (all components)", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netA = r.nets.find((n) => n.netName === "NET_A");
    expect(netA!.pinCount).toBe(2); // U1.1 + R1.2
  });

  it("single-pin net has pinCount 1", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1", true));
    const agnd = r.nets.find((n) => n.netName === "AGND");
    expect(agnd).toBeDefined();
    expect(agnd!.pinCount).toBe(1);
    expect(agnd!.pins).toEqual(["AGND"]);
  });
});

// ---------------------------------------------------------------------------
// Ground filtering
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- ground filtering", () => {
  it("filters GND", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).not.toContain("GND");
  });

  it("filters AGND", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).not.toContain("AGND");
  });

  it("filters VSS variants", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).not.toContain("VSS_CORE");
  });
});

// ---------------------------------------------------------------------------
// Result metadata
// ---------------------------------------------------------------------------
describe("queryNetsByComponent -- metadata", () => {
  it("refdes field reflects input", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    expect(r.refdes).toBe("U1");
  });

  it("includeGround defaults to false", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    expect(r.includeGround).toBe(false);
  });

  it("nets are sorted alphabetically", async () => {
    const r = expectSuccess(await queryNetsByComponent(inlineXml, "U1"));
    const names = r.nets.map((n) => n.netName);
    expect(names).toEqual([...names].sort());
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
    expect(r.nets.length).toBeGreaterThan(0);
    const netNames = r.nets.map((n) => n.netName);
    expect(netNames).toContain("VDD_3V3B");
  });

  it("excludes ground nets by default", async () => {
    const r = expectSuccess(await queryNetsByComponent(BEAGLEBONE, "R157"));
    for (const net of r.nets) {
      expect(net.netName).not.toMatch(/^(A?D?GND\d*|VSS\w*)$/i);
    }
  });

  it("each net has a positive pin count", async () => {
    const r = expectSuccess(await queryNetsByComponent(BEAGLEBONE, "R157"));
    for (const net of r.nets) {
      expect(net.pinCount).toBeGreaterThan(0);
    }
  });
});
