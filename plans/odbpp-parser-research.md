# ODB++ Open-Source Parser Research

> Status: research / decision input · Date: 2026-06-17
> Question: which open-source ODB++ parsers can we build on to read everything from a
> Cadence Allegro / OrCAD ODB++ export (layout geometry, stackup, netlist/connectivity,
> design constraints/rules), to reach the same programmatic-querying parity we already
> have for IPC-2581 in this TypeScript MCP server?

## Bottom line

For a TypeScript MCP server the deciding factor is **licensing, not capability**. There is
no production-grade, permissively-licensed, JS-native ODB++ parser. The two realistic paths:

1. **Write a focused native TS parser** against the free official spec, reusing the same
   per-subsystem architecture we already use for IPC-2581.
2. **Run the C++ `OdbDesign` as a REST/gRPC sidecar** — only if AGPL service-boundary use
   survives legal review.

Do **not** link the C++ core in-process into a proprietary server.

Good news on data: **ODB++ carries everything asked about** — stackup, full netlist,
geometry, and (contrary to common belief) real constraints/rules — though constraint
completeness depends on the Allegro exporter/version.

## The parsers

| Parser | Lang | License | Maturity | Coverage | TS path? |
|---|---|---|---|---|---|
| **OdbDesign** (`nam20485`) | C++ | **AGPL-3.0** | Most complete, active (last push 2026-06), ~80★ | Full: archives, netlist, product models; REST + gRPC in Docker | Only via REST/gRPC sidecar or C++ linking — **never in-process JS** |
| **ODBPy** (`ulikoehler`) | Python | **Apache-2.0** (best license) | **Alpha, unmaintained since 2019** | netlist, components, layers (matrix/stackup inside `Layers.py`), features, attributes, drill, profile, polygon/surface geometry | No native path — useful as a **structural reference** for a TS port |
| **PyOdbDesignLib** | Python | MIT wrapper / **AGPL core** | v0.0.1 (2023, no updates) | Thin wrapper over the C++ core | No — wrapper's MIT label does not launder the AGPL core |
| KiCad `odb_eda_data.cpp` | C++ | GPL | Production (KiCad importer) | NET/SNT/PKG/PIN netlist | Credible **reference implementation** to port from |

**Killed claims** (failed adversarial verification): OdbDesign does *not* actually achieve
"complete coverage" of the file hierarchy (its own claim, refuted 0-3); the Ruby
`odb-pp-parser` description was unreliable (1-2).

## What ODB++ actually contains (verified against the official spec)

- **Stackup / layer order** — single `matrix` file per product model: rows = layers
  (type/polarity/context), columns = steps; defines physical order and through/blind/buried
  drill relationships. Dielectric/material lives in a separate `stackups` file. An optional
  `stackup.xml` is being introduced to eventually replace the matrix file.
- **Netlist / connectivity** — `eda/data` file: `NET`, `SNT` (subnet), `PKG` (package),
  `PIN` records; components are `CMP` records referencing packages. KiCad's importer
  independently implements these same keywords.
- **Geometry / features** — copper, pads, traces, vias via feature/layer records.
- **Constraints / rules — yes, they exist**, two ways:
  - **System attributes** (Appendix B): `.diff_pair`, `.dpair_gap`, `.electrical_class`,
    `.eclass_impedance`, `.imp_constraint_id` (→ impedance constraints table),
    `.min_line_width`. (`.drc_min_space`/`.drc_min_width` are flagged *obsolete* — the
    SI/net attributes are the live ones.)
  - **`net_prp` file**: Net Type Clearance Records (width/clearance rules), Electrical
    Parameter Set (`dpair_prim_gap`, `dpair_line_width`, `dpair_neck_gap`, phase
    tolerances), explicitly **"read from Cadence Allegro."**
- **Extras**: rigid-flex buildup zones, soldermask finish color, test-probe position/size,
  intentional-short nets.

## ⚠️ The Cadence caveat (biggest open risk)

The `net_prp` electrical/physical constraint records are **version-gated** (clearances
V5.3+, physical params V7.1+) and populated *by the Allegro exporter*. Whether a real
Allegro/OrCAD ODB++ export actually carries the constraints — or whether they stay locked
in proprietary `.brd`/Constraint Manager files — is **not guaranteed and must be
empirically checked on a real export** before building on it. This is the #1 thing to
validate first.

This mirrors what we already see with `export_cadence_constraints` needing a separate
`.tcfx` file in pcb-lens — design intent often lives outside the manufacturing-oriented
export.

## Spec documentation

Officially free: the **ODB++ Design Format Specification** downloads from odbplusplus.com /
Siemens after a no-cost signup, no access restrictions. **Current = v8.1 Update 4
(Aug 2024, 515 pp)** — the site's embedded viewer still shows the older Update 3 (2021), so
grab Update 4 from its direct URL. Caveat: free to *access*, but *use/redistribution* is
contractually restricted under the Siemens Universal Customer Agreement (trade-secret
notice) — relevant if we reproduce spec text or ship a derived parser.

## ODB++ vs IPC-2581 for this use case

- **Coverage**: roughly comparable for layout/stackup/netlist; IPC-2581 is generally
  regarded as **stronger at explicit design-intent/constraint capture**, ODB++
  comparatively weaker (constraints are attribute/exporter-dependent rather than a
  first-class rules database).
- **Governance**: ODB++ is **single-vendor (Siemens)**, de facto proprietary; IPC-2581 is a
  neutral consortium standard (Cadence/Zuken/Ucamco), created partly out of frustration with
  ODB++'s proprietary nature. Lock-in consideration: we already have the more open path
  working.

## Recommendation

1. **First, validate the data, not the parser.** Get one real Cadence/OrCAD ODB++ export and
   inspect whether `net_prp` + constraint attributes are actually populated. If constraints
   don't survive the export, ODB++ buys layout/stackup/netlist but *not* the constraint
   parity we have via `.tcfx` — that changes the whole value proposition.
2. **Build a focused native TS parser against the v8.1 Update 4 spec**, targeting only
   `matrix`, `eda/data`, `features`, `attributes`, `net_prp`. ODB++ is largely a directory
   tree of line-oriented ASCII records — well-suited to the same per-subsystem parser
   approach used for IPC-2581. Use **ODBPy and KiCad's `odb_eda_data.cpp` as reference
   implementations**, not dependencies.
3. **Avoid `OdbDesign` in-process** (AGPL-3.0; its README explicitly says unsuitable for
   closed-source). A REST/gRPC sidecar *might* be acceptable but **get legal sign-off on
   AGPL service-boundary obligations** first. The maintainer offers a commercial license.

### Open questions

- Do real Allegro/OrCAD exports actually populate the constraint fields? (gating question)
- Is sidecar mode enough to avoid AGPL copyleft for a proprietary server, and is the
  commercial license practical to obtain?
- Effort estimate: native TS parser vs. integrating the C++ core, given we only need ~5
  subsystems.

## Sources

Primary-heavy. Official Siemens/odbplusplus spec PDFs (v7.0, v8.1, Update 4), the OdbDesign
and ODBPy repos, PyPI, KiCad source, plus IPC-2581-vs-ODB++ comparison pieces.

- ODB++ Design Format Specification (v8.1 Update 4): <https://odbplusplus.com/design/odb-design-format-specification/>
- Siemens ODB++ resources: <https://www.siemens.com/en-us/products/pcb/odb-plus-plus/resources/>
- ODB++ spec PDF (8.1): <https://odbplusplus.com/wp-content/uploads/sites/2/2020/03/odb_spec_user.pdf>
- ODB++ Format Description (v7.0): <https://odbplusplus.com/wp-content/uploads/sites/2/2020/03/ODB_Format_Description_v7.pdf>
- Introduction to ODB++ (8.1): <https://odbplusplus.com/wp-content/uploads/sites/2/2020/03/Introduction-to-ODB-version-8-1.pdf>
- OdbDesign (C++, AGPL-3.0): <https://github.com/nam20485/OdbDesign>
- ODBPy (Python, Apache-2.0): <https://github.com/ulikoehler/ODBPy>
- PyOdbDesignLib: <https://pypi.org/project/PyOdbDesignLib/>
- ODB++ GitHub topic: <https://github.com/topics/odbplusplus>
- Cadence brd2odb help: <https://odbplusplus.com/wp-content/uploads/sites/2/2023/06/brd2odb_help.pdf>

> Research method: deep-research workflow — 101 agents, 19 sources fetched, 88 claims
> extracted, 25 adversarially verified (23 confirmed, 2 killed).
