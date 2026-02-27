# query_net

Query nets by name pattern. Returns grouped connected pins, routing per layer (trace widths, segment counts), via information, and layers used.

## Description

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
  units: "MICRON";
  matches: QueryNetResult[];
}

interface QueryNetResult {
  netName: string;
  pins: Record<string, string[]>; // { refdes: [pin, ...] }
  layersUsed: string[];
  routing?: NetRouteInfo[];        // omitted when empty
  vias?: NetViaInfo[];             // omitted when empty
  totalSegments?: number;          // omitted when 0
  totalVias?: number;              // omitted when 0
}

interface NetRouteInfo {
  layerName: string;
  traceWidths: number[]; // Unique widths in microns
  segmentCount: number;
}

interface NetViaInfo {
  padstackRef: string;
  count: number;
}
```

## Examples

**Query a signal net:**

Call:
```json
{
  "tool": "query_net",
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
          "segmentCount": 12
        }
      ],
      "totalSegments": 12,
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
          "layerName": "TOP",
          "traceWidths": [200, 300],
          "segmentCount": 28
        },
        {
          "layerName": "PWR",
          "traceWidths": [500],
          "segmentCount": 45
        }
      ],
      "vias": [
        { "padstackRef": "VIA_0.3mm", "count": 8 }
      ],
      "totalSegments": 73,
      "totalVias": 8,
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
  "error": "Pattern '.*' matches all 307 physical nets. Use a more specific pattern, or use get_design_overview for net counts and discovery."
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
- All physical values are normalized to microns
- `layersUsed` merges layers from PhyNet points and routing geometry
