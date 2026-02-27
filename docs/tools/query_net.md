# query_net

Query a net by name pattern. Returns connected pins, routing per layer (trace widths, segment counts), and via information.

## Description

Finds the first net whose name matches the given regex pattern, then collects its full connectivity and routing data. Returns the list of component pins on the net, per-layer routing details (trace widths, segment counts), via usage, and a summary of layers used. Useful for inspecting signal integrity, checking trace widths on critical nets, or understanding how a net is routed across layers.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |
| `pattern` | string | Yes | - | Regex pattern for net name (e.g., `^DDR_D0$`, `CLK`, `^VCC_3V3$`) |

## Response Schema

```typescript
interface QueryNetResult {
  netName: string;
  units: string;                // Always "MICRON"
  pins: NetPin[];
  routing: NetRouteInfo[];
  vias: NetViaInfo[];
  totalSegments: number;
  totalVias: number;
  layersUsed: string[];
}

interface NetPin {
  refdes: string;
  pin: string;
}

interface NetRouteInfo {
  layerName: string;
  traceWidths: number[];        // Unique widths in microns
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
  "netName": "DDR_D0",
  "units": "MICRON",
  "pins": [
    { "refdes": "U1", "pin": "A5" },
    { "refdes": "U8", "pin": "D3" }
  ],
  "routing": [
    {
      "layerName": "SIG1",
      "traceWidths": [100],
      "segmentCount": 12
    }
  ],
  "vias": [],
  "totalSegments": 12,
  "totalVias": 0,
  "layersUsed": ["SIG1"]
}
```

**Query a power net:**

Call:
```json
{
  "tool": "query_net",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml",
    "pattern": "^VCC_3V3$"
  }
}
```

Response:
```json
{
  "netName": "VCC_3V3",
  "units": "MICRON",
  "pins": [
    { "refdes": "U1", "pin": "B2" },
    { "refdes": "U1", "pin": "C7" },
    { "refdes": "C1", "pin": "1" },
    { "refdes": "C2", "pin": "1" },
    { "refdes": "C3", "pin": "1" },
    { "refdes": "L1", "pin": "2" }
  ],
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
  "layersUsed": ["TOP", "PWR"]
}
```

**No match:**
```json
{
  "error": "No net matching pattern '^MISSING_NET$' found"
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern: ^VCC[+"
}
```

## Notes

- Matches the **first** net whose name matches the regex; use an anchored pattern like `^DDR_D0$` for exact matches
- Uses three passes: (1) find the matching net name, (2) build a LineDesc dictionary for trace width resolution, (3) collect pins, routing, and vias from LayerFeature sections
- Reference layers (REF-route, REF-both) are skipped to avoid counting template geometry
- `traceWidths` contains unique widths found on that layer (not per-segment)
- All widths are in microns
- `layersUsed` is a flat list of all layers where the net has routing
