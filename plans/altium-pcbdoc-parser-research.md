# Reading Altium PcbDoc Files — Open-Source Parser Research

**Status:** Research / not yet scheduled
**Date:** 2026-06-17
**Goal:** Extract everything from Altium PCB layout files (copper/routing, layer stackup,
design rules/constraints, nets, components/footprints, vias, polygons) programmatically,
analogous to how pcb-lens parses IPC-2581 XML today.

## Bottom line

**No existing JavaScript/TypeScript library reads Altium PcbDoc PCB data.** Unlike IPC-2581
(an open XML schema parsed directly), a PcbDoc reader is a two-layer build:

1. **Outer layer (solved in JS).** Every Altium binary file (`.PcbDoc`, `.PcbLib`, `.SchDoc`,
   `.SchLib`) is a Microsoft OLE / Compound File Binary (CFB) container — magic
   `D0 CF 11 E0 A1 B1 1A E1`, FAT/MiniFAT sector tables, and a directory tree of named
   storages/streams. A JS CFB library handles this.
2. **Inner layer (must be ported/reverse-engineered).** Inside are named storages —
   `Board6`, `Nets6`, `Components6`, `Rules6`, `Polygons6`, `Vias6`, `Tracks6`, `Arcs6`,
   `Pads6`, etc. — each usually a `Header` stream (record count) plus a `Data` stream. The
   per-record binary/text layouts are reverse-engineered (undocumented by Altium) and must be
   ported from an existing parser.

## Reference parsers (ranked by usefulness to pcb-lens)

| Tool | Lang | License | PcbDoc coverage | Notes |
|---|---|---|---|---|
| **KiCad `altium_pcb.cpp`** | C++ | **GPLv3** | Board/stackup, Components, Nets, Rules, Polygons, Vias, Tracks, Pads, Arcs, Fills, Regions, Classes | Most complete + actively maintained. **GPLv3 — cannot be copied or ported into Apache-2.0 pcb-lens.** Usable only as a black-box behavioral reference. |
| **AltiumSharp** (`OriginalCircuit.Altium`) | C#/.NET | **unverified — must confirm** | Read+write all 4 doc types; layout primitives, per-net copper, board outline, layer stack, design rules | Cleanest library-shaped port source **if** its license is permissive. |
| **AtoK** (stevegrn) | C#/.NET | GPLv3 | PcbDoc-only via OpenMCDF; Nets/Tracks/Vias/Pads/Polygons/Rules/Dimensions/DiffPairs/Classes/Models | GPLv3 — reference only, not portable. |
| **altium2kicad** (thesourcerer8) | Perl | n/a | unpack→convert PcbDoc+SchDoc; `unpack.pl` is a clean CDF decomposer | Old/low-activity. Rule-extraction extent uncertain (verification vote split). |
| **pluots/altium** | Rust | Apache-2.0 | **Cannot read PcbDoc/PcbLib today** (alpha; SchDoc/SchLib partial) | Not usable now; 0.2.0 rewrite in progress as of Feb 2026. |
| **vadmium/python-altium** | Python | n/a | **SchDoc only** — canonical schematic spec, zero PCB | Inner-record encoding reference for schematic files only. |

**PrjPcb project files are essentially unsupported across all surveyed tools.**

## Licensing constraint (decisive)

pcb-lens is **Apache-2.0** and published to npm, so **GPLv3 sources cannot be copied or
ported** — translating C++→TS is a derivative work and the copyleft travels with the logic,
not the syntax. This rules out reusing KiCad's `altium_pcb.cpp` or AtoK as code.

What is legal:
- Use KiCad/AtoK as a **black-box behavioral reference** — rule names (`CLEARANCE`, `WIDTH`,
  `HOLE_TO_HOLE_CLEARANCE`, ...), stream dispatch order
  (`BOARD6 → COMPONENTS6 → NETS6 → RULES6 → POLYGONS6 → VIAS6 → TRACKS6`), units. The file
  format structure and these facts are not copyrightable.
- Run KiCad as an external CLI tool (no source incorporation) — heavy, undesirable for an MCP server.

The clean route is therefore: **port from AltiumSharp if its license is permissive**;
otherwise reverse-engineer the record formats from the format facts directly.

## Recommended implementation path

1. **Outer container:** use **`js-cfb`** (SheetJS). Verified API: `CFB.read(...)`,
   `CFB.find(cfb, path)` → entry whose `.content` is the raw stream `Buffer`;
   `FullPaths`/`FileIndex` enumerate the directory. That is the mechanism to pull each named
   record stream out of a PcbDoc. Alternative: generate a CFB parser from the **Kaitai Struct**
   `.ksy` (it has a JS target) — but do **not** assume a maintained npm Kaitai CFB package
   exists (that claim was refuted); generate it yourself or just use `js-cfb`.
2. **Inner records:** port stream-by-stream. Each `Data` stream is a sequence of records
   (typically a `uint8` type tag + length-prefixed subrecords). Prioritize what mirrors the
   IPC-2581 tools: `Board6` (stackup/layers), `Nets6`, `Components6`, `Rules6` (constraints),
   then routing primitives `Tracks6`/`Arcs6`/`Vias6`/`Pads6`/`Polygons6`/`Regions6`.
3. **Resolve the license fork first** (see Open questions) — it determines whether step 2 is a
   port or a from-scratch reverse-engineering effort.

## Caveats

- **Not lossless.** Even KiCad maps Altium rules into its own model (e.g. `HOLE_SIZE`
  placeholdered) rather than preserving verbatim. Full-fidelity constraint extraction
  comparable to the IPC-2581 path will need a more complete `Rules6` parse than any converter does.
- **Format drift.** Inner record layouts are reverse-engineered and can change across Altium
  Designer versions; none of these parsers guarantee version-stable extraction. Plan for
  version-tolerant parsing and multi-version test fixtures.
- **Verification gaps.** The research run hit API rate-limiting during the verify phase, so
  several JS/npm-packaging convenience claims (`cfb`/`js-cfb` npm specifics, Kaitai npm
  readiness) were abstained/refuted rather than confirmed. The core facts below
  (js-cfb type API, CFB-as-container, the C#/C++ parser coverage) are solid (3-0 / 2-0); treat
  npm-packaging specifics as "verify at install time."

## Open questions / next actions

- **Confirm AltiumSharp / `OriginalCircuit.Altium` license.** This is the gating decision: a
  permissive license makes it the port source; otherwise reverse-engineer from format facts.
- How stable are Altium's inner binary record formats across Altium Designer versions, and which
  versions are the surveyed parsers validated against?
- Does any tool extract the complete design-rule/constraint set **verbatim** (not mapped into
  another EDA tool's model) so it can be exported analogously to pcb-lens's IPC-2581 constraints?
- Prototype: open a real `.PcbDoc` with `js-cfb` and dump its storage/stream tree to confirm the
  actual `*6` streams before committing to a port source.

## Sources

- KiCad importer: <https://docs.kicad.org/doxygen/altium__pcb_8cpp_source.html>
  (source: `gitlab.com/kicad/code/kicad`, `pcbnew/pcb_io/altium/`)
- AltiumSharp: <https://github.com/issus/AltiumSharp>
- AtoK: <https://github.com/stevegrn/AtoK>
- altium2kicad: <https://github.com/thesourcerer8/altium2kicad>
- python-altium SchDoc spec: <https://github.com/vadmium/python-altium/blob/master/format.md>
- pluots/altium (Rust): <https://github.com/pluots/altium>
- js-cfb: <https://github.com/SheetJS/js-cfb>
- Kaitai CFB (JS): <https://formats.kaitai.io/microsoft_cfb/javascript.html>
- pyaltiumlib file structure: <https://pyaltiumlib.readthedocs.io/latest/fileformat/FileStructure.html>
- CFB format (Wikipedia): <https://en.wikipedia.org/wiki/Compound_File_Binary_Format>
