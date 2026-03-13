import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryViaInPad } from "./query-via-in-pad.js";
import { isErrorResult } from "./lib/types.js";
import type { ViaInPadResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE = path.join(FIXTURE_DIR, "BeagleBone_Black_RevB6.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE);

// ---------------------------------------------------------------------------
// Inline fixture with a 2-pin component, one via-in-pad and one without
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content>
    <EntryStandard id="PAD_RECT">
      <RectCenter width="0.5" height="0.5"/>
    </EntryStandard>
    <EntryStandard id="PAD_CIRCLE">
      <Circle diameter="0.3"/>
    </EntryStandard>
  </Content>
  <CadHeader units="MILLIMETER"/>
  <Ecad>
    <CadData>
      <PadStackDef name="VIA1">
        <PadstackHoleDef diameter="0.2"/>
        <PadstackPadDef padUse="REGULAR">
          <StandardPrimitiveRef id="PAD_CIRCLE"/>
        </PadstackPadDef>
      </PadStackDef>
      <Package name="PKG2">
        <Pin number="1">
          <Location x="0" y="0"/>
          <StandardPrimitiveRef id="PAD_RECT"/>
        </Pin>
        <Pin number="2">
          <Location x="1.0" y="0"/>
          <StandardPrimitiveRef id="PAD_RECT"/>
        </Pin>
      </Package>
    </CadData>
  </Ecad>
  <LogicalNet name="NET_A">
    <PinRef pin="1" componentRef="U1"/>
  </LogicalNet>
  <LogicalNet name="NET_B">
    <PinRef pin="2" componentRef="U1"/>
  </LogicalNet>
  <Step>
    <Component refDes="U1" packageRef="PKG2" layerRef="TOP">
      <Location x="10" y="20"/>
    </Component>
    <PhyNetGroup/>
    <LayerFeature layerRef="TOP">
      <Set net="NET_A" geometry="VIA1">
        <PinRef pin="1" componentRef="U1"/>
        <Hole platingStatus="VIA" diameter="0.2" x="10" y="20"/>
      </Set>
      <Set net="NET_B">
        <PinRef pin="2" componentRef="U1"/>
        <Polyline/>
      </Set>
    </LayerFeature>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "via-in-pad.xml");
  writeFileSync(inlineXml, INLINE_XML);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const expectSuccess = (result: unknown): ViaInPadResult => {
  expect(isErrorResult(result)).toBe(false);
  return result as ViaInPadResult;
};

// ---------------------------------------------------------------------------
// Basic functionality
// ---------------------------------------------------------------------------
describe("queryViaInPad -- classification", () => {
  it("classifies pin 1 as via-in-pad (via at same location)", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    const pin1 = r.pads.find((p) => p.pin === "1");
    expect(pin1).toBeDefined();
    expect(pin1!.classification).toBe("via-in-pad");
  });

  it("classifies pin 2 as no-via (no via nearby)", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    const pin2 = r.pads.find((p) => p.pin === "2");
    expect(pin2).toBeDefined();
    expect(pin2!.classification).toBe("no-via");
  });

  it("returns correct pad count", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    expect(r.pads).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
describe("queryViaInPad -- summary", () => {
  it("has correct summary counts", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    expect(r.summary.total).toBe(2);
    expect(r.summary.viaInPad).toBe(1);
    expect(r.summary.noVia).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
describe("queryViaInPad -- metadata", () => {
  it("units field is MICRON", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    expect(r.units).toBe("MICRON");
  });

  it("refdes reflects input", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    expect(r.refdes).toBe("U1");
  });

  it("packageRef is populated", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    expect(r.packageRef).toBe("PKG2");
  });

  it("via-in-pad pads include viaDistance_um", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    const pin1 = r.pads.find((p) => p.pin === "1");
    expect(pin1!.viaDistance_um).toBeDefined();
    expect(pin1!.viaDistance_um).toBeCloseTo(0, 0);
  });

  it("no-via pads omit viaDistance_um", async () => {
    const r = expectSuccess(await queryViaInPad(inlineXml, "U1"));
    const pin2 = r.pads.find((p) => p.pin === "2");
    expect(pin2!.viaDistance_um).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe("queryViaInPad -- validation", () => {
  it("returns error for non-existent component", async () => {
    const result = await queryViaInPad(inlineXml, "NONEXISTENT");
    expect(isErrorResult(result)).toBe(true);
  });

  it("returns error for empty refdes", async () => {
    const result = await queryViaInPad(inlineXml, "");
    expect(isErrorResult(result)).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await queryViaInPad("/nonexistent.xml", "U1");
    expect(isErrorResult(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture tests (conditional)
// ---------------------------------------------------------------------------
describe.skipIf(!hasBeagleBoneFixture)("queryViaInPad -- BeagleBone RevB6", () => {
  it("returns classifications for a known component", async () => {
    const r = expectSuccess(await queryViaInPad(BEAGLEBONE, "U5"));
    expect(r.pads.length).toBeGreaterThan(0);
    expect(r.summary.total).toBeGreaterThan(0);
    // Every pad should have a valid classification
    for (const pad of r.pads) {
      expect(["via-in-pad", "dog-bone", "no-via"]).toContain(pad.classification);
    }
  });
});
