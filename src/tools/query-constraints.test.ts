import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { queryConstraints } from "./query-constraints.js";
import { isErrorResult } from "./lib/types.js";
import type { ConstraintsOverviewResult, ConstraintsSectionResult } from "./lib/types.js";

const SAMPLE_TCFX = `<?xml version="1.0" encoding="UTF-8"?>
<cft:constrained-techfile xmlns:cft="urn:cadence-cft-1.0">
  <cft:xml-objects Name="PhysicalCSet">
    <object Name="DEFAULT">
      <attribute Name="MIN_LINE_WIDTH">
        <value Value="5.00:5.00:5.00:5.00" Generic="5.00"/>
      </attribute>
      <attribute Name="MAX_LINE_WIDTH"><value Value="100.00" Generic="100.00"/></attribute>
      <reference Kind="PhysicalCSet" Name="PARENT_RULE"/>
    </object>
    <object Name="POWER">
      <attribute Name="MIN_LINE_WIDTH">
        <value Value="10.00:10.00:10.00:10.00" Generic="10.00"/>
      </attribute>
      <member Kind="Net" Name="VCC_3V3"/>
      <member Kind="Net" Name="GND"/>
    </object>
  </cft:xml-objects>
  <cft:xml-objects Name="SpacingCSet">
    <object Name="DEFAULT">
      <attribute Name="LINE_TO_LINE">
        <value Value="4.00:4.00:4.00:4.00" Generic="4.00"/>
      </attribute>
    </object>
  </cft:xml-objects>
  <cft:xml-objects Name="Design">
    <object Name="STACKUP">
      <attribute Name="BOARD_THICKNESS"><value Value="1600.00"/></attribute>
      <x-section>
        <children PrimaryStackup="Primary" TopIndex="0" BottomIndex="3">
          <object Type="Mask">
            <attribute Name="MATERIAL"><value Value="Solder Mask"/></attribute>
          </object>
          <object Type="Conductor">
            <attribute Name="MATERIAL"><value Value="Copper"/></attribute>
            <attribute Name="THICKNESS"><value Value="35.00"/></attribute>
          </object>
          <object Type="Dielectric">
            <attribute Name="MATERIAL"><value Value="FR-4"/></attribute>
            <attribute Name="THICKNESS"><value Value="200.00"/></attribute>
          </object>
          <object Type="Conductor">
            <attribute Name="MATERIAL"><value Value="Copper"/></attribute>
            <attribute Name="THICKNESS"><value Value="35.00"/></attribute>
          </object>
        </children>
      </x-section>
    </object>
  </cft:xml-objects>
</cft:constrained-techfile>
`;

let tmpDir: string;
let tcfxPath: string;

beforeAll(async () => {
  tmpDir = path.join(os.tmpdir(), `pcb-lens-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  tcfxPath = path.join(tmpDir, "test_board.tcfx");
  await writeFile(tcfxPath, SAMPLE_TCFX, "utf-8");
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("queryConstraints", () => {
  it("returns error for non-existent file", async () => {
    const result = await queryConstraints("/no/such/file.tcfx");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("File not found");
    }
  });

  it("returns error for wrong extension", async () => {
    const xmlPath = path.join(tmpDir, "wrong.xml");
    await writeFile(xmlPath, "<root/>", "utf-8");

    const result = await queryConstraints(xmlPath);
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain(".tcfx");
    }
  });

  it("returns overview with correct sections and counts", async () => {
    const result = await queryConstraints(tcfxPath);
    expect(isErrorResult(result)).toBe(false);

    const overview = result as ConstraintsOverviewResult;
    expect(overview.fileName).toBe("test_board.tcfx");
    expect(overview.fileSizeBytes).toBeGreaterThan(0);
    expect(overview.sections).toHaveLength(3);

    const names = overview.sections.map((s) => s.name);
    expect(names).toContain("PhysicalCSet");
    expect(names).toContain("SpacingCSet");
    expect(names).toContain("Design");

    const physical = overview.sections.find((s) => s.name === "PhysicalCSet");
    expect(physical?.objectCount).toBe(2);

    const spacing = overview.sections.find((s) => s.name === "SpacingCSet");
    expect(spacing?.objectCount).toBe(1);

    const design = overview.sections.find((s) => s.name === "Design");
    expect(design?.objectCount).toBe(1);
  });

  it("returns objects with attributes, references, and members", async () => {
    const result = await queryConstraints(tcfxPath, "PhysicalCSet");
    expect(isErrorResult(result)).toBe(false);

    const section = result as ConstraintsSectionResult;
    expect(section.section).toBe("PhysicalCSet");
    expect(section.objects).toHaveLength(2);

    const defaultObj = section.objects.find((o) => o.name === "DEFAULT");
    expect(defaultObj).toBeDefined();
    expect(defaultObj!.attributes["MIN_LINE_WIDTH"]).toEqual({
      value: "5.00:5.00:5.00:5.00",
      generic: "5.00",
    });
    expect(defaultObj!.attributes["MAX_LINE_WIDTH"]).toEqual({
      value: "100.00",
      generic: "100.00",
    });
    expect(defaultObj!.references).toEqual([{ kind: "PhysicalCSet", name: "PARENT_RULE" }]);

    const powerObj = section.objects.find((o) => o.name === "POWER");
    expect(powerObj).toBeDefined();
    expect(powerObj!.members).toEqual([
      { kind: "Net", name: "VCC_3V3" },
      { kind: "Net", name: "GND" },
    ]);
  });

  it("parses cross-section layers from Design section", async () => {
    const result = await queryConstraints(tcfxPath, "Design");
    expect(isErrorResult(result)).toBe(false);

    const section = result as ConstraintsSectionResult;
    expect(section.objects).toHaveLength(1);

    const stackup = section.objects[0];
    expect(stackup.name).toBe("STACKUP");
    expect(stackup.attributes["BOARD_THICKNESS"]).toEqual({ value: "1600.00" });

    expect(stackup.crossSection).toBeDefined();
    const xs = stackup.crossSection!;
    expect(xs.primaryStackup).toBe("Primary");
    expect(xs.topIndex).toBe(0);
    expect(xs.bottomIndex).toBe(3);
    expect(xs.layers).toHaveLength(4);

    expect(xs.layers[0].type).toBe("Mask");
    expect(xs.layers[0].attributes["MATERIAL"]).toBe("Solder Mask");

    expect(xs.layers[1].type).toBe("Conductor");
    expect(xs.layers[1].attributes["MATERIAL"]).toBe("Copper");
    expect(xs.layers[1].attributes["THICKNESS"]).toBe("35.00");

    expect(xs.layers[2].type).toBe("Dielectric");
    expect(xs.layers[2].attributes["MATERIAL"]).toBe("FR-4");

    expect(xs.layers[3].type).toBe("Conductor");
  });

  it("returns error for non-existent section name", async () => {
    const result = await queryConstraints(tcfxPath, "NoSuchSection");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("NoSuchSection");
      expect(result.error).toContain("not found");
    }
  });
});
