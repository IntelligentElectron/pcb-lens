# get_pcb_drc

Report the DRC markers an Allegro `.brd` holds and its DRC check settings.

## Description

Allegro leaves a marker in the board for every violation its last DRC run found. This tool counts them by check (Constraint Manager's name, such as `LINE_TO_LINE_SPACING` or `PACKAGE_PACKAGE`) and reports how many checks the board has on, off and in batch mode. With `detail="full"` it adds each marker's position, layer, constraint set and the two objects in conflict, and the list of checks that are on.

Markers are derived data: they reflect the board as it was at its last DRC run, not edits made since.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to an Allegro `.brd` file (Allegro 17.2 to 25.1) |
| `check` | string | No | - | Only checks whose name matches this case-insensitive regex (e.g. `'SPACING'`); also filters `checksOn` |
| `detail` | `"summary"` \| `"full"` | No | `"summary"` | `full` adds each marker (capped to 300, sampled across checks) and the checks that are on |

## Response Schema

```typescript
interface DrcQueryResult {
  fileName: string;
  units: "MICRON";
  markerCount: number;
  byCheck: Array<{ check: string; count: number }>; // most first
  checkStates: { on: number; off: number; batch: number };
  markers?: DrcMarker[];   // detail="full"
  checksOn?: string[];     // detail="full": checks on or in batch mode
  truncated?: boolean;
}

interface DrcMarker {
  check: string;           // Constraint Manager name, or the code (e.g. "0x259") when its name is not known
  layer?: string;
  x: number;
  y: number;
  x2?: number;             // a second point, when it differs
  y2?: number;
  constraintSet?: string;
  objects: string[];       // e.g. "U5.A3", "via on GND", "track on CLK (TOP)", "shape of J11 (PACKAGE_GEOMETRY/PLACE_BOUND_TOP)"
}
```

## Example

```json
{
  "fileName": "board.brd",
  "units": "MICRON",
  "markerCount": 367,
  "byCheck": [{ "check": "PACKAGE_PACKAGE", "count": 367 }],
  "checkStates": { "on": 75, "off": 975, "batch": 0 }
}
```

## Notes

- Boards written before Allegro 17.2 report no markers and no check states.
- A marker on a DRC layer with no known name shows the layer's code (e.g. `0xFC`).
