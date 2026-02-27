# Cadence Allegro IPC-2581 Batch Export — Complete Reference

> **Purpose**: Everything needed to build a custom IPC-2581 extraction tool that wraps
> Cadence's `ipc2581_out.exe` for batch/automated export of `.brd` files.
>
> **Tested on**: Cadence SPB 23.1 (Software Version `23.1-S011`), Windows 10/11,
> example project — Main Board and Auxiliary Board designs.

---

## 1. Executable Location

```
C:\Cadence\SPB_23.1\tools\bin\ipc2581_out.exe
```

There is also an **import** tool (IPC-2581 → board):
```
C:\Cadence\SPB_23.1\tools\bin\ipc2581_in.exe
```

> **Note**: Older documentation and some forums reference `ipc2581gen.exe` — this does NOT
> exist in SPB 23.1. The correct executable name is `ipc2581_out.exe`.

---

## 2. Command Syntax

```
ipc2581_out.exe [flags] [-o <output_file>] <input.brd>
```

The `<input.brd>` (board file path) is the **only required argument**. Everything else is optional.

---

## 3. Complete Flag Reference (SPB 23.1)

### Output Control

| Flag | Description | Default |
|------|-------------|---------|
| `-o <file>` | Output file path (without extension — `.xml` is appended automatically) | `<boardname>_ipc2581` |
| `-u <unit>` | Output units: `INCH`, `MILLIMETER`, `MICRON` | Board's native unit |
| `-f <ver>` | IPC-2581 revision: `1.00`, `1.01` (Amendment 1), `1.02` (IPC2581-A), `1.03` (IPC2581-B), `1.04` (IPC2581-C) | `1.03` (Rev B) |
| `-z` | Compress output to `.zip` alongside `.xml` | off |
| `-e` | Export text as vector line segments | off |
| `-s <name>` | Source tool identifier string | `"CadenceTool"` |
| `-P <orient>` | Global package pin1 orientation: `LOWER_LEFT`, `LEFT`, `LEFT_CENTER`, `UPPER_LEFT`, `UPPER_CENTER`, `UPPER_RIGHT`, `RIGHT`, `RIGHT_CENTER`, `LOWER_RIGHT`, `LOWER_CENTER`, `CENTER`, `OTHER` | `OTHER` |

### Content Selection — Rev B Flags (work on both Rev B and Rev C)

| Flag | Content | Default |
|------|---------|---------|
| `-d` | Device descriptions | off |
| `-b` | Bill of Materials (BOM) | off |
| `-l` | Layer stackup / cross-section | off |
| `-R` | Regular drill layers | off |
| `-K` | Backdrill layers | off |
| `-n` | Logical AND Physical netlist (combined) | off |
| `-p` | Component packages | off |
| `-t` | Device land patterns | off |
| `-c` | Component assembly | off |
| `-k` | Padstack definitions | off |
| `-v` | Cavities (embedded component boards) | off |
| `-O` | Outer copper layers | off |
| `-I` | Inner copper layers | off |
| `-D` | Documentation layers | off |
| `-M` | Miscellaneous fab layers | off |
| `-S` | SolderMask + SolderPaste + Legend layers (combined) | off |

### Content Selection — Rev C Specific Flags (only meaningful with `-f 1.04`)

| Flag | Content | Notes |
|------|---------|-------|
| `-G` | Logical netlist only | Replaces `-n` for granular control |
| `-Y` | Physical netlist only | Replaces `-n` for granular control |
| `-A` | Solder Mask layers only | Replaces `-S` for granular control |
| `-B` | Solder Paste layers only | Replaces `-S` for granular control |
| `-C` | Silkscreen (Legend) layers only | Replaces `-S` for granular control |
| `-U` | Profile / Outline | Rev C only |
| `-y` | Cross-section data only (stackup without geometry) | |

### Property / Config File Flags

| Flag | Description |
|------|-------------|
| `-q` | Export default properties (`Component/LOGICAL_PATH`, `Component/PRIM_FILE`, `Net/LOGICAL_PATH`) |
| `-g <file>` | Property configuration file (custom component/net attributes to export) |
| `-x <file>` | Layer mapping configuration file (maps artwork film names → IPC layer categories) |

---

## 4. Recommended Command Lines

### Rev B — Full Export (Fabrication + Assembly)

```powershell
ipc2581_out.exe <board.brd> -o <output> -f 1.03 -u MICRON -d -b -l -R -K -n -p -t -c -O -I -D -M -S -k -e
```

### Rev C — Full Export (All Granular Flags)

```powershell
ipc2581_out.exe <board.brd> -o <output> -f 1.04 -u MICRON -d -b -l -R -K -G -Y -p -t -c -O -I -D -M -A -B -C -U -k -e
```

> **Tip**: Add `-z` to any command above to also produce a compressed `.zip` alongside the
> `.xml`. Generally not needed — the XML alone is sufficient for downstream consumption.

### Stackup / Cross-Section Only

```powershell
ipc2581_out.exe <board.brd> -o <output> -y -u MILLIMETER
```

### Netlist + Packages + Components Only

```powershell
ipc2581_out.exe <board.brd> -o <output> -n -p -c -u MILLIMETER
```

### Minimal (Board Only, No Content)

```powershell
ipc2581_out.exe <board.brd> -o <output>
```

This produces a valid XML with just the header/structure — **4.5 KB**, basically empty. Useful only for verifying the tool runs.

---

## 5. Tested Behaviors & Edge Cases

### 5.1 `-f` Flag: Numeric vs Letter

| Input | Result | Notes |
|-------|--------|-------|
| `-f 1.03` | Rev B ✅ | Canonical form from help text |
| `-f 1.04` | Rev C ✅ | Canonical form from help text |
| `-f C` | ⚠️ Falls back to Rev B | Did NOT produce Rev C in testing — use `1.04` |
| `-f B` | Not tested | Use `1.03` to be safe |
| (omitted) | Rev B (default `1.03`) | |

> **IMPORTANT**: Always use the **numeric** form (`1.03`, `1.04`) not the letter form. The
> `-f C` variant did NOT reliably produce Rev C output in our SPB 23.1S011 testing — it
> silently fell back to Rev B.

### 5.2 `-S` vs `-A -B -C` on Rev C

When using `-f 1.04` (Rev C):
- **`-S` does NOT enable SolderMask/SolderPaste/Silkscreen**. The output shows all three as `NO`.
- **`-A -B -C` correctly enables** Solder Mask, Solder Paste, and Silkscreen separately.
- On Rev B (`-f 1.03`), `-S` works correctly as a combined flag.

> **CRITICAL**: When targeting Rev C, always use `-A -B -C` instead of `-S`.

### 5.3 `-n` vs `-G -Y` on Rev C

| Flags | Rev B Label | Rev C Label | Behavior |
|-------|-------------|-------------|----------|
| `-n` | `Export net list?: YES` | `Export logical net list?: YES` + `Export physical net list?: YES` | Works on both, but Rev C output auto-splits |
| `-G -Y` | N/A (Rev C only) | `Export logical net list?: YES` + `Export physical net list?: YES` | Same result as `-n` on Rev C |
| `-n -G -Y` | N/A | Same as `-G -Y` | No conflict — `-n` is effectively ignored when `-G`/`-Y` present |

> `-n` works fine on Rev C — it enables both logical and physical. Use `-G`/`-Y` only if
> you need to export just one type of netlist.

### 5.4 Rev B vs Rev C XML Structural Differences

Tested on `EXAMPLE-001_MAIN_BOARD.brd` with all content flags:

| Metric | Rev B | Rev C |
|--------|-------|-------|
| XML root attribute | `revision="B"` | `revision="C"` |
| Total XML lines | 2,157 | 2,502 |
| LayerRef count | 12 | 16 (adds solder paste, silkscreen, outline) |
| StackupGroup elements | 1 (`GROUP_RIGID`) | 2 (`GROUP_RIGID` + `GROUP_FLEX`) |
| File size (full export) | 101.9 KB | 121.1 KB |
| Components | 7 | 7 |
| Packages | 3 | 3 |
| BomItems | 3 | 3 |
| Padstacks | 19 | 19 |

Rev C adds:
- **`GROUP_FLEX` stackup group** (important for rigid-flex boards)
- **Design profile/outline** (with `-U` flag)
- **Separate layer categories** for solder mask, solder paste, silkscreen
- **Zone definitions** (collected during export, shown in log)

### 5.5 Minimal Export (No Content Flags)

Running with no content flags produces a valid but nearly empty XML (**4.5 KB**). All `Export X?: NO`. This can be used as a "dry run" to verify licensing and board file access.

### 5.6 Cross-Section Only (`-y`)

Produces a **16.8 KB** file containing only the stackup/layer hierarchy data. No geometry, no components. Useful for stackup extraction without the overhead of full copper export.

### 5.7 Output File Sizes by Config

| Configuration | Size |
|---------------|------|
| Minimal (no flags) | 4.5 KB |
| Cross-section only (`-y`) | 16.8 KB |
| Netlist only (`-n`) | 34.2 KB |
| Netlist separate (`-G -Y`) | 37.2 KB |
| Copper + netlist + packages (`-n -p -c -O -I`) | 65.0 KB |
| Rev B full | 101.9 KB |
| Rev C full | 121.1 KB |
| Rev C full zipped | 9.0 KB |
| Auxiliary Board Rev C full | 219.5 KB |
| Auxiliary Board Rev C full zipped | 12.3 KB |

---

## 6. Licensing Requirements

### Required License Feature

`ipc2581_out.exe` checks out a license on startup. In our environment, it tried:
1. `Allegro_performance` — **failed** (not available on our server)
2. Falls back to a lower-tier Allegro feature — **succeeded**

The license check failure is logged as:
```
ERROR (LMF-10025): License call failed for feature Allegro_performance, version 23.100
FLEXnet ERROR(-25, 234, 0): License server system does not support this version of this feature.
```

Despite this error, the tool **still runs** and completes the export. The only consequence
observed was that `-f C` silently fell back to Rev B. Using `-f 1.04` explicitly **does**
produce Rev C even without `Allegro_performance`.

### License Server Configuration

Environment variable: `CDS_LIC_FILE`

```
CDS_LIC_FILE=1700@license-server-01.example.com,1700@license-server-02.example.com,1700@license-server-03.example.com
```

This must be set at the **System** level (not User level) for `ipc2581_out.exe` to find it.

### VPN Requirement

The license servers are on the corporate network. **VPN must be connected** or the export will
fail immediately with:
```
ERROR: License checking failed. Terminating program.
```

You can pre-check connectivity with:
```powershell
Test-NetConnection -ComputerName license-server-01.example.com -Port 1700
```

---

## 7. Log File Behavior

- **Location**: Written to the **current working directory** (not the board directory, not the output directory).
- **Filename**: `ipc2581_out.log`
- **Overwritten**: Each run overwrites the previous log.
- **Success indicator**: Log ends with the full parameter dump and `a2ipc2581 complete.`
- **Failure indicator**: `ERROR: License checking failed. Terminating program.`

### Log File Structure (Successful Run)

```
(---------------------------------------------------------------------)
(    IPC2581 Export                                                   )
(    Software Version : 23.1S011                                      )
(    Date/Time        : Thu Feb 19 10:40:25 2026                      )
(---------------------------------------------------------------------)
Collecting zone defintions ...
Collecting net list ...
Collecting padstack defintions ...
Collecting package defintions ...
WARNING:  Multiple PLACE_BOUND outlines defined for the package "...".
  An overall bounding box has been exported.
Collecting component descriptions ...
Collecting BOM items ...
Property configuration file:
IPC2581 file: <output_path>
IPC2581 version: IPC2581-C
BRD file: <input_path>
IPC2581 units: MICRON
[... full parameter dump ...]
a2ipc2581 complete.
```

---

## 8. Known Warnings

| Warning | Cause | Severity |
|---------|-------|----------|
| `Multiple PLACE_BOUND outlines defined for the package "..."` | Package has overlapping placement bounds in the library | Non-blocking. Tool exports a bounding box instead. |
| `ERROR (LMF-10025): License call failed for feature Allegro_performance` | License tier doesn't include `Allegro_performance` | Non-blocking. Tool continues with fallback license. |

---

## 9. Configuration Files

### Layer Mapping Config (`-x` flag)

Located at: `C:\Cadence\SPB_23.1\share\pcb\text\IPC2581_LayerMappingCfg.txt`

Format:
```
# FILM NAME,       IPC LAYER CATEGORY
TOP,           OUTER_COPPER_LAYERS
BOTTOM,        OUTER_COPPER_LAYERS
INNER1,        INNER_COPPER_LAYERS
INNER2,        INNER_COPPER_LAYERS
GND,           INNER_COPPER_LAYERS
POWER,         INNER_COPPER_LAYERS
SS_TOP,        SILKSCREEN_LEGEND_LAYERS
SS_BOT,        SILKSCREEN_LEGEND_LAYERS
PASTE_TOP,     SOLDERPASTE_LAYERS
PASTE_BOT,     SOLDERPASTE_LAYERS
SM_TOP,        SOLDERMASK_LAYERS
SM_BOT,        SOLDERMASK_LAYERS
ASY_TOP,       MISCELLANEOUS_FAB_LAYERS
ASY_BOT,       MISCELLANEOUS_FAB_LAYERS
FAB_PTH,       DOCUMENTATION_LAYERS
#END
```

Valid IPC layer categories:
- `OUTER_COPPER_LAYERS`
- `INNER_COPPER_LAYERS`
- `DOCUMENTATION_LAYERS`
- `SOLDERMASK_LAYERS`
- `SOLDERPASTE_LAYERS`
- `SILKSCREEN_LEGEND_LAYERS`
- `MISCELLANEOUS_FAB_LAYERS`

### User Data Config

Located at: `C:\Cadence\SPB_23.1\share\pcb\text\IPC2581_UserData.txt`

Contains LogisticHeader fields (company info, person contact, revision history) that get
embedded in the XML. Format is `Key = Value`. All empty by default.

### Property Config (`-g` flag)

Custom ASCII text file listing component/net properties to export:
```
Component/DFA_DEV_CLASS_UD
Component/DFA_DEV_TYPE
Net/DIFFP_PHASE_TOL_DYNAMIC
Net/MAX_VIA_COUNT
```

---

## 10. XML Output Structure

### Root Element
```xml
<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema">
```

### Major Sections (in order)
1. `<Content>` — References to steps, layers, BOM, color/line/fill dictionaries
2. `<LogisticHeader>` — Company/person metadata (from UserData config)
3. `<HistoryRecord>` — Revision history
4. `<Bom>` — Bill of Materials with `<BomItem>` elements
5. `<Ecad>` — The main design data container
   - `<CadHeader>` — Units, spec info
   - `<CadData>` — Layer definitions, stackup groups, padstacks, packages
   - `<Step>` — Component placement, copper geometry, drill data

### Key XML Elements for Parsing

```xml
<!-- BOM Item -->
<BomItem OEMDesignNumberRef="100-00001-00" quantity="1" pinCount="50" category="ELECTRICAL">

<!-- Stackup Groups (Rev C adds GROUP_FLEX for rigid-flex) -->
<StackupGroup name="GROUP_RIGID" thickness="300.0" tolPlus="0.0" tolMinus="0.0">
<StackupGroup name="GROUP_FLEX" thickness="206.0" tolPlus="0.0" tolMinus="0.0">

<!-- Layer References -->
<LayerRef name="TOP"/>
<LayerRef name="L2"/>
<LayerRef name="BOTTOM"/>
<LayerRef name="SOLDER_MASK_TOP"/>
<LayerRef name="DRILL_1-2"/>
```

---

## 11. Automation Considerations

### Pre-Flight Checks (Before Running)

1. **VPN connected**: `Test-NetConnection -ComputerName license-server-01.example.com -Port 1700`
2. **CDS_LIC_FILE set**: `$env:CDS_LIC_FILE` should return license server string
3. **Exe exists**: `Test-Path "C:\Cadence\SPB_23.1\tools\bin\ipc2581_out.exe"`
4. **Board file exists**: `Test-Path $boardPath`
5. **Output directory exists**: Create if needed

### Parsing Success/Failure

- **stdout**: The tool prints progress and the full parameter summary to stdout.
- **Log file**: Written to CWD as `ipc2581_out.log`.
- **Success string**: stdout contains `a2ipc2581 complete.`
- **Exit code**: Not reliable for error detection — use string matching instead.
- **License warning**: Contains `ERROR (LMF-10025)` but is NOT a fatal error.
- **Fatal license error**: Contains `ERROR: License checking failed. Terminating program.`

### Recommended Validation After Export

```powershell
# Check file was created and has content
$xml = Get-Item "$outputPath.xml" -ErrorAction SilentlyContinue
if ($xml -and $xml.Length -gt 10KB) {
    # Check XML root for correct revision
    $firstLine = Get-Content "$outputPath.xml" -TotalCount 2 | Select-Object -Last 1
    if ($firstLine -match 'revision="C"') { "Rev C export confirmed" }
}
```

### Working Directory Matters

The log file is written to **wherever you invoke the command from**, not alongside the board
or output. If automating, consider `cd` to a known log directory first, or just ignore the
log and parse stdout.

### Parallel Execution

Multiple instances can run in parallel (different board files). Each checks out its own
license seat. Monitor license seat availability if running many boards concurrently.

---

## 12. Board Files Tested

| Board | Path | Rev B Size | Rev C Size |
|-------|------|------------|------------|
| Main Board | `...\MyProject\PCB\EXAMPLE-001_MAIN_BOARD.brd` | 101.9 KB | 121.1 KB |
| Auxiliary Board | `...\MyProject\PCB\EXAMPLE-002_AUX_BOARD.brd` | — | 219.5 KB |

---

## 13. Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `CDS_LIC_FILE` | `1700@license-server-01.example.com,...` | License server(s) |
| `CDSROOT` | `C:\Cadence\SPB_23.1` | Cadence install root (for config file paths) |
| `PATH` | Should include `C:\Cadence\SPB_23.1\tools\bin` | So `ipc2581_out.exe` is found without full path |

---

## 14. Quick-Start Code Snippet (PowerShell)

```powershell
$cadenceExe = "C:\Cadence\SPB_23.1\tools\bin\ipc2581_out.exe"
$boardFile  = "C:\path\to\design.brd"
$outputFile = "C:\path\to\output\design_ipc2581"  # no .xml extension

# Pre-flight
if (-not (Test-NetConnection license-server-01.example.com -Port 1700 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    throw "License server unreachable — check VPN"
}

# Rev C full export
$args = @(
    $boardFile,
    "-o", $outputFile,
    "-f", "1.04",
    "-u", "MICRON",
    "-d", "-b", "-l", "-R", "-K",
    "-G", "-Y",
    "-p", "-t", "-c",
    "-O", "-I", "-D", "-M",
    "-A", "-B", "-C", "-U",
    "-k", "-e"
)
# Optional: add "-z" to the args above to also produce a .zip archive

$result = & $cadenceExe @args 2>&1 | Out-String

if ($result -match "a2ipc2581 complete") {
    Write-Host "Export succeeded: $outputFile.xml"
} elseif ($result -match "License checking failed. Terminating") {
    throw "License checkout failed — VPN connected?"
} else {
    Write-Warning "Unexpected output: $result"
}
```
