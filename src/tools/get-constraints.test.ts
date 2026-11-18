import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { queryConstraints } from "./get-constraints.js";
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

// =============================================================================
// Cadence .dcf and Allegro .brd (synthetic files built from docs/allegro-brd-format.md)
// =============================================================================

/** Zip local-file entries, stored (method 0); the reader does not check CRCs. */
const zipEntries = (entries: Array<[string, string]>): Buffer =>
  Buffer.concat(
    entries.flatMap(([name, text]) => {
      const data = Buffer.from(text, "utf8");
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt32LE(data.length, 18);
      h.writeUInt32LE(data.length, 22);
      h.writeUInt16LE(name.length, 26);
      return [h, Buffer.from(name, "latin1"), data];
    })
  );

const CM_DESIGN = [
  '<root><o N="board"><a N="PHYSICAL_CONSTRAINT_SET"><v V="@lib.lib(view):\\DEFAULT\\"/><o>2</o></a>',
  '<r K="39" N="@lib.lib(view):\\DEFAULT\\"/><xs><g><t>Conductor</t></g><c S="0 " P="PRIMARY" T="0" B="2">',
  '<o T="1"><a N="CDS_LAYER_NAME"><v V="TOP"/><o>1</o></a><a N="CDS_LAYER_FUNCTION"><v V="CONDUCTOR"/></a></o>',
  '<o T="2"><a N="CDS_LAYER_THICKNESS"><v V="0.05"/></a><a N="CDS_LAYER_FUNCTION"><v V="DIELECTRIC"/></a></o>',
  "</c></xs></o></root>",
].join("");
const CM_PHYSICAL =
  '<root><o N="@lib.lib(sch_1):\\DIFF90\\" A="DIFF90"><a N="MIN_LINE_WIDTH"><v V="0.1000:0.0600" G="0.0600:0.1000"/><o>1</o></a>' +
  '<a N="DIFFP_PRIMARY_GAP"><v G="0.0800:0.0800"/></a></o></root>';
const CM_ELECTRICAL =
  '<root><o N="ECS_A" T="T1"><a N="DIFFP_PHASE_TOL"><v V="5 ps"/></a><c K="24"><o N="ECS_A:MG_A">' +
  '<m K="25" N="ECS_A:U1.A1:U2.B1"/></o></c></o></root>';

const dcfArchive = (): Buffer =>
  zipEntries([
    ["FileType.txt", "Design"],
    [
      "Header.xml",
      '<root Name="board" Key="logical"><precision units="mm" numberOfDecimalPlaces="4"/></root>',
    ],
    ["objects/Design.xml", CM_DESIGN],
    ["objects/PhysicalCSet.xml", CM_PHYSICAL],
    ["objects/ElectricalCSet.xml", CM_ELECTRICAL],
    ["objects/Gate.xml", '<root><o N="U1"/></root>'],
  ]);

/** A minimal Allegro 17.2 board: header, string table, object blocks, then an embedded archive. */
const syntheticBrd = (): Buffer => {
  const strings = [
    "DEFAULT",
    "DIFF90",
    "NET_P",
    "NET_N",
    "CLS_A",
    "DP_A",
    "ECS_A",
    "VIA_A",
    "AIR",
    "COPPER",
    "FR-4",
  ];
  const header = Buffer.alloc(0x1200);
  header.writeUInt32LE(0x00140400, 0);
  for (let list = 0; list < 23; list++) header.writeUInt32LE(0x65 + list, 0x3c + 8 * list); // tails
  header.writeUInt32LE(0x100, 0x3c + 8 * 5 + 4); // nets
  header.writeUInt32LE(0x200, 0x3c + 8 * 12 + 4); // constraint sets
  header.writeUInt32LE(0x400, 0x3c + 8 * 15 + 4); // tables
  header.writeUInt8(3, 0x180); // millimeters
  header.writeUInt32LE(strings.length, 0x194);
  header.writeUInt32LE(10000, 0x26c); // units per mm

  const strTable = Buffer.concat(
    strings.map((s, i) => {
      const b = Buffer.alloc(4 + ((s.length + 1 + 3) & ~3));
      b.writeUInt32LE(i + 1, 0);
      b.write(s, 4, "latin1");
      return b;
    })
  );
  const words = (...ws: number[]) => {
    const b = Buffer.alloc(4 * ws.length);
    ws.forEach((v, i) => b.writeUInt32LE(v >>> 0, 4 * i));
    return b;
  };
  const text = (s: string, bytes: number) => {
    const b = Buffer.alloc(bytes);
    b.write(s, 0, "latin1");
    return b;
  };
  const record = (width: number, gap: number, allowed: number) => {
    const r = new Array(14).fill(0);
    r[1] = width;
    r[6] = allowed;
    r[7] = gap;
    return words(...r);
  };
  // 108-byte cross-section record; doubles as two words, high word first
  const layerRecord = (index: number, type: number, thickness: number, dk: number, df: number) => {
    const r = Buffer.alloc(108);
    r.writeUInt32LE(index, 8);
    r.writeUInt32LE(type, 24);
    r.writeUInt32LE([9, 10, 11][type], 40); // material: AIR, COPPER, FR-4
    const dbl = (off: number, v: number) => {
      const d = Buffer.alloc(8);
      d.writeDoubleBE(v, 0);
      r.writeUInt32LE(d.readUInt32BE(0), off);
      r.writeUInt32LE(d.readUInt32BE(4), off + 4);
    };
    dbl(60, thickness);
    dbl(84, dk);
    dbl(92, df);
    return r;
  };
  const LT_NETS = 0x6a,
    LT_SETS = 0x71,
    LT_TABLES = 0x74;
  const blocks = [
    words(0x1b, 0x100, 0x101, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    words(0x1b, 0x101, LT_NETS, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    words(0x1d, 0x200, 0x201, 2, 0, 1 | (2 << 16)), // 1 via slot, 2 layers
    record(1000, 1270, 1),
    record(600, 1000, 0),
    words(0),
    text("VIA_A", 252),
    words(0),
    words(0x1e, 0x201, LT_SETS, 7, 0, 0, 0),
    words(0x3 | (0x6f << 16), 0x300, 0x201, 0x201, 0x68 | (8 << 16), 0),
    text("5 ps", 8),
    words(0x3 | (0x7c << 16), 0x301, 0x300, 0x201, 0x66, 0, 60000),
    words(0x3 | (0x1a0 << 16), 0x302, 0x100, 0x100, 0x6a, 0, 2),
    words(0x2c | (0x15 << 16), 0x400, 0x401, LT_TABLES, 0, 0, 5, 0x500, 0, 0, 0),
    words(0x2c | (0x103 << 16), 0x401, LT_TABLES, LT_TABLES, 0, 0, 6, 0, 0, 0, 0),
    words(0x37, 0x500, 0x400, 0, 2, 2, 0x100, 0x101, 0),
    words(0x26, 0x600, 0, 0x100, 0x401, 0),
    words(0x26, 0x601, 0, 0x101, 0x401, 0),
    words(0x00100036, 0x700, 0, 0, 0x96, 3, 3, 0), // 3 layers in 4 slots
    ...[
      [1, 1, 0, 1, 0],
      [2, 2, 50e-6, 3.5, 0.02],
      [0, 0, 0, 1, 0],
    ].map(([index, type, thickness, dk, df]) => layerRecord(index, type, thickness, dk, df)),
    Buffer.alloc(108), // empty slot
  ];
  const archive = zipEntries([
    ["FileType.txt", "Attach"],
    ["Header.xml", "<root/>"],
    [
      "objects/SpacingCSet.xml",
      '<root><o N="DEFAULT"><a N="LINE_TO_LINE_SPACING"><v G="0.0500"/></a></o></root>',
    ],
  ]);
  return Buffer.concat([header, strTable, ...blocks, archive, Buffer.alloc(64)]);
};

describe("queryConstraints on Cadence .dcf", () => {
  let dcfPath: string;
  beforeAll(async () => {
    dcfPath = path.join(tmpDir, "board.dcf");
    await writeFile(dcfPath, dcfArchive());
  });

  it("lists Constraint Manager sections and skips component data", async () => {
    const result = (await queryConstraints(dcfPath)) as ConstraintsOverviewResult;
    expect(result.sections.map((s) => s.name).sort()).toEqual([
      "Design",
      "ElectricalCSet",
      "PhysicalCSet",
    ]);
    expect(result.sections[0].units).toBe("mm");
  });

  it("reads per-layer values, generic values and short names", async () => {
    const result = (await queryConstraints(dcfPath, "PhysicalCSet")) as ConstraintsSectionResult;
    const diff = result.objects[0];
    expect(diff.name).toBe("DIFF90");
    expect(diff.attributes.MIN_LINE_WIDTH).toEqual({
      value: "0.1000:0.0600",
      generic: "0.0600:0.1000",
    });
    expect(diff.attributes.DIFFP_PRIMARY_GAP.value).toBe("0.0800:0.0800");
  });

  it("reads nested children, references and the cross-section", async () => {
    const ecs = ((await queryConstraints(dcfPath, "ElectricalCSet")) as ConstraintsSectionResult)
      .objects[0];
    expect(ecs.attributes.DIFFP_PHASE_TOL.value).toBe("5 ps");
    expect(ecs.children?.[0]).toMatchObject({ name: "ECS_A:MG_A", kind: "MatchGroup" });
    expect(ecs.children?.[0].members).toEqual([{ kind: "PinPair", name: "ECS_A:U1.A1:U2.B1" }]);

    const design = ((await queryConstraints(dcfPath, "Design")) as ConstraintsSectionResult)
      .objects[0];
    expect(design.references).toEqual([{ kind: "PhysicalCSet", name: "DEFAULT" }]);
    expect(design.crossSection?.layers).toEqual([
      { type: "CONDUCTOR", attributes: { CDS_LAYER_NAME: "TOP", CDS_LAYER_FUNCTION: "CONDUCTOR" } },
      {
        type: "DIELECTRIC",
        attributes: { CDS_LAYER_THICKNESS: "0.05", CDS_LAYER_FUNCTION: "DIELECTRIC" },
      },
    ]);
    expect(design.crossSection?.bottomIndex).toBe(2);
  });
});

describe("queryConstraints on Allegro .brd", () => {
  let brdPath: string;
  const section = async (name: string) =>
    ((await queryConstraints(brdPath, name)) as ConstraintsSectionResult).objects;
  beforeAll(async () => {
    brdPath = path.join(tmpDir, "board.brd");
    await writeFile(brdPath, syntheticBrd());
  });

  it("lists embedded archive and binary sections", async () => {
    const result = (await queryConstraints(brdPath)) as ConstraintsOverviewResult;
    expect(result.allegroVersion).toBe("17.2");
    const byName = Object.fromEntries(result.sections.map((s) => [s.name, s]));
    expect(byName.SpacingCSet.source).toContain("Attach");
    expect(byName.BrdPhysicalCSet).toMatchObject({ objectCount: 1, source: "binary", units: "mm" });
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining(["BrdElectricalCSet", "BrdNetClass", "BrdDiffPair", "BrdNet"])
    );
  });

  it("decodes a physical constraint set per layer, with its via list", async () => {
    const [cset] = await section("BrdPhysicalCSet");
    expect(cset.name).toBe("DIFF90");
    expect(cset.attributes.MIN_LINE_WIDTH.value).toBe("0.1000:0.0600");
    expect(cset.attributes.DIFFP_PRIMARY_GAP.value).toBe("0.1270:0.1000");
    expect(cset.attributes.MAX_LINE_WIDTH.value).toBe("0.0000");
    expect(cset.attributes.VIA_LIST.value).toBe("VIA_A");
    expect(cset.attributes.ALLOW_ON_ETCH_SUBCLASS.value).toBe("TRUE:FALSE");
  });

  it("decodes fields of electrical sets and nets", async () => {
    const [ecs] = await section("BrdElectricalCSet");
    expect(ecs.attributes).toEqual({
      DIFFP_PHASE_TOL: { value: "5 ps" },
      DIFFP_UNCOUPLED_LENGTH: { value: "6.0000" },
    });
    const nets = await section("BrdNet");
    expect(nets).toEqual([
      {
        name: "NET_P",
        attributes: { PHYSICAL_CONSTRAINT_SET: { value: "DIFF90" } },
        references: [],
        members: [],
      },
    ]);
  });

  it("decodes the stackup in index order", async () => {
    const [stackup] = await section("BrdStackup");
    expect(stackup.crossSection?.layers.map((l) => l.type)).toEqual([
      "SURFACE",
      "CONDUCTOR",
      "DIELECTRIC",
    ]);
    expect(stackup.crossSection?.layers[2].attributes).toMatchObject({
      CDS_LAYER_MATERIAL: "FR-4",
      CDS_LAYER_THICKNESS: "0.05",
      CDS_LAYER_DIELECTRIC_CONSTANT: "3.5",
      CDS_LAYER_LOSS_TANGENT: "0.02",
    });
  });

  it("resolves members from member arrays and per-net links", async () => {
    const members = [
      { kind: "Net", name: "NET_P" },
      { kind: "Net", name: "NET_N" },
    ];
    expect((await section("BrdNetClass"))[0]).toMatchObject({ name: "CLS_A", members });
    expect((await section("BrdDiffPair"))[0]).toMatchObject({ name: "DP_A", members });
  });
});

// Public Allegro 17.4 board from the test-fixtures repo (Apache-2.0); skipped when absent
const PUBLIC_BRD = path.resolve(
  import.meta.dirname,
  "../../test/fixtures/cadence/OSHW-Jetson-Series/reComputer Jetson carrier board/reComputer J401/Layout/reComputer J401_V1.0.brd"
);

describe.skipIf(!existsSync(PUBLIC_BRD))("queryConstraints on a public Allegro 17.4 board", () => {
  it("reads binary and embedded sections", async () => {
    const result = (await queryConstraints(PUBLIC_BRD)) as ConstraintsOverviewResult;
    expect(result.allegroVersion).toBe("17.4");
    const byName = Object.fromEntries(result.sections.map((s) => [s.name, s]));
    expect(byName.BrdPhysicalCSet).toMatchObject({ objectCount: 4, units: "mm" });
    expect(byName.PhysicalCSet).toMatchObject({ objectCount: 4, units: "mils" });
    expect(byName.BrdDiffPair.objectCount).toBe(101);
  });

  it("decodes physical sets per layer, matching the embedded XML", async () => {
    const binary = (
      (await queryConstraints(PUBLIC_BRD, "BrdPhysicalCSet")) as ConstraintsSectionResult
    ).objects;
    const xml = ((await queryConstraints(PUBLIC_BRD, "PhysicalCSet")) as ConstraintsSectionResult)
      .objects;
    expect(binary.map((o) => o.name).sort()).toEqual(xml.map((o) => o.name).sort());
    const set85 = binary.find((o) => o.name === "85")!;
    expect(set85.attributes.MIN_LINE_WIDTH.value).toBe("0.1041:0.1041:0.0787:0.0787:0.1041:0.1041");
    expect(set85.attributes.DIFFP_PRIMARY_GAP.value).toBe(
      "0.1016:0.1016:0.1067:0.1067:0.1016:0.1016"
    );
    // DEFAULT is 5 mil in the XML: width and min blind-via stagger
    const def = binary.find((o) => o.name === "DEFAULT")!;
    const defXml = xml.find((o) => o.name === "DEFAULT")!;
    expect(defXml.attributes.MIN_LINE_WIDTH.value).toBe("5.00");
    expect(def.attributes.MIN_LINE_WIDTH.value).toBe("0.1270");
    expect(def.attributes.MIN_BVIA_STAGGER.value).toBe("0.1270");
  });
});
