import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryNet } from "./get-pcb-net.js";
import { isErrorResult } from "./lib/types.js";
import type { QueryNetsResult } from "./lib/types.js";
import { MAX_COORD_ROWS, MAX_PIN_ROWS } from "./shared.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE);
const TESTCASE1_REVC = path.join(FIXTURE_DIR, "testcase1-RevC.xml");
const hasTestcase1Fixture = existsSync(TESTCASE1_REVC);
const PARALLELLA_REVB = path.join(FIXTURE_DIR, "parallella-RevB.xml");
const hasParallellaFixture = existsSync(PARALLELLA_REVB);

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
    const net = r.matches[0];
    // PhyNetPoint populates layersUsed; with no conductor geometry, routing stays empty.
    expect(net.layersUsed).toContain("INNER1");
    expect(net.layersUsed).toContain("INNER2");
    expect(net.routing).toBeUndefined();
    expect(net.totalSegments).toBeUndefined();
    expect(net.totalTraceLength).toBeUndefined();
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

  it("NET_A has 2 total segments and 1 via with coordinates (detail=full)", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$", "full"));
    expect(r.matches[0].totalSegments).toBe(2);
    expect(r.matches[0].totalVias).toBe(1);
    expect(r.matches[0].viaRows).toBeDefined();
    expect(r.matches[0].viaRows![0]).toEqual([500, 500, 0]);
    // viaRows[].drillIndex references viaCounts by position; viaDrills is gone.
    expect(r.matches[0].viaCounts![0]).toEqual({ diameter: 300, layer: "TOP", count: 1 });
    expect(r.matches[0]).not.toHaveProperty("viaDrills");
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
// Conductors encoded as <Line> rather than <Polyline> (issue #39). A net routed
// entirely with <Line> segments previously returned no routing at all.
// ---------------------------------------------------------------------------
describe("queryNet -- <Line> conductor routing", () => {
  const LINE_XML = `<IPC-2581>
  <Content>
    <EntryLineDesc id="LD_SIG"><LineDesc lineWidth="0.10"/></EntryLineDesc>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="SIG1">
    <PinRef pin="1" componentRef="U1"/>
    <PinRef pin="2" componentRef="U2"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="SIG1">
        <Features>
          <Line startX="0" startY="0" endX="3" endY="4"><LineDescRef id="LD_SIG"/></Line>
        </Features>
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;

  let lineXml: string;
  beforeAll(() => {
    lineXml = path.join(tempDir, "line-routed.xml");
    writeFileSync(lineXml, LINE_XML);
  });

  it("returns routing for a net routed with <Line> segments", async () => {
    const r = expectSuccess(await queryNet(lineXml, "^SIG1$"));
    const net = r.matches[0];
    expect(net.routing).toBeDefined();
    const top = net.routing!.find((rt) => rt.layerName === "TOP");
    expect(top).toBeDefined();
    expect(top!.segmentCount).toBe(1);
    expect(top!.traceWidths).toContain(100); // 0.10mm -> 100 micron
    expect(top!.traceLength).toBe(5000); // 3-4-5 triangle: 5mm -> 5000 micron
    expect(net.totalTraceLength).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Real-fixture regression guard for <Line> routing (issue #39). On testcase1
// RevC the net UN21RES96PA0 is routed on TOP with a mix of <Polyline> and
// <Line> segments; the 180-micron trace width is contributed only by the
// <Line> segments, so its presence proves they are now parsed.
// ---------------------------------------------------------------------------
describe.skipIf(!hasTestcase1Fixture)("queryNet -- <Line> routing on testcase1 RevC", () => {
  it("includes the <Line>-only trace width and extra segments for UN21RES96PA0", async () => {
    const r = expectSuccess(await queryNet(TESTCASE1_REVC, "^UN21RES96PA0$"));
    const net = r.matches[0];
    expect(net.routing).toBeDefined();
    const top = net.routing!.find((rt) => rt.layerName === "TOP");
    expect(top).toBeDefined();
    // 180 micron appears only once <Line> segments are parsed (was [300, 500]).
    expect(top!.traceWidths).toContain(180);
    // TOP previously reported 3 segments (polylines only); <Line> segments add more.
    expect(top!.segmentCount).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// Poured copper (issue #39). Nets are frequently filled as <Contour>/<Polygon>
// shapes (with a <FillDescRef>) rather than centerline <Polyline>/<Line>
// conductors -- modern Cadence/Allegro pours even short signal traces this way.
// Such a net is fully routed, so it must report routing on its copper layers; a
// filled shape has no centerline, so width/length are absent (not fabricated).
// A <Polygon> inside a <Pad> is a pad outline, not routing, and must be ignored.
// ---------------------------------------------------------------------------
describe("queryNet -- poured copper (Contour/Polygon) routing", () => {
  const POUR_XML = `<IPC-2581>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="POUR1">
    <PinRef pin="1" componentRef="U1"/>
    <PinRef pin="2" componentRef="U2"/>
  </LogicalNet>
  <LogicalNet name="PADONLY">
    <PinRef pin="1" componentRef="U3"/>
  </LogicalNet>
  <LogicalNet name="MULTIPOUR">
    <PinRef pin="1" componentRef="U4"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="MULTIPOUR">
        <Features>
          <Contour>
            <Polygon>
              <PolyBegin x="0" y="0"/>
              <PolyStepSegment x="1" y="0"/>
              <PolyStepSegment x="1" y="1"/>
              <PolyStepSegment x="0" y="0"/>
            </Polygon>
          </Contour>
          <Contour>
            <Polygon>
              <PolyBegin x="3" y="3"/>
              <PolyStepSegment x="4" y="3"/>
              <PolyStepSegment x="4" y="4"/>
              <PolyStepSegment x="3" y="3"/>
            </Polygon>
          </Contour>
        </Features>
      </Set>
      <Set net="POUR1">
        <Features>
          <Contour>
            <Polygon>
              <PolyBegin x="0" y="0"/>
              <PolyStepSegment x="1" y="0"/>
              <PolyStepSegment x="1" y="1"/>
              <PolyStepSegment x="0" y="0"/>
              <FillDescRef id="SOLID_FILL"/>
            </Polygon>
          </Contour>
        </Features>
      </Set>
      <Set net="PADONLY">
        <Pad padstackDefRef="PS1">
          <Location x="5" y="5"/>
          <Contour>
            <Polygon>
              <PolyBegin x="5" y="5"/>
              <PolyStepSegment x="6" y="5"/>
              <PolyStepSegment x="6" y="6"/>
              <PolyStepSegment x="5" y="5"/>
            </Polygon>
          </Contour>
          <PinRef pin="1" componentRef="U3"/>
        </Pad>
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;

  let pourXml: string;
  beforeAll(() => {
    pourXml = path.join(tempDir, "poured.xml");
    writeFileSync(pourXml, POUR_XML);
  });

  it("reports a poured net as routed on its copper layer, without fabricating width/length", async () => {
    const r = expectSuccess(await queryNet(pourXml, "^POUR1$"));
    const net = r.matches[0];
    expect(net.routing).toBeDefined();
    const top = net.routing!.find((rt) => rt.layerName === "TOP");
    expect(top).toBeDefined();
    expect(top!.segmentCount).toBe(1);
    // A filled shape has no centerline: width/length are not invented.
    expect(top!.traceWidths).toEqual([]);
    expect(top!.traceLength).toBe(0);
    expect(net.layersUsed).toContain("TOP");
  });

  it("does not count a <Contour> inside a <Pad> as routing (exercises the inPad guard)", async () => {
    const r = expectSuccess(await queryNet(pourXml, "^PADONLY$"));
    const net = r.matches[0];
    // The only contour for this net is a custom pad outline inside <Pad>, so the
    // inPad guard must keep it out of routing. Without the guard this would be
    // miscounted as a routed segment.
    expect(net.routing).toBeUndefined();
  });

  it("counts multiple poured shapes in one <Set> as a single segment", async () => {
    const r = expectSuccess(await queryNet(pourXml, "^MULTIPOUR$"));
    const net = r.matches[0];
    const top = net.routing!.find((rt) => rt.layerName === "TOP");
    expect(top).toBeDefined();
    // segmentCount is Set-level: two <Contour> shapes in one <Set> count once.
    expect(top!.segmentCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Real-fixture regression for poured copper (issue #39). On parallella RevB the
// 2-pin net N22934179 is routed entirely as a <Contour><Polygon> fill, so before
// the fix it returned empty routing despite being fully routed. It must now report
// routing on its copper layer.
// ---------------------------------------------------------------------------
describe.skipIf(!hasParallellaFixture)("queryNet -- poured copper on parallella RevB", () => {
  it("returns routing for the poured 2-pin net N22934179", async () => {
    const r = expectSuccess(await queryNet(PARALLELLA_REVB, "^N22934179$"));
    const net = r.matches[0];
    expect(net.routing).toBeDefined();
    expect(net.routing!.length).toBeGreaterThan(0);
    expect(net.routing!.some((rt) => rt.segmentCount > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token-bounding: heavy coordinate arrays are summarized by default so a single
// query can never blow the caller's context; full geometry is opt-in and capped.
// ---------------------------------------------------------------------------
describe("queryNet -- token bounding", () => {
  it("returns a compact via rollup and no raw via rows by default (summary)", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$"));
    const net = r.matches[0];
    expect(net.pinCount).toBe(2); // U1.1 + R1.2
    expect(net.viaCounts).toBeDefined();
    expect(net.viaCounts![0]).toEqual({ diameter: 300, layer: "TOP", count: 1 });
    expect(net.totalVias).toBe(1);
    // Raw per-via arrays are omitted in summary mode.
    expect(net).not.toHaveProperty("viaRows");
    expect(net).not.toHaveProperty("viaColumns");
    expect(net).not.toHaveProperty("viaDrills");
  });

  it("includes raw via rows alongside the rollup when detail=full", async () => {
    const r = expectSuccess(await queryNet(inlineXml, "^NET_A$", "full"));
    const net = r.matches[0];
    expect(net.viaCounts).toBeDefined();
    expect(net.viaRows).toBeDefined();
    expect(net.viaColumns).toEqual(["x", "y", "drillIndex"]);
  });

  it("aligns viaRows drillIndex with viaCounts across multiple drill types", async () => {
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="MIX"><PinRef pin="1" componentRef="U1"/></LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="MIX">
        <Hole platingStatus="VIA" x="0" y="0" diameter="0.3"/>
        <Hole platingStatus="VIA" x="1" y="1" diameter="0.5"/>
        <Hole platingStatus="VIA" x="2" y="2" diameter="0.3"/>
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "mixed-drills.xml");
    writeFileSync(f, xml);
    const net = expectSuccess(await queryNet(f, "^MIX$", "full")).matches[0];
    // First-seen drill (300) is index 0, second (500) is index 1.
    expect(net.viaCounts).toEqual([
      { diameter: 300, layer: "TOP", count: 2 },
      { diameter: 500, layer: "TOP", count: 1 },
    ]);
    // Each viaRows entry's drillIndex resolves to the matching viaCounts entry.
    for (const [, , drillIndex] of net.viaRows!) {
      expect(net.viaCounts![drillIndex]).toBeDefined();
    }
    expect(net.viaRows!.map((r) => r[2])).toEqual([0, 1, 0]);
  });

  it("caps raw via rows at the budget and flags truncated (detail=full)", async () => {
    const VIA_COUNT = MAX_COORD_ROWS + 100;
    const holes = Array.from(
      { length: VIA_COUNT },
      (_, i) => `<Hole platingStatus="VIA" x="${i}" y="${i}" diameter="0.3"/>`
    ).join("\n        ");
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="BIGNET">
    <PinRef pin="1" componentRef="U1"/>
    <PinRef pin="2" componentRef="U2"/>
    <PinRef pin="3" componentRef="U3"/>
  </LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="BIGNET">
        ${holes}
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "many-vias.xml");
    writeFileSync(f, xml);

    // Summary stays compact regardless of via count, and the coordinate-array
    // overflow does NOT truncate connectivity: all pins are still returned and the
    // result is not flagged truncated (the pin list has its own, higher budget).
    const summary = expectSuccess(await queryNet(f, "^BIGNET$"));
    expect(summary.matches[0].totalVias).toBe(VIA_COUNT);
    expect(summary.matches[0]).not.toHaveProperty("viaRows");
    expect(Object.keys(summary.matches[0].pins)).toEqual(["U1", "U2", "U3"]);
    expect(summary.matches[0].truncated).toBeFalsy();

    // Full mode caps the raw array but still reports the true total.
    const full = expectSuccess(await queryNet(f, "^BIGNET$", "full"));
    const net = full.matches[0];
    expect(net.totalVias).toBe(VIA_COUNT);
    expect(net.viaRows!.length).toBe(MAX_COORD_ROWS);
    expect(net.truncated).toBe(true);
    // 300 coord rows serialize to ~18 KB (~4-5k tokens) on the largest known net;
    // assert the whole full response stays well under a typical tool-response budget
    // even when the net has far more vias than the cap.
    expect(JSON.stringify(net).length).toBeLessThan(25_000);
  });

  it("spreads the truncated via sample across drill spans (detail=full)", async () => {
    // Three drill spans emitted contiguously: 600 of 0.3 (index 0), 300 of 0.5
    // (index 1), 100 of 0.7 (index 2); 1000 vias total, well over the cap. A naive
    // head-slice would return MAX_COORD_ROWS rows all from span 0; the stratified
    // cap must instead spread the budget across all three spans in proportion.
    const spans = [
      { dia: "0.3", n: 600 },
      { dia: "0.5", n: 300 },
      { dia: "0.7", n: 100 },
    ];
    const holes = spans
      .flatMap((s, si) =>
        Array.from(
          { length: s.n },
          (_, i) => `<Hole platingStatus="VIA" x="${si * 1000 + i}" y="0" diameter="${s.dia}"/>`
        )
      )
      .join("\n        ");
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="MANYSPANS"><PinRef pin="1" componentRef="U1"/></LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="MANYSPANS">
        ${holes}
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "many-spans.xml");
    writeFileSync(f, xml);

    const net = expectSuccess(await queryNet(f, "^MANYSPANS$", "full")).matches[0];
    expect(net.totalVias).toBe(1000);
    expect(net.viaRows!.length).toBe(MAX_COORD_ROWS);
    expect(net.truncated).toBe(true);
    // viaCounts still carries the true per-span totals.
    expect(net.viaCounts!.map((c) => c.count)).toEqual([600, 300, 100]);

    // Every span is represented in the truncated sample. The smaller spans being
    // non-empty is the key signal: a head-slice would leave them at zero.
    const perIndex = [0, 0, 0];
    for (const [, , drillIndex] of net.viaRows!) perIndex[drillIndex]++;
    expect(perIndex[0]).toBeGreaterThan(0);
    expect(perIndex[1]).toBeGreaterThan(0);
    expect(perIndex[2]).toBeGreaterThan(0);
    // Exact Hamilton allocation: shares 0.6/0.3/0.1 of the cap. At cap 300 the
    // quotas are integers (180/90/30), so there is no remainder and the split is
    // exact. Asserting exact counts (not just a ratio) makes an algorithm
    // regression visible rather than masked by slack.
    expect(perIndex).toEqual([MAX_COORD_ROWS * 0.6, MAX_COORD_ROWS * 0.3, MAX_COORD_ROWS * 0.1]);
  });

  it("may drop a span below its proportional share but keeps it in the rollup (detail=full)", async () => {
    // 1 via on one drill (index 0) + 999 on another (index 1), cap 300. The
    // 1-via span's share (0.3 rows) floors to 0 and loses the single leftover
    // row to the larger span's bigger remainder, so it gets no rows in the
    // sample. This is the documented boundary of the Hamilton method; viaCounts
    // still reports the dropped span's true total.
    const holes = [
      `<Hole platingStatus="VIA" x="0" y="0" diameter="0.3"/>`,
      ...Array.from(
        { length: 999 },
        (_, i) => `<Hole platingStatus="VIA" x="${i + 1}" y="0" diameter="0.5"/>`
      ),
    ].join("\n        ");
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="TINYSPAN"><PinRef pin="1" componentRef="U1"/></LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="TINYSPAN">
        ${holes}
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "tiny-span.xml");
    writeFileSync(f, xml);

    const net = expectSuccess(await queryNet(f, "^TINYSPAN$", "full")).matches[0];
    // Both spans are preserved in the rollup with their true totals...
    expect(net.viaCounts!.map((c) => c.count)).toEqual([1, 999]);
    expect(net.viaRows!.length).toBe(MAX_COORD_ROWS);
    expect(net.truncated).toBe(true);
    // ...but the 1-via span gets zero rows in the truncated sample.
    const perIndex = [0, 0];
    for (const [, , drillIndex] of net.viaRows!) perIndex[drillIndex]++;
    expect(perIndex[0]).toBe(0);
    expect(perIndex[1]).toBe(MAX_COORD_ROWS);
  });

  it("distributes the leftover budget when spans don't divide evenly (detail=full)", async () => {
    // 500/300/100 vias (900 total) with cap 300: the proportional floors are
    // 166/100/33 = 299, so one row is left over and must be handed to the span
    // with the largest fractional remainder (the 500-via span). If the remainder
    // were dropped, the sample would be 299 rows; asserting an exact full budget
    // proves the largest-remainder distribution ran.
    const spans = [
      { dia: "0.3", n: 500 },
      { dia: "0.5", n: 300 },
      { dia: "0.7", n: 100 },
    ];
    const holes = spans
      .flatMap((s, si) =>
        Array.from(
          { length: s.n },
          (_, i) => `<Hole platingStatus="VIA" x="${si * 1000 + i}" y="0" diameter="${s.dia}"/>`
        )
      )
      .join("\n        ");
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="UNEVEN"><PinRef pin="1" componentRef="U1"/></LogicalNet>
  <Step>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="UNEVEN">
        ${holes}
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;
    const f = path.join(tempDir, "uneven-spans.xml");
    writeFileSync(f, xml);

    const net = expectSuccess(await queryNet(f, "^UNEVEN$", "full")).matches[0];
    expect(net.totalVias).toBe(900);
    // Exactly the full budget: the leftover row was distributed, not dropped.
    expect(net.viaRows!.length).toBe(MAX_COORD_ROWS);
    expect(net.truncated).toBe(true);
    const perIndex = [0, 0, 0];
    for (const [, , drillIndex] of net.viaRows!) perIndex[drillIndex]++;
    expect(perIndex.every((c) => c > 0)).toBe(true);
  });

  it("caps the pins map on extreme-fanout nets but reports the true pinCount", async () => {
    const PIN_COUNT = MAX_PIN_ROWS + 100;
    // One pin each on a distinct refdes -> > MAX_PIN_ROWS refdes entries.
    const pinRefs = Array.from(
      { length: PIN_COUNT },
      (_, i) => `<PinRef pin="1" componentRef="U${i}"/>`
    ).join("\n    ");
    const xml = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <LogicalNet name="WIDENET">
    ${pinRefs}
  </LogicalNet>
  <Step><PhyNetGroup/></Step>
</IPC-2581>`;
    const f = path.join(tempDir, "wide-net.xml");
    writeFileSync(f, xml);

    const net = expectSuccess(await queryNet(f, "^WIDENET$")).matches[0];
    expect(net.pinCount).toBe(PIN_COUNT); // true total preserved
    expect(Object.keys(net.pins).length).toBe(MAX_PIN_ROWS); // map capped
    expect(net.truncated).toBe(true);
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
