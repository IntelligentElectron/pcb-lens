# export_cadence_board

Export a Cadence Allegro `.brd` file to IPC-2581 XML.

## Description

Invokes the Cadence `ipc2581_out.exe` utility to convert an Allegro board file into IPC-2581 XML format. The exported file can then be analyzed by the other pcb-lens tools (`get_design_overview`, `query_components`, `query_net`). Windows only; requires a Cadence SPB installation (auto-detected from `C:/Cadence`). Calls are serialized internally to avoid Cadence license conflicts.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `board` | string | Yes | - | Path to Cadence Allegro `.brd` file |
| `output` | string | No | `<boardname>_ipc2581.xml` | Output path (without `.xml` extension; Cadence appends it) |
| `revision` | `"B"` \| `"C"` | No | `"C"` | IPC-2581 revision: `"B"` (1.03) or `"C"` (1.04) |

## Response Schema

```typescript
interface ExportCadenceBoardResult {
  success: boolean;
  outputPath: string;
  revision: "B" | "C";
  cadenceVersion: string;
  log?: string;
}
```

## Examples

**Successful export:**

Call:
```json
{
  "tool": "export_cadence_board",
  "arguments": {
    "board": "C:/projects/ddr4_dimm/board.brd"
  }
}
```

Response:
```json
{
  "success": true,
  "outputPath": "C:/projects/ddr4_dimm/board_ipc2581.xml",
  "revision": "C",
  "cadenceVersion": "17.4-2024"
}
```

**Non-Windows error:**
```json
{
  "error": "export_cadence_board requires Windows (current platform: darwin)"
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
- Validates the output file exists and is larger than 1KB after export
- The `log` field contains Cadence tool output when available (useful for diagnosing export issues)
- Calls are serialized to prevent concurrent Cadence processes from conflicting over licenses
- Revision `"C"` (IPC-2581 1.04) is the default and recommended; use `"B"` only for tools that require the older format
