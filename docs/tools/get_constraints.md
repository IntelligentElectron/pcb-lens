# get_constraints

Query layout constraints from a Cadence `.tcfx` file, a Constraint Manager `.dcf` file, or an Allegro `.brd` board.

## Description

Reads a Cadence technology constraint file (`.tcfx`) exported from an Allegro board, a Constraint Manager database (`.dcf`), or the constraints inside an Allegro `.brd` board directly, with no Cadence installation. Operates in two modes:

- **Overview mode** (no `section`): Returns the file size and a list of sections with object counts, useful for discovering what constraint categories exist.
- **Section mode** (with `section`): Returns all constraint objects in the specified section, each with attributes, references, members, and (for the Design section) cross-section stackup data.

Common sections include `PhysicalCSet` (trace width/spacing rules), `SpacingCSet` (clearance rules), `ElectricalCSet` (impedance/delay rules), `NetClass` (net groupings), `Design` (stackup definition), and `Region` (area-specific rules).

### .brd and .dcf files

A `.dcf` file and the archives embedded in a `.brd` hold Constraint Manager XML; their sections keep Constraint Manager names (`PhysicalCSet`, `SpacingCSet`, `ElectricalCSet`, `NetClass`, `MatchGroup`, `DiffPair`, `Region`, `Design`, ...). A board can embed several archives: the second copy of a section is named `<Section>#<archive>`.

A `.brd` (Allegro 17.x) also yields `Brd*` sections decoded from its binary database: `BrdPhysicalCSet`, `BrdElectricalCSet`, `BrdNetClass`, `BrdMatchGroup`, `BrdDiffPair`, `BrdRegion`, `BrdXnet`, `BrdBus`, `BrdNet` (nets with a set assignment or a direct rule) and `BrdStackup` (the cross-section: material, thickness in mm, Dk, loss tangent and conductivity per layer). These are the board's live rules; the embedded archives are snapshots that can be older or, rarely, come from another design. Each section's `source` says which it is. Binary lengths are in mm; a per-layer value is a `:` list from top to bottom. See [allegro-brd-format.md](../allegro-brd-format.md) for the layouts and confidence of each field.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to a `.tcfx`, `.dcf` or `.brd` file |
| `section` | string | No | - | Section name to query (e.g., `PhysicalCSet`, `SpacingCSet`). Omit for overview. |

## Response Schema

**Overview mode** (no section):

```typescript
interface ConstraintsOverviewResult {
  fileName: string;
  fileSizeBytes: number;
  allegroVersion?: string;                 // .brd: release that wrote the file, e.g. "17.2"
  sections: Array<{
    name: string;
    objectCount: number;
    source?: string;                       // .dcf/.brd: "binary", "dcf" or the embedded archive
    units?: string;                        // .dcf/.brd: unit of lengths in the section
  }>;
}
```

**Section mode** (with section):

```typescript
interface ConstraintsSectionResult {
  fileName: string;
  section: string;
  source?: string;
  units?: string;
  objects: ConstraintObject[];
}

interface ConstraintObject {
  name: string;
  attributes: Record<string, { value: string; generic?: string }>;
  references: Array<{ kind: string; name: string }>;
  members: Array<{ kind: string; name: string }>;
  crossSection?: CrossSection;
  kind?: string;                           // kind of a nested child object
  children?: ConstraintObject[];           // e.g. match groups inside an ElectricalCSet
}

interface CrossSection {
  primaryStackup?: string;
  topIndex?: number;
  bottomIndex?: number;
  layers: CrossSectionLayer[];
}

interface CrossSectionLayer {
  type: string;                           // "Conductor", "Dielectric", "Mask", "Surface"
  attributes: Record<string, string>;
}
```

## Examples

**Overview:**

Call:
```json
{
  "tool": "get_constraints",
  "arguments": {
    "file": "/designs/board_constraints.tcfx"
  }
}
```

Response:
```json
{
  "fileName": "board_constraints.tcfx",
  "fileSizeBytes": 245320,
  "sections": [
    { "name": "PhysicalCSet", "objectCount": 12 },
    { "name": "SpacingCSet", "objectCount": 8 },
    { "name": "ElectricalCSet", "objectCount": 4 },
    { "name": "NetClass", "objectCount": 6 },
    { "name": "Design", "objectCount": 1 },
    { "name": "Region", "objectCount": 3 }
  ]
}
```

**PhysicalCSet query:**

Call:
```json
{
  "tool": "get_constraints",
  "arguments": {
    "file": "/designs/board_constraints.tcfx",
    "section": "PhysicalCSet"
  }
}
```

Response:
```json
{
  "fileName": "board_constraints.tcfx",
  "section": "PhysicalCSet",
  "objects": [
    {
      "name": "DEFAULT",
      "attributes": {
        "MIN_LINE_WIDTH": { "value": "100" },
        "MAX_LINE_WIDTH": { "value": "5000" },
        "MIN_NECK_WIDTH": { "value": "75" }
      },
      "references": [
        { "kind": "PhysicalCSet", "name": "GLOBAL" }
      ],
      "members": []
    },
    {
      "name": "DDR4_DATA",
      "attributes": {
        "MIN_LINE_WIDTH": { "value": "90", "generic": "mil" },
        "MAX_LINE_WIDTH": { "value": "90", "generic": "mil" },
        "IMPEDANCE": { "value": "50", "generic": "ohm" }
      },
      "references": [],
      "members": [
        { "kind": "Net", "name": "DDR_D0" },
        { "kind": "Net", "name": "DDR_D1" },
        { "kind": "Net", "name": "DDR_D2" },
        { "kind": "Net", "name": "DDR_D3" }
      ]
    }
  ]
}
```

**Design section with stackup:**

Call:
```json
{
  "tool": "get_constraints",
  "arguments": {
    "file": "/designs/board_constraints.tcfx",
    "section": "Design"
  }
}
```

Response:
```json
{
  "fileName": "board_constraints.tcfx",
  "section": "Design",
  "objects": [
    {
      "name": "board",
      "attributes": {},
      "references": [],
      "members": [],
      "crossSection": {
        "primaryStackup": "Primary",
        "topIndex": 0,
        "bottomIndex": 9,
        "layers": [
          { "type": "Conductor", "attributes": { "NAME": "TOP", "THICKNESS": "35" } },
          { "type": "Dielectric", "attributes": { "NAME": "Pre-preg", "THICKNESS": "100", "DK": "4.2" } },
          { "type": "Conductor", "attributes": { "NAME": "GND", "THICKNESS": "35" } },
          { "type": "Dielectric", "attributes": { "NAME": "Core", "THICKNESS": "800", "DK": "4.5" } },
          { "type": "Conductor", "attributes": { "NAME": "PWR", "THICKNESS": "35" } },
          { "type": "Dielectric", "attributes": { "NAME": "Pre-preg", "THICKNESS": "100", "DK": "4.2" } },
          { "type": "Conductor", "attributes": { "NAME": "BOTTOM", "THICKNESS": "35" } }
        ]
      }
    }
  ]
}
```

**Section not found:**
```json
{
  "error": "Section 'FooBar' not found in file"
}
```

**Allegro board, binary physical constraint set:**

Call:
```json
{
  "tool": "get_constraints",
  "arguments": { "file": "/designs/board.brd", "section": "BrdPhysicalCSet" }
}
```

Response:
```json
{
  "fileName": "board.brd",
  "section": "BrdPhysicalCSet",
  "source": "binary",
  "units": "mm",
  "objects": [
    {
      "name": "DIFF_90",
      "attributes": {
        "MIN_LINE_WIDTH": { "value": "0.0750:0.0500:0.0500:0.0500:0.0500:0.0750" },
        "DIFFP_PRIMARY_GAP": { "value": "0.0750:0.0600:0.0600:0.0600:0.0600:0.0750" },
        "MAX_LINE_WIDTH": { "value": "0.0000" },
        "VIA_LIST": { "value": "VIA_T_L2:VIA_L2_L3:VIA_L5_B" }
      },
      "references": [],
      "members": []
    }
  ]
}
```

## Notes

- Attribute names (`MIN_LINE_WIDTH`, `IMPEDANCE`, etc.) carry domain semantics that the LLM interprets directly; the tool does not impose meaning on them
- The `generic` field on attributes holds a unit or type hint when the TCFX file provides one; for `.dcf`/`.brd` XML it holds the values per generic layer type (`G` in Constraint Manager XML)
- `references` link to other constraint objects (e.g., a PhysicalCSet referencing a parent rule)
- `members` list the nets, components, or other objects governed by this constraint
- `crossSection` is only present on Design section objects that define a stackup
- The overview mode is fast (just counts objects per section); the section mode parses all objects in the requested section
