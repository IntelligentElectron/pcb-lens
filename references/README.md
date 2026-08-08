# References

Third-party source vendored into this repository for reference only. Nothing here is
compiled, linked, executed, or shipped: `tsconfig.json`, `eslint.config.js` and
`vitest.config.ts` all scope to `src/`, and the published npm package excludes this
directory (`package.json` `files` lists `dist` only).

This mirrors the convention established in
[universal-netlist/references](https://github.com/IntelligentElectron/universal-netlist/tree/main/references),
where `OpenOrCadParser/` is the ground truth for the `.DSN` reader.

Both entries here relate to reading **Cadence Allegro** designs. Read
[`plans/allegro-native-support.md`](../plans/allegro-native-support.md) first — it explains
what each of these actually covers, which is considerably less than their names suggest.

## OpenAllegroParser

`OpenAllegroParser/` is an unmodified copy of Dominik Wernberger's C++ Allegro parser.

| | |
|---|---|
| Upstream | https://github.com/Werni2A/OpenAllegroParser |
| Commit | `d9d9d68aa2975266b3f3619ee3a941687b18f486` |
| Commit date | 2022-08-06 |
| Licence | MIT — see [`OpenAllegroParser/LICENSE`](OpenAllegroParser/LICENSE) |
| Copyright | © 2021 Dominik Wernberger |
| Upstream status | **Archived by its owner.** Read-only; will receive no further commits |

### What it actually covers

The README advertises `.brd`, `.mdd`, `.dra`, `.psm`, `.ssm`, `.fsm`, `.osm`, `.bsm` and
`.pad`. The implementation covers **`.pad` padstack files only**. `Parser::readPadFile` and
`Parser::readSymbol` are the sole readers; the other extensions appear exclusively in
`getFileTypeByExtension`'s lookup table, which maps them to a `FileType` enum value that
nothing subsequently consumes. There is no `.brd` reader.

Two pieces are still useful to us:

- **`doc/pad.md`** documents the padstack structure, and the discovery that newer `.pad`
  files carry a ZIP-wrapped JSON payload describing the padstack in readable form.
- **`Parser::getFilesInBinary` / `exportZipFiles`** locate an embedded ZIP inside an Allegro
  binary by scanning for the `PK\x03\x04` magic. We verified this yields nothing on `.brd`:
  all 11 board fixtures in `test/fixtures/cadence/` contain zero ZIP magic sequences, so the
  JSON side-door is a `.pad`-only affordance.

Its enum layout, `Figure` / `HoleType` / `Drillmethod` / `PadstackUsage` value tables, and
`Pad.hpp` field ordering remain a useful cross-check when we implement padstack (`0x1C`)
decoding, because those tables came from Cadence's own `cdn_padstack.dtd`.

### Licence compatibility

MIT is permissive and this repository is Apache-2.0. Redistributing an MIT work inside an
Apache-2.0 project is permitted; the requirement is that the copyright notice and licence
text travel with the copy, which is why `OpenAllegroParser/LICENSE` is kept intact and
unmodified in place. The vendored subtree stays MIT — inclusion here does not relicense it.

The pin is upstream's final commit: the repository was archived at `d9d9d68`, so the vendored
tree and upstream `main` are the same tree and cannot diverge.

### Local modifications

None. The tree is upstream's, minus `.git/`.

To verify the copy against upstream:

```bash
git clone --depth 1 https://github.com/Werni2A/OpenAllegroParser /tmp/oap-verify
diff -r --exclude=.git references/OpenAllegroParser /tmp/oap-verify
```

## kicad-allegro — deliberately NOT vendored

Jeremy Soller's Rust Allegro-extract viewer was evaluated and **is not committed here**.

| | |
|---|---|
| Upstream | https://github.com/system76/kicad-allegro |
| Commit evaluated | `4968f1301a1ec189ee34135f528a7d7a27e76a7b` (2020-02-19) |
| Licence | **None declared** |
| Copyright | © Jeremy Soller / System76 |
| Upstream status | Unmaintained; no commits since 2020-02 |

The repository ships **no LICENSE file** and declares no `license` field in `Cargo.toml`; the
GitHub API reports `license: null`. Under default copyright that means *all rights reserved*:
there is no grant to redistribute it and no grant to create derivative works from it.
Committing it to a public Apache-2.0 repository that publishes to npm would distribute
someone else's code without permission, so it stays out until upstream grants a licence.

The asymmetry drove the call: adding it later is one commit, while removing unlicensed code
from public git history requires a history rewrite.

To fetch a local working copy (gitignored, never committed):

```bash
git clone https://github.com/system76/kicad-allegro references/kicad-allegro
```

Nothing is lost by its absence, because its only durable value is already recorded below.

### What it actually covers, and what we kept

Despite the name, this reads **no binary at all**. It consumes the `!`-delimited ASCII CSVs
that Cadence's licensed `extracta` utility emits beside a board — `<board>.brd-brd.csv`,
`-rte.csv`, `-sym.csv` — so it still requires the very Cadence dependency we are trying to
remove. It is ~850 lines total: four `serde` record structs (`BrdRecord` stackup rows,
`RteRecord` pin/via rows, `SymRecord` geometry rows, `ShpRecord` pad shapes), a `glutin`
OpenGL viewer, and a `.kicad_pcb` writer that is an early prototype — hardcoded board path,
`LINE` graphics only, fixed via size and drill, and a `net_name.starts_with("M_")` filter
that emits one specific design's memory nets.

Its lasting value is the **extracta record-column vocabulary**, transcribed below so the
source tree is no longer needed. These are the column orders of extracta's views, which
document what Allegro considers the addressable attributes of a board — a completeness
checklist for our intermediate representation.

**`brd` view — stackup.** Note that Allegro records per-layer dielectric constant, thermal
conductivity and thickness, since extracta emits them. That is independent evidence for the
stackup research lead in
[`plans/allegro-native-support.md`](../plans/allegro-native-support.md):

```
RECORD_KIND, LAYER_SORT, LAYER_SUBCLASS, LAYER_ARTWORK, LAYER_USE,
LAYER_CONDUCTOR, LAYER_DIELECTRIC_CONSTANT, LAYER_ELECTRICAL_CONDUCTIVITY,
LAYER_MATERIAL, LAYER_SHIELD_LAYER, LAYER_THERMAL_CONDUCTIVITY, LAYER_THICKNESS
```

**`rte` view — pins, vias, test points.**

```
RECORD_KIND, NET_NAME, PIN_NUMBER_SORT, CLASS, REFDES, SYM_TYPE, SYM_NAME,
SYM_X, SYM_Y, SYM_ROTATE, SYM_MIRROR, PIN_NAME, PIN_NUMBER, PIN_X, PIN_Y,
PIN_EDITED, PAD_STACK_NAME, VIA_X, VIA_Y, VIA_MIRROR, PIN_ROTATION,
TEST_POINT, NET_PROBE_NUMBER
```

**`sym` view — placement and geometry.** `GRAPHIC_DATA_1..10` are polymorphic, interpreted
per `GRAPHIC_DATA_NAME` (e.g. for `LINE`: x1, y1, x2, y2, width):

```
RECORD_KIND, SYM_TYPE, SYM_NAME, REFDES_SORT, REFDES, SYM_X, SYM_Y,
SYM_ROTATE, SYM_MIRROR, NET_NAME_SORT, NET_NAME, CLASS, SUBCLASS, RECORD_TAG,
GRAPHIC_DATA_NAME, GRAPHIC_DATA_NUMBER, GRAPHIC_DATA_1..10,
COMP_DEVICE_TYPE, COMP_PACKAGE, COMP_PART_NUMBER, COMP_VALUE, VALUE
```

**`shp` view — pad shapes.**

```
RECORD_KIND, SUBCLASS, PAD_SHAPE_NAME, GRAPHIC_DATA_NAME, GRAPHIC_DATA_NUMBER,
RECORD_TAG, GRAPHIC_DATA_1..9, PAD_STACK_NAME, REFDES, PIN_NUMBER
```

Two conventions worth carrying forward: rows are `!`-delimited (not comma), and only rows
whose first field is `S` are data — everything else is a header or continuation.
