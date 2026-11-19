# get_pcb_layer

List what is drawn on the layers of an Allegro `.brd`: lines, rectangles, shapes and text, per layer, with full geometry on request.

## Description

Every piece of drawing in an Allegro board sits on a layer named `CLASS/SUBCLASS`: `BOARD_GEOMETRY/SILKSCREEN_TOP`, `PACKAGE_GEOMETRY/PLACE_BOUND_TOP`, `REF_DES/ASSEMBLY_TOP`, `ROUTE_KEEPOUT/ALL`, `ETCH/TOP`. This tool returns the items on the layers whose name matches a pattern: silkscreen and assembly drawings, refdes and value labels, pin numbers, place bounds, keepouts and keepins, soldermask openings, board outlines and notes, and copper shapes with their net. [`get_pcb_metadata`](get_pcb_metadata.md) lists the layers that hold items (`drawingLayers`).

Routed tracks and vias are reported by [`get_pcb_net`](get_pcb_net.md). Items a footprint definition draws as its template are not listed; items a placed component draws are, in board coordinates, with the component's `refdes`.

Responses are token-bounded: the summary gives per-layer counts, filled area and extent. `detail="full"` adds each item, capped to 300 items sampled across the matched layers; an item of more than 200 points (a large copper pour) gives its `extent` and `pointCount` instead of its contours. Either cap sets `truncated: true`.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to an Allegro `.brd` file (Allegro 16.0 to 25.1) |
| `layer` | string | Yes | - | Case-insensitive regex on `CLASS/SUBCLASS` layer names (e.g. `'SILKSCREEN_TOP'`, `'^PACKAGE_GEOMETRY/PLACE_BOUND'`, `'KEEPOUT'`) |
| `refdes` | string | No | - | Only items drawn by this component (exact refdes) |
| `within` | string | No | - | Only items overlapping this box: `'minX,minY,maxX,maxY'` in microns |
| `detail` | `"summary"` \| `"full"` | No | `"summary"` | `full` adds every item's geometry and text (capped) |

## Response Schema

```typescript
interface LayerQueryResult {
  fileName: string;
  units: "MICRON";
  itemCount: number;        // items matched, before any cap
  layers: LayerSummary[];   // sorted by layer name
  items?: BrdItem[];        // detail="full" only, capped to 300
  truncated?: boolean;      // true when items was capped
}

interface LayerSummary {
  layer: string;            // CLASS/SUBCLASS
  lines?: number;
  rectangles?: number;
  shapes?: number;
  texts?: number;
  filledArea?: number;      // mm² of filled shapes and rectangles, voids excluded
  extent?: { minX: number; minY: number; maxX: number; maxY: number };
}

interface BrdItem {
  kind: "line" | "rectangle" | "shape" | "text";
  layer: string;
  refdes?: string;          // the component that draws it
  net?: string;             // copper shapes
  filled?: boolean;
  width?: number;           // stroke width of a line or unfilled outline
  contours?: OutlineContour[]; // outline first, then a shape's voids (as in get_pcb_metadata's outline)
  area?: number;            // mm², filled items only
  text?: string;            // text items: the string, lines separated by "\n"
  x?: number;               // text anchor, on the baseline at the justified end
  y?: number;
  rotation?: number;        // degrees counterclockwise
  height?: number;          // character height
  mirrored?: boolean;       // drawn mirror-imaged, as seen from the top (17.x and later)
  justify?: "left" | "center" | "right";
  extent?: { minX: number; minY: number; maxX: number; maxY: number }; // in place of contours past 200 points
  pointCount?: number;      // the points left out
}
```

## Example

```json
{
  "fileName": "board.brd",
  "units": "MICRON",
  "itemCount": 4,
  "layers": [
    {
      "layer": "PACKAGE_KEEPOUT/TOP",
      "shapes": 4,
      "filledArea": 180.3357,
      "extent": { "minX": 10795, "minY": -635, "maxX": 84455, "maxY": 55245 }
    }
  ]
}
```

## Notes

- IPC-2581 files are not read by this tool; their layers and outline are in `get_pcb_metadata`.
- Text extent is not stored in the board (it depends on Allegro's font), so a text's extent is its anchor point.
- Hatch lines of hatched shapes are not listed; the shape's outline and voids are.
- Layer and subclass names are Allegro's own. Classes 23, 24, 25 and 27, whose names are not known, appear as `CLASS_23` and so on, and built-in subclasses with no known name by their code (`0xFB`).
