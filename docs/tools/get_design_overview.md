# get_design_overview

Get overview of an IPC-2581 PCB design file: metadata, layer stackup, component/net counts, and section sizes.

## Description

Performs a single streaming pass over the IPC-2581 XML file to extract high-level design metadata. Use this as the first tool call when exploring an unfamiliar board file, since it reveals the layer count, component/net totals, and which sections are largest (useful for understanding file structure before drilling into specifics).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to IPC-2581 XML file |

## Response Schema

```typescript
interface DesignOverview {
  fileName: string;
  fileSizeBytes: number;
  totalLines: number;
  units: string;              // Always "MICRON"
  ipc2581Revision?: string;   // e.g. "B", "C"
  stepName?: string;          // e.g. "board"
  layers: LayerInfo[];
  componentCount: number;
  netCount: number;
  sections: SectionInfo[];    // Sorted by lineCount descending
}

interface LayerInfo {
  name: string;
  side?: string;              // e.g. "TOP", "BOTTOM", "INTERNAL"
  layerFunction?: string;     // e.g. "SIGNAL", "POWER_GROUND", "SOLDERMASK"
}

interface SectionInfo {
  name: string;
  lineCount: number;
}
```

## Example

**Call:**
```json
{
  "tool": "get_design_overview",
  "arguments": {
    "file": "/designs/motherboard_ipc2581.xml"
  }
}
```

**Response:**
```json
{
  "fileName": "motherboard_ipc2581.xml",
  "fileSizeBytes": 14523680,
  "totalLines": 312450,
  "units": "MICRON",
  "ipc2581Revision": "C",
  "stepName": "board",
  "layers": [
    { "name": "TOP", "side": "TOP", "layerFunction": "SIGNAL" },
    { "name": "GND", "side": "INTERNAL", "layerFunction": "POWER_GROUND" },
    { "name": "PWR", "side": "INTERNAL", "layerFunction": "POWER_GROUND" },
    { "name": "SIG1", "side": "INTERNAL", "layerFunction": "SIGNAL" },
    { "name": "SIG2", "side": "INTERNAL", "layerFunction": "SIGNAL" },
    { "name": "BOTTOM", "side": "BOTTOM", "layerFunction": "SIGNAL" }
  ],
  "componentCount": 847,
  "netCount": 1523,
  "sections": [
    { "name": "LayerFeature", "lineCount": 198340 },
    { "name": "Content", "lineCount": 52100 },
    { "name": "Ecad", "lineCount": 31200 },
    { "name": "Component", "lineCount": 18450 },
    { "name": "PhyNetGroup", "lineCount": 8920 },
    { "name": "Bom", "lineCount": 2340 },
    { "name": "LogisticHeader", "lineCount": 85 }
  ]
}
```

**Error (file not found):**
```json
{
  "error": "File not found: /designs/missing.xml"
}
```

## Notes

- Uses a single streaming pass, so performance scales linearly with file size
- Sections are sorted by `lineCount` descending, making it easy to see which parts dominate the file
- `componentCount` is derived from placement entries in the Component section (not BOM line items)
- `netCount` is the number of `PhyNet` entries
- `ipc2581Revision` and `stepName` may be absent if the file omits them
