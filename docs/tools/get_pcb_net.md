# get_pcb_net

Query nets by name pattern. Returns grouped connected pins, routing per layer (trace widths, trace lengths, segment counts), via information, and layers used.

## Description

Query nets by name pattern in an IPC-2581 file. Returns grouped connected pins, routing per layer (trace widths, trace lengths, segment counts), and via information. Rejects patterns that match all nets.

Finds all nets whose names match the given regex pattern, then collects connectivity and routing data for each match. Pin connectivity is grouped by component refdes to reduce response size. Empty routing/via fields and zero-value summary fields are omitted to keep payloads compact.

If a pattern matches all nets in a design (for example `.`, `.*`, or `.+`), the tool rejects the query and asks for a more specific pattern.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |
| `pattern` | string | Yes | - | Regex pattern for net name (e.g., `^DDR_D0$`, `CLK`, `^VCC_3V3$`) |

## Response Schema

```typescript
interface QueryNetsResult {
  pattern: string;
  units: string;
  matches: QueryNetResult[];
}

interface QueryNetResult {
  netName: string;
  pins: Record<string, string[]>;  // { refdes: [pin, ...] }
  routing?: NetRouteInfo[];          // omitted when empty
  viaDrills?: ViaDrill[];            // omitted when no vias
  viaColumns?: ["x", "y", "drillIndex"];
  viaRows?: ViaRow[];
  totalSegments?: number;            // omitted when 0
  totalVias?: number;                // omitted when 0
  totalTraceLength?: number;         // omitted when 0
  layersUsed: string[];
}

interface NetRouteInfo {
  layerName: string;
  traceWidths: number[]; // Unique widths in microns
  segmentCount: number;
  traceLength: number;   // microns
}

interface ViaDrill {
  diameter: number;
  layer: string;
}

type ViaRow = [x: number, y: number, drillIndex: number];
```

## Examples

**Query a signal net:**

Call:
```json
{
  "tool": "get_pcb_net",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "pattern": "^DDR_D0$"
  }
}
```

Response:
```json
{
  "pattern": "^DDR_D0$",
  "units": "MICRON",
  "matches": [
    {
      "netName": "DDR_D0",
      "pins": {
        "U1": ["A5"],
        "U8": ["D3"]
      },
      "routing": [
        {
          "layerName": "SIG1",
          "traceWidths": [100],
          "segmentCount": 12,
          "traceLength": 18400
        }
      ],
      "totalSegments": 12,
      "totalTraceLength": 18400,
      "layersUsed": ["SIG1"]
    }
  ]
}
```

**Query a power net:**

Response:
```json
{
  "pattern": "^VCC_3V3$",
  "units": "MICRON",
  "matches": [
    {
      "netName": "VCC_3V3",
      "pins": {
        "C1": ["1"],
        "C2": ["1"],
        "C3": ["1"],
        "L1": ["2"],
        "U1": ["B2", "C7"]
      },
      "routing": [
        {
          "layerName": "PWR",
          "traceWidths": [500],
          "segmentCount": 45,
          "traceLength": 92000
        },
        {
          "layerName": "TOP",
          "traceWidths": [200, 300],
          "segmentCount": 28,
          "traceLength": 41500
        }
      ],
      "viaDrills": [
        { "diameter": 300, "layer": "TOP" }
      ],
      "viaColumns": ["x", "y", "drillIndex"],
      "viaRows": [
        [12000, 34000, 0],
        [12500, 34000, 0]
      ],
      "totalSegments": 73,
      "totalVias": 2,
      "totalTraceLength": 133500,
      "layersUsed": ["PWR", "TOP"]
    }
  ]
}
```

**No match:**
```json
{
  "pattern": "^MISSING_NET$",
  "units": "MICRON",
  "matches": []
}
```

**Error (pattern matches all nets):**
```json
{
  "error": "Pattern '.*' matches all 307 physical nets. Use a more specific pattern, or use get_pcb_metadata for net counts and discovery."
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern: '^VCC[+'"
}
```

## Notes

- Returns all matching nets, sorted by net name
- Uses three passes: (1) match nets and collect LogicalNet/PhyNet data, (2) build a LineDesc dictionary, (3) collect routing and vias from LayerFeature sections
- Reference layers (`REF-route`, `REF-both`) are skipped to avoid counting template geometry
- `traceWidths` contains unique widths found on each layer (not one entry per segment)
- Vias are collected from `Hole` elements with `platingStatus="VIA"`; unique drill types (diameter + layer) are deduplicated into `viaDrills`, and `viaRows` reference them by `drillIndex`
- All physical values are normalized to microns
- `layersUsed` merges layers from PhyNet points and routing geometry
- Routing within each match is sorted by layer name
```