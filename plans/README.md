# Plans

Research notes, design docs, and decision inputs for pcb-lens. Each entry is a living
document; status reflects where the work stands as of the last edit.

| Plan | Topic | Status |
|---|---|---|
| [allegro-brd-direct-read.md](allegro-brd-direct-read.md) | Read Cadence Allegro `.brd` binaries without the Windows/Cadence toolchain. KiCad 10's `pcbnew` importer is the one viable cross-platform path (layout + connectivity + constraints), invoked as an external process via the Python API (not `kicad-cli`); **stackup is not extracted** and stays on the IPC-2581/Cadence path. GPLv3 → separate-process boundary only. | Research |
| [altium-pcbdoc-parser-research.md](altium-pcbdoc-parser-research.md) | Read Altium `.PcbDoc` files: OLE/CFB container (solved in JS via `js-cfb`) wrapping reverse-engineered `*6` record streams. No JS/TS reader exists; port source gated on AltiumSharp's license (KiCad/AtoK are GPLv3, reference-only). | Research |
| [odbpp-parser-research.md](odbpp-parser-research.md) | Read ODB++ exports: data coverage is strong (stackup, netlist, geometry, constraints), but the gate is **licensing** — recommend a focused native TS parser against the free v8.1 spec rather than the AGPL `OdbDesign` core. | Research |
| [ipc2581-layout-review.md](ipc2581-layout-review.md) | Original prototype plan: validate that IPC-2581 RevC XML is navigable enough for LLM-driven layout review with thin extraction tooling. The basis of the current pcb-lens tools. | Reference |

## Conventions

- One file per plan, kebab-case where practical.
- Each plan opens with status/date and a **Bottom line** before the detail, explaining *why*
  before *what*.
- Plans stay in this folder until landed. After implementation, either delete the file (if
  fully captured by code + commit history) or move to `docs/` if it has long-term reference
  value.

> Theme across the three parser-research docs (Allegro / Altium / ODB++): the technical
> blocker is rarely data coverage — it is **licensing** (GPL/AGPL copyleft vs. pcb-lens's
> Apache-2.0) and the **Cadence-export dependency** for design intent (constraints, stackup).
> Each doc flags an empirical "validate on a real export first" step before any build.
