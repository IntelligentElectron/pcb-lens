# query_constraints

Query layout constraints from a Cadence `.tcfx` file.

## Description

Reads a Cadence technology constraint file (`.tcfx`) exported from an Allegro board. Operates in two modes:

- **Overview mode** (no `section`): Returns the file size and a list of sections with object counts, useful for discovering what constraint categories exist.
- **Section mode** (with `section`): Returns all constraint objects in the specified section, each with attributes, references, members, and (for the Design section) cross-section stackup data.

Common sections include `PhysicalCSet` (trace width/spacing rules), `SpacingCSet` (clearance rules), `ElectricalCSet` (impedance/delay rules), `NetClass` (net groupings), `Design` (stackup definition), and `Region` (area-specific rules).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to `.tcfx` constraint file |
| `section` | string | No | - | Section name to query (e.g., `PhysicalCSet`, `SpacingCSet`). Omit for overview. |

## Response Schema

**Overview mode** (no section):

```typescript
interface ConstraintsOverviewResult {
  fileName: string;
  fileSizeBytes: number;
  sections: Array<{
    name: string;
    objectCount: number;
  }>;
}
```

**Section mode** (with section):

```typescript
interface ConstraintsSectionResult {
  fileName: string;
  section: string;
  objects: ConstraintObject[];
}

interface ConstraintObject {
  name: string;
  attributes: Record<string, { value: string; generic?: string }>;
  references: Array<{ kind: string; name: string }>;
  members: Array<{ kind: string; name: string }>;
  crossSection?: CrossSection;
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
  "tool": "query_constraints",
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
  "tool": "query_constraints",
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
  "tool": "query_constraints",
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
  "error": "Section 'FooBar' not found in board_constraints.tcfx. Available sections: PhysicalCSet, SpacingCSet, ElectricalCSet, NetClass, Design, Region"
}
```

## Notes

- Attribute names (`MIN_LINE_WIDTH`, `IMPEDANCE`, etc.) carry domain semantics that the LLM interprets directly; the tool does not impose meaning on them
- The `generic` field on attributes holds a unit or type hint when the TCFX file provides one
- `references` link to other constraint objects (e.g., a PhysicalCSet referencing a parent rule)
- `members` list the nets, components, or other objects governed by this constraint
- `crossSection` is only present on Design section objects that define a stackup
- The overview mode is fast (just counts objects per section); the section mode parses all objects in the requested section
