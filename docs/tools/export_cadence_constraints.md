# export_cadence_constraints

Export a Cadence Allegro `.brd` file to `.tcfx` constraint XML.

## Description

Invokes the Cadence `techfile.exe` utility to export the constraint technology file from an Allegro board. The exported `.tcfx` file can then be queried with the `query_constraints` tool to inspect physical rules, spacing rules, net classes, and stackup definitions. Windows only; requires a Cadence SPB installation (auto-detected from `C:/Cadence`). Calls are serialized internally to avoid Cadence license conflicts.

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
  "error": "export_cadence_constraints requires Windows (current platform: darwin)"
}
```

**Missing Cadence installation:**
```json
{
  "error": "No Cadence SPB installation found in C:/Cadence"
}
```

## Notes

- Windows only; returns an error immediately on other platforms
- Auto-detects the Cadence SPB installation directory under `C:/Cadence`
- Validates the output file exists and is larger than 100 bytes after export
- The `log` field contains Cadence tool output when available
- Calls are serialized to prevent concurrent Cadence processes from conflicting over licenses
- The exported `.tcfx` file is a standard XML format; use `query_constraints` to inspect its contents
