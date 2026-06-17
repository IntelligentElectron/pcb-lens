# Reading Cadence Allegro .brd Files Directly — Open-Source Parser Research

**Status:** Research / decision input · not yet scheduled
**Date:** 2026-06-17
**Goal:** Read Cadence Allegro `.brd` binary layout files *without* the Windows-only Cadence
toolchain (extracta / IPC-2581 export), extracting layout (traces, vias, pads, components,
placement), netlist/connectivity, design constraints/rules, and layer stackup — so the
pcb-lens MCP server can drop its current `export_cadence_*` dependency that shells out to
Allegro on Windows.

## Bottom line

There is exactly **one** mature, cross-platform, no-Cadence path to read the proprietary
`.brd` binary: **KiCad 10's native Allegro importer** (`pcb_io_allegro.cpp` / the `pcbnew`
`PCB_IO_MGR::ALLEGRO` plugin). It is fully reverse-engineered (no Cadence programs or
libraries), runs on macOS/Linux, and extracts layout, connectivity, padstacks, and
**physical constraint sets** (clearance, trace width, diff-pair gap → netclasses).

Two hard limits decide how we use it:

1. **Stackup gap.** The importer does **not** extract the dielectric stackup (per-layer
   material, Dk, thickness, copper weight) — only copper-layer *ordering*. For real stackup
   we still need an IPC-2581/extracta export (i.e. licensed Cadence). This is the #1 gap.
2. **License.** KiCad is **GPLv3+**; pcb-lens is **Apache-2.0** on npm. We therefore **cannot
   port or link** KiCad code in-process. The only clean route is to run KiCad as an **external
   process** (same separate-process boundary we already accept for the Cadence shell-out) and
   parse its open, text-based `.kicad_pcb` output.

Net: KiCad 10 lets us move *layout + connectivity + constraints* to a cross-platform,
no-Cadence path; **stackup stays on the Cadence/IPC-2581 path** until proven otherwise. A
hybrid pipeline is the realistic target.

## The one viable route: KiCad 10 `pcbnew` importer

| Property | Finding |
|---|---|
| What it is | `PCB_IO_ALLEGRO` (`pcb_io_allegro.cpp`): binary PARSER phase (`ALLEGRO::PARSER::Parse` → `BRD_DB`) then BOARD_BUILDER (`BuildBoard` → KiCad `BOARD`). A real implementation, not a stub. |
| Reverse-engineered | "reverse-engineered from the binary structure without using any Allegro programs or libraries" — no extracta, no IPC-2581, no Cadence runtime. |
| Format detection | `"all"` string at offset `0xF8`; fallback magic at offset 2 (`0x0013`=v16.x, `0x0014`=v17.x, `0x0015`=v18+) for files where Cadence `dbdoctor` overwrote the header. |
| Version coverage | Shipped C++ reads **v16 → v23** (seven major releases incl. the OrCAD X / 23.x rebrand). Dev-docs page conservatively says 16.0–17.5. **v17.2** introduced the biggest binary-layout change (many struct fields conditionally present around that boundary). |
| Availability | KiCad 10 (≈Feb–Apr 2026). `pcbnew` Python module + `kicad-cli` ship on Windows/macOS/Linux. |

### How to invoke headlessly (critical detail)

`kicad-cli pcb import` **does NOT support Allegro** in 10.0 — its `--format` list is
`pads, altium, eagle, cadstar, fabmaster, pcad, solidworks`. The GUI importer exists but was
not wired into the CLI for the 10.0 release.

The working headless path is the bundled **Python `pcbnew` API** (KiCad 10+ only; the
`ALLEGRO` enum is absent in 9.0):

```python
import pcbnew
board = pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.ALLEGRO, "design.brd")
pcbnew.PCB_IO_MGR.Save(pcbnew.PCB_IO_MGR.KICAD_SEXP, "design.kicad_pcb", board)
```

So the pipeline is: drive `pcbnew` as an external interpreter → emit `.kicad_pcb` (open
S-expression) → parse that in pcb-lens. This keeps GPL out of our codebase and gives us a
text format that is trivial to parse.

## What it extracts (vs. what still needs Cadence)

| Data pcb-lens needs | KiCad `pcbnew` (no Cadence) | Notes |
|---|---|---|
| Nets / connectivity | ✅ | NET blocks (`0x1B`) |
| Tracks / arcs (width + net) | ✅ | derived copper geometry |
| Vias | ✅ | padstack-defined drill (version-dependent: pre-V172 `m_Drill` vs V172+ `m_DrillArr`) |
| Padstacks / pad shapes / thermal relief | ✅ | circle, square, rect, oblong, rounded/chamfered rect, octagon, custom poly; `thermal_gap = (antipad.W − pad.W)/2` |
| Components / placement | ✅ | refdes, value, position, rotation (millidegrees), top/bottom layer |
| Board outline | ✅ | → `Edge.Cuts` |
| Copper zones | ✅ | from BOUNDARY-class shapes |
| Constraints (clearance, trace width, diff-pair gap) | ✅ | Physical Constraint Sets (`0x1D`) → KiCad **netclasses**; per-net width overrides; 2-net groups → diff-pair netclasses |
| **Layer stackup** (material / Dk / thickness / Cu weight) | ❌ | **not extracted** — "stackup" in KiCad docs means copper-layer *ordering* only |
| Per-pad solder/paste mask expansion | ❌ | not extracted |
| Schematic / footprint library | ❌ | board-only (`.brd`); several exotic pad shapes + ANTI_ETCH/SI models also skipped |

Caveat on constraints: constraint-set *names* can be synthetic on boards with unresolvable
string-table keys; the data lands as KiCad netclasses, not a standalone Allegro constraints
report.

## Dead ends (ruled out for a no-Cadence pipeline)

- **Cadence free viewers** (Allegro X Free Viewer / Free Physical Viewer): open `.brd` but are
  **Windows-only, read-only, zero export** (no IPC-2581/ODB++/Gerber/netlist). Useless for
  automation.
- **extracta / IPC-2581 / GENCAD export:** all require a **paid PCB Editor license** — exactly
  the dependency we are trying to remove. (`system76/kicad-allegro` is *not* a binary parser:
  it reads `!`-delimited CSVs that extracta already produced, so it still needs Cadence — but
  note those CSVs *do* carry full stackup/netlist/placement.)
- **OpenAllegroParser:** never implemented a `.brd` parser (only `.pad`); stalled 2022, now
  archived.
- **IPC-2581 free viewers** (WISE, Vu2581, ZofzPCB, PCB Preflight): consume IPC-2581 only;
  cannot read `.brd`.

## Licensing constraint (decisive)

pcb-lens is **Apache-2.0** and published to npm. KiCad is **GPLv3-or-later**. Copying or
porting KiCad's `.brd` logic into pcb-lens — or linking `pcbnew` in-process — makes pcb-lens a
GPL derivative. That is not acceptable for this project. What *is* clean:

- Invoke `pcbnew`/KiCad as a **separate external process** and consume the `.kicad_pcb` file
  (process boundary = aggregation, no copyleft propagation). This mirrors the existing
  Cadence shell-out model — we'd swap "Cadence on Windows" for "KiCad on any OS."
- Reimplementing a `.brd` parser from the reverse-engineered *format facts* (offsets, block
  types) is legally cleaner but a large effort and version-fragile; not recommended near-term.

Deployment cost: this requires a **KiCad 10 install present on the host** (for `pcbnew`),
which is heavier than bundling a small CLI. Treat KiCad as an external prerequisite rather
than vendoring it.

## Recommendation

1. **Adopt a hybrid pipeline.** Use KiCad 10 `pcbnew` (external process) for layout,
   connectivity, padstacks, and constraints cross-platform; keep the IPC-2581/Cadence path
   **only for stackup** until/unless stackup can be recovered another way.
2. **Smoke-test before committing.** The API surface is verified from docs, but no real
   conversion was run. Run `PCB_IO_MGR.Load(..., ALLEGRO, ...)` against real fixtures —
   ideally one pre-v17.2, one v17.2+, and one v22/v23 OrCAD X board — since the parser "may
   not cover every variation."
3. **Parse `.kicad_pcb`, not KiCad internals.** Add a `.kicad_pcb` S-expression reader to
   pcb-lens; do not link `pcbnew`.

## Open questions / next actions

- Does the imported `.kicad_pcb` retain **any** usable stackup (even copper-weight/thickness),
  or strictly copper-layer mapping? This gates whether stackup can ever leave the Cadence path.
- Is there an actively-maintained **standalone** (non-KiCad) Python/Rust/JS `.brd` library that
  wraps or reimplements KiCad's reverse-engineered logic, so we could avoid bundling the full
  KiCad toolchain?
- How robust is the importer on real **v22/v23 OrCAD X** boards in practice (fixture testing
  against our own designs)?
- Operationally: ship KiCad as a host prerequisite vs. container the converter as a sidecar?

## Sources

Primary-heavy: KiCad official dev-docs, blog, and source; the actual GitHub repos; Cadence's
own Free Viewer FAQ.

- KiCad Allegro import dev-docs: <https://dev-docs.kicad.org/en/import-formats/allegro/index.html>
- KiCad 10 importers announcement: <https://www.kicad.org/blog/2026/02/Three-New-Importers-in-KiCad-10-Allegro-PADS-and-gEDA/>
- `pcb_io_allegro.cpp` source: <https://docs.kicad.org/doxygen/pcb__io__allegro_8cpp_source.html>
- `kicad-cli` 10.0 reference (PCB import `--format` list): <https://docs.kicad.org/10.0/en/cli/cli.html>
- `PCB_IO_MGR` Python API (10.0, shows `ALLEGRO` enum): <https://docs.kicad.org/doxygen-python-10.0/classpcbnew_1_1PCB__IO__MGR.html>
- KiCad licenses (GPLv3+): <https://www.kicad.org/about/licenses/>
- system76/kicad-allegro (extracta-CSV, not binary): <https://github.com/system76/kicad-allegro>
- OpenAllegroParser (archived, .pad only): <https://github.com/Werni2A/OpenAllegroParser>
- Cadence Allegro X Free Viewer FAQ (read-only, no export): <https://resources.pcb.cadence.com/blog/allegro-x-free-viewer-faq>
- IPC-2581 free viewers: <https://www.ipc2581.com/free-viewer/>

> Research method: deep-research workflow — 97 agents, 15 sources fetched, 57 claims
> extracted, 25 adversarially verified (22 confirmed, 3 killed), plus a follow-up agent that
> verified the `kicad-cli` vs `pcbnew` headless-invocation path and the stackup gap directly
> against the KiCad 10 docs.
