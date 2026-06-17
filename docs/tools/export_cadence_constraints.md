# export_cadence_constraints

Export a Cadence Allegro `.brd` file to `.tcfx` constraint XML.

## Description

Invokes the Cadence `techfile.exe` utility to export the constraint technology file from an Allegro board. The exported `.tcfx` file can then be queried with the `get_constraints` tool to inspect physical rules, spacing rules, net classes, and stackup definitions. Windows only; requires a Cadence SPB installation (auto-detected from `C:/Cadence`). Calls are serialized internally to avoid Cadence license conflicts.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `board` | string | Yes | - | Path to Cadence Allegro `.brd` file |
| `output` | string | No | `<boardname>_constraints.tcfx` | Output `.tcfx` path |

## Response Schema

```typescript
interface ExportCadenceConstraintsResult {
  success: boolean;
  outputPath: string;
  cadenceVersion: string;
  log?: string;
}
```

## Examples

**Successful export:**

Call:
```json
{
  "tool": "export_cadence_constraints",
  "arguments": {
    "board": "C:/projects/ddr4_dimm/board.brd"
  }
}
```

Response:
```json
{
  "success": true,
  "outputPath": "C:/projects/ddr4_dimm/board_constraints.tcfx",
  "cadenceVersion": "17.4-2024"
}
```

**Non-Windows error:**
```json
{
  "error": "Cadence constraint export is only available on Windows. Requires a Windows environment with Cadence SPB installed."
}
```

**Missing Cadence installation:**
```json
{
  "error": "No Cadence SPB installation with techfile.exe found in C:/Cadence. Ensure Cadence Allegro/OrCAD PCB Editor is installed."
}
```

**Invalid input file (not a `.brd`):**
```json
{
  "error": "Expected a .brd file, got: 'board.dsn'"
}
```

**Board file not found:**
```json
{
  "error": "Board file not found: 'C:/projects/ddr4_dimm/board.brd'"
}
```

## Notes

- Windows only; returns an error immediately on other platforms
- Validates that `board` ends in `.brd` and that the file exists before invoking Cadence
- Auto-detects the highest-version Cadence SPB installation containing `techfile.exe` under `C:/Cadence`
- Validates the output file exists and is at least 100 bytes after export
- Reports a license error if the Cadence log contains `License checking failed`
- The `log` field contains Cadence tool output when available
- Calls are serialized to prevent concurrent Cadence processes from conflicting over licenses
- The exported `.tcfx` file is a standard XML format; use `get_constraints` to inspect its contents
