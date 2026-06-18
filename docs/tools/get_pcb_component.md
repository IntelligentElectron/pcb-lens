# get_pcb_component

Look up a single component by exact refdes. Returns placement, package, BOM data, connected nets, and a pad-geometry summary (with per-pin coordinates on request).

## Description

Look up a single component by exact refdes in an IPC-2581 file. Returns placement (x/y/rotation/layer/mount type), package (with parsed Cadence package details when recognizable), BOM data (description and characteristics like value, tolerance, etc.), connected nets with the component's pin names, and a pad-geometry summary (pad count + deduped pad shapes). Pass `detail="full"` for per-pin pad coordinates. Useful for inspecting a specific IC, capacitor, or resistor.

Responses are token-bounded by design: the per-pin pad coordinate array (`padRows`) is heavy for high-pin-count parts, so it is omitted by default in favor of `padCount` + `padShapes`. Callers that need every pad coordinate pass `detail="full"`; even then the array is capped to 300 rows (with `truncated: true` set) so a `detail="full"` response stays within a tool-response budget even for the highest-pin-count parts.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |
| `refdes` | string | Yes | - | Exact component reference designator (e.g., `'U5'`, `'C10'`, `'R22'`) |
| `detail` | `"summary"` \| `"full"` | No | `"summary"` | `summary` returns pad count + shapes only; `full` adds per-pin pad x/y coordinates (capped) |

## Response Schema

```typescript
interface ComponentResult {
  refdes: string;
  units: string;                    // Always "MICRON"
  packageRef: string;
  parsed?: ParsedPackage;           // Present when a package family can be derived from packageRef
  x: number;                        // Microns
  y: number;                        // Microns
  rotation: number;                 // Degrees counterclockwise
  layer: string;                    // e.g. "TOP", "BOTTOM"
  mountType?: string;               // e.g. "SMD", "THRU_HOLE"
  description?: string;             // From BOM
  characteristics: Record<string, string>;  // e.g. { "TOL": "1%", "VALUE": "100nF" }
  netColumns: ["netName", "pins", "pinCount"];
  netRows: NetRow[];                // [netName, pins, pinCount], sorted by netName
  padCount?: number;                // Total pads in the land pattern (present when pad geometry resolved)
  padShapes?: PadShape[];           // Unique pad shapes, referenced by index from padRows
  padColumns?: ["pin", "x", "y", "shapeIndex"]; // detail="full" only
  padRows?: PadRow[];               // [pin, x, y, shapeIndex], sorted by pin; detail="full" only (capped)
  truncated?: boolean;              // true when padRows was capped to the response budget
}

interface ParsedPackage {
  packageFamily: string;
  pinCount?: number;                // Authoritative count from geometry; absent when it cannot be determined
  bodySize_mm?: { width: number; height: number };
  pitch_mm?: number;
  ballHeight_mm?: number;
  ubmDiameter_mm?: number;
}

interface PadShape {
  shape: "rect" | "circle" | "oval" | "polygon";  // "polygon" pads are reported by bounding box
  width: number;                    // Microns
  height: number;                   // Microns
}

// pinCount is the net's total pin count across all components, not this component's pin count
type NetRow = [netName: string, pins: string[], pinCount: number];
type PadRow = [pin: string, x: number, y: number, shapeIndex: number];
```

## Examples

**Look up an IC:**

Call:
```json
{
  "tool": "get_pcb_component",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "refdes": "U15"
  }
}
```

Response:
```json
{
  "refdes": "U15",
  "units": "MICRON",
  "packageRef": "BGA-256_17x17",
  "x": 45230000,
  "y": 31500000,
  "rotation": 0,
  "layer": "TOP",
  "mountType": "SMD",
  "description": "IC MCU 32BIT 1MB FLASH 256BGA",
  "characteristics": {
    "VALUE": "STM32H743VIT6"
  },
  "netColumns": ["netName", "pins", "pinCount"],
  "netRows": [
    ["DDR_D0", ["B4"], 2],
    ["VCC_3V3", ["A1", "A2"], 14]
  ],
  "padCount": 256,
  "padShapes": [
    { "shape": "circle", "width": 250, "height": 250 }
  ]
}
```

**Look up an IC with per-pin pad coordinates (`detail="full"`):**

Call:
```json
{
  "tool": "get_pcb_component",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "refdes": "U15",
    "detail": "full"
  }
}
```

Response (adds `padColumns`/`padRows` alongside `padCount`/`padShapes`):
```json
{
  "refdes": "U15",
  "units": "MICRON",
  "packageRef": "BGA-256_17x17",
  "padCount": 256,
  "padShapes": [{ "shape": "circle", "width": 250, "height": 250 }],
  "padColumns": ["pin", "x", "y", "shapeIndex"],
  "padRows": [
    ["A1", 45120000, 31380000, 0],
    ["A2", 45200000, 31380000, 0]
  ]
}
```

**Look up a capacitor:**

Call:
```json
{
  "tool": "get_pcb_component",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "refdes": "C1"
  }
}
```

Response:
```json
{
  "refdes": "C1",
  "units": "MICRON",
  "packageRef": "CAP_0402",
  "x": 44100000,
  "y": 30200000,
  "rotation": 90,
  "layer": "TOP",
  "mountType": "SMD",
  "description": "CAP CER 100NF 16V 0402",
  "characteristics": {
    "VALUE": "100nF",
    "TOL": "10%"
  },
  "netColumns": ["netName", "pins", "pinCount"],
  "netRows": [
    ["GND", ["2"], 312],
    ["VCC_3V3", ["1"], 14]
  ]
}
```

**Error (component not found):**
```json
{
  "error": "Component 'Z99' not found"
}
```

**Error (invalid refdes length):**
```json
{
  "error": "refdes must be 1-200 characters"
}
```

## Notes

- Component lookup is an exact refdes match (not a pattern); there is no bulk/pattern component query. To find candidate refdes values, use `get_pcb_metadata` for component counts and design structure, or `get_pcb_net` to trace connectivity by net, then query individual refdes values here.
- Uses multiple passes: component placement, then BOM data, then `LogicalNet` connectivity, then pad geometry from the package definition.
- Coordinates and dimensions are normalized to microns; rotation is in degrees counterclockwise.
- `parsed` is present whenever a package family can be derived from `packageRef`. Its `pinCount` is the authoritative count from pad/net geometry (not the case-size digits in the footprint name); it is omitted only when no count can be determined.
- `netRows` lists each net the component connects to, the component's pins on that net, and the net's total pin count; rows are sorted by net name.
- `padCount` and `padShapes` are present whenever pad geometry resolves. The per-pin `padColumns`/`padRows` coordinates are returned only with `detail="full"`, sorted by pin, and capped to 300 rows (with `truncated: true`) to keep responses token-bounded. Pad shapes defined as a polygon/contour are reported by their bounding box (`shape: "polygon"`).
- The `characteristics` record contains key-value pairs from the BOM (varies by design, common keys include VALUE, TOL, VOLTAGE).
- `mountType` and `description` may be absent if the IPC-2581 file omits them.
