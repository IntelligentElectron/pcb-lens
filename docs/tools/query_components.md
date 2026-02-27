# query_components

Find components by refdes pattern. Returns placement (x/y/rotation/layer), package, and BOM data.

## Description

Searches for components whose reference designator matches a regex pattern. Returns physical placement data (coordinates, rotation, layer, mount type) merged with BOM data (description, characteristics like value, tolerance, etc.). Useful for finding specific ICs, all capacitors near a region, or groups of components by prefix.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |
| `pattern` | string | Yes | - | Regex pattern for component refdes (e.g., `^U1$`, `^C\d+`, `R10[0-9]`) |

## Response Schema

```typescript
interface QueryComponentsResult {
  pattern: string;
  units: string;                    // Always "MICRON"
  matches: ComponentResult[];       // Sorted alphabetically by refdes
}

interface ComponentResult {
  refdes: string;
  packageRef: string;
  x: number;                        // Microns
  y: number;                        // Microns
  rotation: number;                 // Degrees
  layer: string;                    // e.g. "TOP", "BOTTOM"
  mountType?: string;               // e.g. "SMD", "THRU_HOLE"
  description?: string;             // From BOM
  characteristics: Record<string, string>;  // e.g. { "TOL": "1%", "VALUE": "100nF" }
}
```

## Examples

**Match a single IC:**

Call:
```json
{
  "tool": "query_components",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "pattern": "^U15$"
  }
}
```

Response:
```json
{
  "pattern": "^U15$",
  "units": "MICRON",
  "matches": [
    {
      "refdes": "U15",
      "packageRef": "BGA-256_17x17",
      "x": 45230000,
      "y": 31500000,
      "rotation": 0,
      "layer": "TOP",
      "mountType": "SMD",
      "description": "IC MCU 32BIT 1MB FLASH 256BGA",
      "characteristics": {
        "VALUE": "STM32H743VIT6"
      }
    }
  ]
}
```

**Match all capacitors:**

Call:
```json
{
  "tool": "query_components",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "pattern": "^C\\d+"
  }
}
```

Response:
```json
{
  "pattern": "^C\\d+",
  "units": "MICRON",
  "matches": [
    {
      "refdes": "C1",
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
      }
    },
    {
      "refdes": "C2",
      "packageRef": "CAP_0402",
      "x": 44350000,
      "y": 30200000,
      "rotation": 90,
      "layer": "TOP",
      "mountType": "SMD",
      "description": "CAP CER 100NF 16V 0402",
      "characteristics": {
        "VALUE": "100nF",
        "TOL": "10%"
      }
    }
  ]
}
```

**No matches:**
```json
{
  "pattern": "^Z\\d+",
  "units": "MICRON",
  "matches": []
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern: ^C[\\d+"
}
```

## Notes

- Uses two passes: first collects placements from the Component section, then collects BOM data for matched components
- Results are sorted alphabetically by refdes
- Coordinates and dimensions are normalized to microns
- The `characteristics` record contains key-value pairs from the BOM (varies by design, common keys include VALUE, TOL, VOLTAGE)
- `mountType` and `description` may be absent if the IPC-2581 file omits them
- An empty `matches` array is returned (not an error) when the pattern is valid but matches nothing
