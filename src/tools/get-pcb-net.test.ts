import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryNet } from "./get-pcb-net.js";
import { isErrorResult } from "./lib/types.js";
import type { QueryNetsResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE);

// ---------------------------------------------------------------------------
// Inline fixture -- covers LogicalNet pins, PhyNetPoint layers, LayerFeature
// routing/vias, and multi-net matching without needing downloaded fixtures.
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content>
    <EntryLineDesc id="LD1"><LineDesc lineWidth="0.15"/></EntryLineDesc>
    <EntryLineDesc id="LD2"><LineDesc lineWidth="0.25"/></EntryLineDesc>
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
  <LogicalNet name="PWR_VCC">
    <PinRef pin="VDD" componentRef="U1"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup>
      <PhyNet name="NET_A">
        <PhyNetPoint x="0" y="0" layerRef="TOP" netNode="END" via="false"/>
        <PhyNetPoint x="1" y="1" layerRef="BOTTOM" netNode="END" via="true"/>
      </PhyNet>
      <PhyNet name="NET_B">
        <PhyNetPoint x="2" y="2" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
      <PhyNet name="PWR_VCC">
        <PhyNetPoint x="3" y="3" layerRef="INNER1" netNode="END" via="false"/>
        <PhyNetPoint x="4" y="4" layerRef="INNER2" netNode="END" via="false"/>
      </PhyNet>
    </PhyNetGroup>
    <LayerFeature layerRef="TOP">
      <Set net="NET_A" geometry="VIA1">
        <Polyline/>
        <LineDescRef id="LD1"/>
        <Hole platingStatus="VIA" x="0.5" y="0.5" diameter="0.3"/>
      </Set>
      <Set net="NET_B">
        <PinRef pin="5" componentRef="U2"/>
        <Polyline/>
        <LineDesc lineWidth="0.20"/>
      </Set>
    </LayerFeature>
    <LayerFeature layerRef="BOTTOM">
      <Set net="NET_A">
        <Polyline/>
        <LineDescRef id="LD2"/>
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

// Helper: assert result is not an error and return typed result
const expectSuccess = (result: unknown): QueryNetsResult => {
  expect(isErrorResult(result)).toBe(false);
  return result as QueryNetsResult;
};

const hasPin = (pins: Record<string, string[]>, refdes: string, pin: string): boolean =>
  (pins[refdes] ?? []).includes(pin);

const pinCount = (pins: Record<string, string[]>): number =>
  Object.values(pins).reduce((sum, componentPins) => sum + componentPins.length, 0);

// ---------------------------------------------------------------------------
// Pattern validation (edge cases)
// ---------------------------------------------------------------------------
describe("queryNet -- regex pattern guard", () => {
  it("rejects pattern over 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("accepts pattern of exactly 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });

  it("rejects invalid regex", async () => {
    const result = await queryNet(inlineXml, "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 1: Pin extraction from LogicalNet
// ---------------------------------------------------------------------------
describe("queryNet -- pin extraction from LogicalNet", () => {
  it("extracts pins from LogicalNet for NET_A", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.matches).toHaveLength(1);
    const pins = r.matches[0].pins;
    expect(hasPin(pins, "U1", "1")).toBe(true);
    expect(hasPin(pins, "R1", "2")).toBe(true);
  });

  it("extracts pins from LogicalNet for NET_B", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    expect(r.matches).toHaveLength(1);
    const pins = r.matches[0].pins;
    expect(hasPin(pins, "U1", "3")).toBe(true);
    expect(hasPin(pins, "C1", "1")).toBe(true);
  });

  it("includes supplementary pin from LayerFeature Set", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    const pins = r.matches[0].pins;
    expect(hasPin(pins, "U2", "5")).toBe(true);
  });

  it("deduplicates pins appearing in both LogicalNet and LayerFeature", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    const pins = r.matches[0].pins;
    const u2Pins = pins.U2 ?? [];
    expect(u2Pins.filter((pin) => pin === "5")).toHaveLength(1);
  });

  it("groups pins by refdes with sorted keys and pin values", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    const pins = r.matches[0].pins;
    expect(Object.keys(pins)).toEqual(["C1", "U1", "U2"]);
    expect(pins.C1).toEqual(["1"]);
    expect(pins.U1).toEqual(["3"]);
    expect(pins.U2).toEqual(["5"]);
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Layer extraction from PhyNetPoint
// ---------------------------------------------------------------------------
describe("queryNet -- layer extraction from PhyNetPoint", () => {
  it("includes layers from PhyNetPoint and routing for NET_A", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    const layers = r.matches[0].layersUsed;
    expect(layers).toContain("TOP");
    expect(layers).toContain("BOTTOM");
  });

  it("includes layers from PhyNetPoint only (no routing) for PWR_VCC", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^PWR_VCC$"));
    const layers = r.matches[0].layersUsed;
    expect(layers).toContain("INNER1");
    expect(layers).toContain("INNER2");
  });

  it("includes layers from both PhyNetPoint and routing for NET_B", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    const layers = r.matches[0].layersUsed;
    expect(layers).toContain("TOP");
  });
});

// ---------------------------------------------------------------------------
// Bug 3: Multi-match behavior
// ---------------------------------------------------------------------------
describe("queryNet -- multi-match", () => {
  it("returns multiple matches for broad pattern ^NET", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET"));
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0].netName).toBe("NET_A");
    expect(r.matches[1].netName).toBe("NET_B");
  });

  it("rejects '.' pattern when it matches all nets", async () => {
    const result = await queryNet(inlineXml, ".");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("matches all 3 physical nets");
      expect(result.error).toContain("get_pcb_metadata");
    }
  });

  it("rejects '.*' pattern when it matches all nets", async () => {
    const result = await queryNet(inlineXml, ".*");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("matches all 3 physical nets");
    }
  });

  it("rejects '.+' pattern when it matches all nets", async () => {
    const result = await queryNet(inlineXml, ".+");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("matches all 3 physical nets");
    }
  });

  it("returns empty matches for non-existent net", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NONEXISTENT$"));
    expect(r.matches).toHaveLength(0);
  });

  it("each match has independent data", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET"));
    const netA = r.matches.find((m) => m.netName === "NET_A")!;
    const netB = r.matches.find((m) => m.netName === "NET_B")!;
    expect(netA.pins).not.toEqual(netB.pins);
  });
});

// ---------------------------------------------------------------------------
// Routing and vias (existing behavior preserved)
// ---------------------------------------------------------------------------
describe("queryNet -- routing and vias", () => {
  it("NET_A has correct routing on TOP (150 microns)", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.matches[0].routing).toBeDefined();
    const topRoute = r.matches[0].routing!.find((rt) => rt.layerName === "TOP");
    expect(topRoute).toBeDefined();
    expect(topRoute!.segmentCount).toBe(1);
    expect(topRoute!.traceWidths).toContain(150);
  });

  it("NET_A has correct routing on BOTTOM (250 microns)", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.matches[0].routing).toBeDefined();
    const botRoute = r.matches[0].routing!.find((rt) => rt.layerName === "BOTTOM");
    expect(botRoute).toBeDefined();
    expect(botRoute!.segmentCount).toBe(1);
    expect(botRoute!.traceWidths).toContain(250);
  });

  it("NET_A has 2 total segments and 1 via with coordinates", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.matches[0].totalSegments).toBe(2);
    expect(r.matches[0].totalVias).toBe(1);
    expect(r.matches[0].viaRows).toBeDefined();
    expect(r.matches[0].viaRows![0]).toEqual([500, 500, 0]);
    expect(r.matches[0].viaDrills).toBeDefined();
    expect(r.matches[0].viaDrills![0]).toEqual({ diameter: 300, layer: "TOP" });
  });

  it("NET_B on TOP has trace width 200 microns (inline LineDesc)", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_B$"));
    expect(r.matches[0].routing).toBeDefined();
    const topRoute = r.matches[0].routing!.find((rt) => rt.layerName === "TOP");
    expect(topRoute).toBeDefined();
    expect(topRoute!.traceWidths).toContain(200);
  });

  it("omits empty routing/via/total fields when a net has no route segments", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^PWR_VCC$"));
    const net = r.matches[0];
    expect(net).not.toHaveProperty("routing");
    expect(net).not.toHaveProperty("vias");
    expect(net).not.toHaveProperty("totalSegments");
    expect(net).not.toHaveProperty("totalVias");
  });

  it("units field is always MICRON", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.units).toBe("MICRON");
  });

  it("pattern field reflects the input pattern", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    expect(r.pattern).toBe("^NET_A$");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("queryNet -- edge cases", () => {
  it("net in LogicalNet but not in PhyNet still returns pin data", async () => {
    // Create XML with a net only in LogicalNet
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="ORPHAN_NET">
    <PinRef pin="1" componentRef="U1"/>
  </LogicalNet>
  <LogicalNet name="OTHER_NET">
    <PinRef pin="2" componentRef="U2"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup></PhyNetGroup>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "orphan.xml");
    writeFileSync(f, xml);
    const r = expectSuccess(await queryNet(f, "^ORPHAN_NET$"));
    expect(r.matches).toHaveLength(1);
    expect(hasPin(r.matches[0].pins, "U1", "1")).toBe(true);
  });

  it("does not reject wildcard patterns when the design has zero nets", async () => {
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <PhyNetGroup></PhyNetGroup>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "zero-nets.xml");
    writeFileSync(f, xml);
    const r = expectSuccess(await queryNet(f, ".*"));
    expect(r.matches).toHaveLength(0);
  });

  it("uses PhyNet count for match-all rejection denominator", async () => {
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="ONLY_LOGICAL_NET">
    <PinRef pin="1" componentRef="U1"/>
  </LogicalNet>
  <LogicalNet name="BOTH_NET">
    <PinRef pin="2" componentRef="U2"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup>
      <PhyNet name="BOTH_NET">
        <PhyNetPoint x="0" y="0" layerRef="TOP" netNode="END" via="false"/>
      </PhyNet>
    </PhyNetGroup>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "phy-count.xml");
    writeFileSync(f, xml);
    const result = await queryNet(f, ".*");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("matches all 1 physical nets");
    }
  });
});

// ---------------------------------------------------------------------------
// BeagleBone fixture tests (conditional)
// ---------------------------------------------------------------------------
describe.skipIf(!hasBeagleBoneFixture)("queryNet -- BeagleBone RevB6", () => {
  it("returns pins and layers for VDD_3V3B", async () => {
    const r = expectSuccess(await queryNet(BEAGLEBONE, "^VDD_3V3B$"));
    expect(r.matches).toHaveLength(1);
    const net = r.matches[0];
    expect(pinCount(net.pins)).toBeGreaterThan(0);
    expect(hasPin(net.pins, "R157", "2")).toBe(true);
    expect(net.layersUsed).toContain("TOP");
    expect(net.layersUsed).toContain("BOTTOM");
  });

  it("returns multiple matches for ^VDD", async () => {
    const r = expectSuccess(await queryNet(BEAGLEBONE, "^VDD"));
    expect(r.matches.length).toBeGreaterThan(1);
    for (const m of r.matches) {
      expect(pinCount(m.pins)).toBeGreaterThan(0);
      expect(m.layersUsed.length).toBeGreaterThan(0);
    }
  });

  it("returns empty matches for non-existent net", async () => {
    const r = expectSuccess(await queryNet(BEAGLEBONE, "^NONEXISTENT_NET_12345$"));
    expect(r.matches).toHaveLength(0);
  });

  it("rejects invalid regex", async () => {
    const result = await queryNet(BEAGLEBONE, "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });
});
