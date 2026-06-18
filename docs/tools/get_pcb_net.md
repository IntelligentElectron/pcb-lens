# get_pcb_net

Query nets by name pattern. Returns grouped connected pins, per-layer routing (segment counts, plus trace widths and lengths for centerline-routed copper), a compact via rollup, and layers used.

## Description

Query nets by name pattern in an IPC-2581 file. Returns grouped connected pins, per-layer routing, and a compact via rollup (count per drill type). Routing reports the layers a net has copper on and a per-layer segment count; trace widths and lengths are reported for centerline-routed copper (Polyline/Line) and may be absent for shape/plane-routed (poured) copper, which has no centerline. Pass `detail="full"` for raw per-via coordinates (capped). Rejects patterns that match all nets.

Finds all nets whose names match the given regex pattern, then collects connectivity and routing data for each match. Pin connectivity is grouped by component refdes to reduce response size. Empty routing/via fields and zero-value summary fields are omitted to keep payloads compact.

Responses are token-bounded by design. By default (`detail="summary"`) the per-via coordinate array is replaced by `viaCounts` (a count per drill type + layer), so a query never balloons the caller's context. Callers that need every via coordinate pass `detail="full"`; even then the raw array is capped (with `truncated: true` set) to stay within a safe size.

If a pattern matches all nets in a design (for example `.`, `.*`, or `.+`), the tool rejects the query and asks for a more specific pattern.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |
| `pattern` | string | Yes | - | Regex pattern for net name (e.g., `^DDR_D0$`, `CLK`, `^VCC_3V3$`) |
| `detail` | `"summary"` \| `"full"` | No | `"summary"` | `summary` returns via counts only; `full` adds raw per-via x/y coordinates (capped) |

## Response Schema

```typescript
interface QueryNetsResult {
  pattern: string;
  units: string; // Always "MICRON"
  matches: QueryNetResult[];
}

interface QueryNetResult {
  netName: string;
  pinCount: number;                  // total connected pins (independent of any pins-map cap)
  pins: Record<string, string[]>;  // { refdes: [pin, ...] }
  routing?: NetRouteInfo[];          // omitted when empty
  viaCounts?: ViaCount[];            // compact rollup, returned by default; omitted when no vias
  viaDrills?: ViaDrill[];            // detail="full" only
  viaColumns?: ["x", "y", "drillIndex"]; // detail="full" only
  viaRows?: ViaRow[];                // detail="full" only (capped)
  totalSegments?: number;            // omitted when 0
  totalVias?: number;                // omitted when 0
  totalTraceLength?: number;         // omitted when 0
  layersUsed: string[];
  truncated?: boolean;               // true when a detail array or the pins map was capped
}

interface NetRouteInfo {
  layerName: string;
  traceWidths: number[]; // Unique widths in microns; empty for shape/plane-routed (poured) copper
  segmentCount: number;  // Count of conductor features on the layer (centerline traces + poured shapes)
  traceLength: number;   // microns; 0 for poured copper, which has no centerline length
}

interface ViaCount {
  diameter: number;
  layer: string;
  count: number;
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
      "pinCount": 2,
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
      "pinCount": 6,
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
      "viaCounts": [
        { "diameter": 300, "layer": "TOP", "count": 2 }
      ],
      "totalSegments": 73,
      "totalVias": 2,
      "totalTraceLength": 133500,
      "layersUsed": ["PWR", "TOP"]
    }
  ]
}
```

**Query a power net with raw via coordinates (`detail="full"`):**

Response (`viaColumns`/`viaRows` now present; each `viaRows` entry's `drillIndex` references `viaCounts` by position):
```json
{
  "pattern": "^VCC_3V3$",
  "units": "MICRON",
  "matches": [
    {
      "netName": "VCC_3V3",
      "pinCount": 6,
      "pins": { "C1": ["1"], "U1": ["B2", "C7"] },
      "viaCounts": [{ "diameter": 300, "layer": "TOP", "count": 2 }],
      "viaColumns": ["x", "y", "drillIndex"],
      "viaRows": [
        [12000, 34000, 0],
        [12500, 34000, 0]
      ],
      "totalVias": 2,
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
- Routing is parsed from `<Polyline>` and `<Line>` centerline conductors and from poured copper shapes (`<Contour>`/`<Polygon>`). Centerline conductors contribute trace widths and lengths; poured shapes contribute only layer presence and a segment count (no centerline width or length), so a net poured as filled copper still reports as routed
- Vias are collected from `Hole` elements with `platingStatus="VIA"`. By default they are summarized as `viaCounts` (count per unique drill type + layer). With `detail="full"`, `viaRows` carry per-via coordinates and each row's `drillIndex` references `viaCounts` by position; the raw `viaRows` array is capped (with `truncated: true`) to keep responses token-bounded
- On extreme-fanout nets the connected-pin list is capped (to at most a fixed number of pins) before being grouped into the `pins` map, setting `truncated: true`; `pinCount` always reports the true total connected-pin count
- All physical values are normalized to microns
- `layersUsed` merges layers from PhyNet points and routing geometry
- Routing within each match is sorted by layer name
