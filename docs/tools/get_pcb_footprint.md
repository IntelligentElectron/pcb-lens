# get_pcb_footprint

Look up footprint and padstack definitions of an Allegro `.brd` by name pattern.

## Description

A **footprint** (Allegro package symbol) is reported with its kind, the components placed with it, its pin count, the padstacks its pins use, its extent and its properties. `detail="full"` adds each pin's number, position, rotation and padstack in the footprint's own frame, and the footprint's template drawing (silkscreen, assembly outline, place bound, text) as [`get_pcb_layer`](get_pcb_layer.md) items in the footprint's frame.

A **padstack** is reported with its drill (a slot's smaller side), slot size, plating and type (`smd`, `through`, `blind/buried`, `mechanical`), the pad, antipad and thermal-relief figure on each copper layer of its span, the soldermask and pastemask openings, custom pad outlines and the drill symbol. Consecutive layers with the same figures are merged (`"TOP..BOTTOM"`).

[`get_pcb_component`](get_pcb_component.md) gives a component's footprint name (`packageRef`) and the padstacks its pads use.

Responses are token-bounded: at most 50 footprints and 50 padstacks, 50 refdes per footprint, and with `detail="full"` 300 pins and 300 drawing items per footprint (`truncated: true` when capped).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to an Allegro `.brd` file (Allegro 16.0 to 25.1) |
| `pattern` | string | Yes | - | Case-insensitive regex on footprint and padstack names (e.g. `'^SOIC'`, `'QFN48'`, `'VIA'`) |
| `detail` | `"summary"` \| `"full"` | No | `"summary"` | `full` adds footprint pins and template drawing |

## Response Schema

```typescript
interface FootprintQueryResult {
  fileName: string;
  units: "MICRON";
  footprints: Footprint[];
  padstacks: Padstack[];
  truncated?: boolean;
}

interface Footprint {
  name: string;
  kind: number;              // 1 package symbol; 2 mechanical, 3 format, 4 shape, 7 flash (unconfirmed)
  refdes: string[];          // components placed with it
  placements: number;        // placed instances, with or without a refdes
  pinCount: number;
  padstacks: string[];       // padstacks its pins use
  extent?: { minX: number; minY: number; maxX: number; maxY: number }; // footprint frame
  properties?: Record<string, string>;
  pins?: Array<{ number: string; x: number; y: number; rotation: number; padstack?: string }>; // full only
  items?: BrdItem[];         // full only: template drawing, footprint frame (see get_pcb_layer)
}

interface Padstack {
  name: string;
  drill: number;             // 0 for no hole
  slot?: { width: number; height: number };
  plated?: boolean;          // drilled padstacks only
  type: "smd" | "through" | "blind/buried" | "mechanical";
  layers: Array<{ layer: string; pad?: PadFigure; antipad?: PadFigure; thermal?: PadFigure }>;
  soldermaskTop?: PadFigure;
  soldermaskBottom?: PadFigure;
  pastemaskTop?: PadFigure;
  pastemaskBottom?: PadFigure;
  drillSymbol?: { figure: number; width: number; height: number; text?: string };
  properties?: Record<string, string>;
}

interface PadFigure {
  shape: string;             // circle, square, rectangle, oblong, octagon, rounded-rectangle, chamfered-rectangle, donut, custom, flash
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
  radius?: number;           // corner radius, chamfer, or a donut's inner diameter
  corners?: number;          // rounded or chamfered corners: bit 0 lower left, 1 lower right, 2 upper right, 3 upper left
  outline?: OutlineContour[]; // custom and flash figures, in the pad's frame
}
```

## Example

```json
{
  "fileName": "board.brd",
  "units": "MICRON",
  "footprints": [],
  "padstacks": [
    {
      "name": "60S32D",
      "drill": 889,
      "type": "through",
      "plated": true,
      "layers": [
        {
          "layer": "TOP..BOTTOM",
          "pad": { "shape": "square", "width": 1524, "height": 1524 },
          "antipad": { "shape": "square", "width": 2032, "height": 2032 },
          "thermal": { "shape": "rectangle", "width": 2642, "height": 2642 }
        }
      ],
      "soldermaskTop": { "shape": "square", "width": 1676, "height": 1676 },
      "soldermaskBottom": { "shape": "square", "width": 1676, "height": 1676 },
      "drillSymbol": { "figure": 16, "width": 889, "height": 889 }
    }
  ]
}
```

## Notes

- IPC-2581 files are not read by this tool; `get_pcb_component` reports their pads.
- For 16.x boards only the per-layer pad, antipad and thermal figures are read (no masks, offsets, slot, plating or drill symbol), and footprint pins come from a placed instance, so a footprint nothing is placed with has none.
- The padstack figures, drills and plating equal the board's IPC-2581 export on the boards checked (see the [format notes](../allegro-brd-format.md)).
