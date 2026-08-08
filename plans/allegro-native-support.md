# Native Allegro `.brd` Support in pcb-lens — Investigation & IR Proposal

**Status:** Investigation complete · design decision pending
**Date:** 2026-08-07
**Supersedes:** parts of [`allegro-brd-direct-read.md`](./allegro-brd-direct-read.md) (2026-06-17) —
see [What changed since June](#what-changed-since-june)
**Goal:** Read Cadence Allegro `.brd` binaries natively inside pcb-lens, with no Cadence
install and no external converter, and define the intermediate representation that makes
IPC-2581 and Allegro (and later ODB++ and Altium) interchangeable inputs to one set of tools.

---

## Bottom line

Native `.brd` parsing is **feasible now**, and it is a much smaller job than the June research
concluded. The reason is a file we did not have then: KiCad's Allegro importer ships a
**920-line reverse-engineered format specification** ([`FORMAT.md`][format-md]) documenting the
header, version discrimination, string table, all 40 block types, the layer/class encoding,
padstack layout, pointer chains, and constraint-set record layouts, version-conditional
down to the field.

We validated that specification against all 11 Allegro boards already in
`test/fixtures/cadence/`. Every claim we tested held (details in
[Empirical validation](#empirical-validation)). Version detection is exact on 11/11 files.

Three findings gate the plan:

1. **The two repos you asked for are not the implementation path.** OpenAllegroParser parses
   `.pad` padstacks only — its `.brd` support is one line in an extension-to-enum table.
   kicad-allegro parses extracta's ASCII CSVs, so it needs a licensed Cadence anyway. Both
   remain useful as vocabulary and cross-checks; neither contains a binary board reader.
   See [`references/README.md`](../references/README.md).
2. **kicad-allegro carries no licence at all**, which makes committing it a real decision
   rather than a formality. See [Licence position](#licence-position).
3. **Re-using IPC-2581 as the intermediate format is the wrong call.** It is a wire format we
   would generate only to immediately regex-scan back. The recommendation is a native TS
   `PcbDesign` IR, matching what universal-netlist already does with `ParsedNetlist`. See
   [The intermediate representation](#the-intermediate-representation).

---

## What changed since June

The June doc's recommendation was a hybrid pipeline: shell out to KiCad 10's `pcbnew` Python
API as an external process, consume the `.kicad_pcb` it writes, and keep Cadence around for
stackup. Its reasoning against a native parser was one sentence:

> Reimplementing a `.brd` parser from the reverse-engineered *format facts* (offsets, block
> types) is legally cleaner but a large effort and version-fragile; not recommended near-term.

That cost estimate assumed the format facts had to be recovered by reading GPL C++ and
inferring intent. They do not. `FORMAT.md` states them directly, in prose and tables, as
documentation. Its opening line is *"Reverse-engineered documentation for the Allegro PCB
binary file format... This is not an official specification."* The June doc's own open
question — *"Is there an actively-maintained standalone `.brd` library...?"* — has the answer
"no", but the spec makes that question much less important than it was.

Three of the June doc's conclusions survive unchanged and should not be relitigated:

- Cadence free viewers export nothing; `extracta` / `ipc2581_out` / GENCAD all need a paid
  licence. The no-Cadence requirement is real.
- KiCad is GPLv3+ and pcb-lens is Apache-2.0 on npm. Porting or linking KiCad code is out.
- KiCad's importer does not surface the dielectric stackup (material, Dk, thickness, copper
  weight), only copper-layer ordering.

One of them is now worth re-opening: the stackup gap is a limit of *KiCad's importer*, not
necessarily of the *format*. `FORMAT.md` lists block `0x21` as "Headered block (rules,
stackup)" and `0x2A` as `BLK_0x2A_LAYER_LIST`. KiCad may simply not be reading what it
cannot represent. A native parser is not bound by KiCad's data model, so **the #1 gap in the
June plan is a research lead rather than a wall.** This is speculative until someone decodes
`0x21`; it is not a promise.

---

## What the two vendored repos actually contain

Both are now in [`references/`](../references/), `.git` stripped, unmodified otherwise.

### OpenAllegroParser (MIT, archived at `d9d9d68`, 2022-08-06)

4,039 lines of C++17. The README lists nine Allegro extensions; the code implements one.
`Parser::readPadFile` and `Parser::readSymbol` are the only readers. `.brd`, `.mdd`, `.dra`,
`.psm`, `.ssm`, `.fsm`, `.osm` and `.bsm` appear once each, in `getFileTypeByExtension`'s
`std::map`, mapping to enum values nothing consumes.

What survives as useful:

- `doc/pad.md` documents padstack structure and the ZIP-wrapped JSON payload inside newer
  `.pad` files.
- The `Figure`, `HoleType`, `Drillmethod` and `PadstackUsage` enum tables were derived from
  Cadence's own `cdn_padstack.dtd`, which makes them an independent cross-check on the pad
  shape codes in `FORMAT.md`'s padstack section.
- `getFilesInBinary` scans for `PK\x03\x04`. We ran that scan over all 11 board fixtures:
  **zero matches**. The embedded-JSON side-door is `.pad`-only and does not help with boards.

### kicad-allegro (no licence, last commit 2020-02-19)

847 lines of Rust. It reads the `!`-delimited CSVs produced by Cadence's licensed `extracta`
utility (`<board>.brd-brd.csv`, `-rte.csv`, `-sym.csv`), renders them with `glutin`, and
writes a prototype `.kicad_pcb`. The exporter hardcodes the input path, handles only `LINE`
graphics, hardcodes via size (0.4572 mm) and drill (0.2032 mm), and filters nets through
`net_name.starts_with("M_")` — one specific board's memory nets.

It is not a binary parser and does not remove the Cadence dependency. Its value is the
**extracta column vocabulary**: `BrdRecord` transcribes the stackup view's columns
(`LAYER_SORT`, `LAYER_SUBCLASS`, `LAYER_CONDUCTOR`, `LAYER_DIELECTRIC_CONSTANT`,
`LAYER_THICKNESS`, `LAYER_MATERIAL`, ...), `RteRecord` the pin/via view, `SymRecord` the
geometry view. Together they enumerate what Allegro treats as a board's addressable
attributes — a good completeness checklist for our IR.

Worth noting: `BrdRecord` proves Allegro *holds* per-layer dielectric constant, thermal
conductivity and thickness, since extracta emits them. That is independent support for the
stackup research lead above.

---

## The format, and how far the spec goes

`FORMAT.md` is 920 lines. Coverage, section by section:

| Area | Documented |
|---|---|
| File layout | Header ~4 KB → string table at `0x1200` → object block stream |
| Version discrimination | 9 magics, `0x00130000` (16.0) … `0x00150000` (18.0+), low byte masked |
| Coordinates | ints in mils ÷ header `m_UnitsDivisor`; `nm = coord × 25400 / divisor`; Y negated; arc centres/radii are IEEE-754 doubles stored as two **big-endian** 32-bit words |
| Rotation | millidegrees, not negated despite the Y flip |
| Block types | All 40 tags `0x01`–`0x3C` named, with purpose |
| Linked lists | 22 descriptors pre-V18, 28 in V18; head/tail word order flips in V18 |
| Layer encoding | 21 class codes, fixed subclass codes ≥ `0xEA`, low subclasses index per-class custom layer lists |
| Padstacks (`0x1C`) | Header variants, fixed vs per-layer component slots, 18 pad shape codes, version-dependent drill field location, thermal relief derivation, slot orientation correction |
| Shapes (`0x28`) | Zone outline vs computed fill vs standalone copper; the V172+ `m_Unknown2` bit-12 teardrop discriminator with observed values |
| Net resolution | The full `0x28 → 0x2C → 0x37 → 0x1B` pointer chain, with the V172 conditional |
| Footprints (`0x2B`/`0x2D`) | Instance fields, the local-vs-absolute coordinate split, required transform order |
| Constraints (`0x1D`) | 56-byte record layouts for V172+ **and** pre-V172, field-by-field, with worked BeagleBone Black values |
| Diff pairs / match groups | `NET → 0x26 → 0x2C` (V172+) vs `NET → 0x2C` (pre-V172) |
| V18 deltas | Header restructure, LL reordering, string-count relocation, object-stream gap handling, padstack trailer |

The version boundary that matters most is **17.2**: it changed padstack layout wholesale (new
shapes, square holes, secondary drills, multi-shape mask pads) and made many struct fields
conditional. V18 is the second break, and it restructures the header.

Explicitly *not* covered — the honest gaps:

- Blocks `0x12`, `0x20`, `0x22`, `0x2F`, `0x3B`, `0x3C` are named "Unknown".
- Pad shapes Cross, Diamond, Hexagon X/Y, Triangle, Flash, Donut, N-sided polygon are
  identified but unhandled by KiCad's builder.
- `0x27` is decoded structurally but declared navigational, carrying no rule values.
- The V18 padstack trailer's 8 uint32s are read and unexplained.
- Byte-exact struct field offsets are **not** in `FORMAT.md` — it documents fields, order and
  conditionality, not a hex offset table. Those come from `allegro_pcb_structs.h` (GPL), which
  is exactly the file we must not transliterate. Offsets have to be re-derived from fixtures.

That last point is the real remaining work, and it is the thing to scope honestly.

---

## Empirical validation

We tested the spec against the 11 `.brd` files already in `test/fixtures/cadence/`. No claim
below is taken from documentation alone.

**Version detection: 11/11 exact.** Masking the low byte of the first LE uint32 maps every
fixture onto the documented table, and every result agrees with the ASCII version string the
file carries near offset `0xF8`:

| Fixture | Magic | Version | Objects (`0x14`) |
|---|---|---|---|
| BeagleBoard-xM | `0x00130c03` | 16.4 | 122,769 |
| CutiePi_V2_3 | `0x00131504` | 16.6 | 66,508 |
| CC13xxEM_5XD_7793_4L | `0x00131503` | 16.6 | 27,050 |
| LAUNCHXL-CC1310 | `0x00131503` | 16.6 | 63,891 |
| BeagleBone Black RevC | `0x00140400` | 17.2 | 598,459 |
| reServer J2032 | `0x00140902` | 17.4 | 211,112 |
| reComputer J202 | `0x00140902` | 17.4 | 227,449 |
| reComputer J401 | `0x00140902` | 17.4 | 240,982 |
| reComputer Industrial J201 | `0x00140902` | 17.4 | 251,314 |
| reServer Industrial J401 | `0x00140902` | 17.4 | 354,855 |

**Header fields confirmed.** Reading the first 0x24 bytes as LE uint32s reproduces the
documented semantics on every fixture: `0x04` = `3` (`m_Unknown1a`), `0x08` = `1`
(`m_FileRole`, and `0x01` is documented as `.brd`), `0x0c` = `3` (`m_Unknown1b`), `0x10` = `9`
(`m_writerProgram`, documented as "Allegro editor"). Two fields the spec does not mention:
**`0x20` holds the file's own byte length** — exact on all 11 files, a free integrity check —
and `0x18` is the constant `0x000A0D0A`, the classic CRLF/LF sentinel for detecting
text-mode corruption.

**String table confirmed at `0x1200`.** Walking `[4-byte id][NUL-terminated string]` with
**4-byte alignment between entries** (the alignment is ours; `FORMAT.md` does not state it)
decodes cleanly: BeagleBone Black yields 2,733 consecutive strings — `124:"C88"`,
`125:"C103"`, `126:"C87"` — with sequential IDs, and BeagleBoard-xM yields 3,141 including
full net names like `MMC1_DAT0/MS_DAT0/GPIO_122`. Without alignment the walk desynchronises
on the first odd-length string, which is how we found the rule.

**Block stream confirmed.** On BeagleBone Black (17.2) the bytes immediately after the string
table are `06 00 02 00 36 0b 00 00 …` — `0x06` being a documented block tag
(component/symbol definition), consistent with the documented `[1-byte type tag][payload]`
framing. On the 16.4 file the same offset is not a valid tag, i.e. the pre-V172 string table
does not terminate where a naive walk stops; bounding it needs the header's explicit string
count. That is a known, tractable detail, not a contradiction.

**No embedded ZIP in boards.** `PK\x03\x04` appears zero times in all 11 files.

Net assessment: the spec is accurate, our fixtures exercise the two biggest version breaks
(pre-17.2 and 17.2+), and nothing we tested contradicted the document.

---

## Licence position

Three distinct licence questions, with different answers. **None of this is legal advice, and
the third one warrants a real opinion before we ship.**

**OpenAllegroParser — clean.** MIT, archived. Vendoring into an Apache-2.0 repo is permitted
provided the notice and licence text travel with the copy, which they do. Same posture as
`OpenOrCadParser` in universal-netlist. Porting its logic is fine with attribution.

**kicad-allegro — unresolved, and it is in the tree right now.** No LICENSE file, no
`license` field in `Cargo.toml`, GitHub API reports `license: null`. Default copyright means
all rights reserved: no redistribution grant and no derivative-works grant. Committing it to
a public Apache-2.0 repo published to npm distributes someone else's code without permission.
It is 847 lines of prototype Rust whose only durable value is the extracta column vocabulary.
Options, cheapest first:

1. **Don't commit it.** Record the upstream URL, commit hash, and the column vocabulary in
   `references/README.md` and here. Costs us essentially nothing, since we have already
   extracted what is useful.
2. **Ask upstream to add a licence.** One issue on `system76/kicad-allegro`. System76 licenses
   nearly everything permissively; a MIT/Apache grant is plausible. Unmaintained since 2020,
   so a reply is not guaranteed.
3. **Commit it anyway** as a flagged, accepted risk. Low practical exposure — tiny, abandoned,
   non-commercial — but it is a real grant we do not hold, in a repo we publish.

I recommend (1) now and (2) in parallel; if upstream grants a licence, promote to a full
vendored copy. This is your call, and the files are staged either way.

**KiCad's `FORMAT.md` and the C++ — the important one.** The importer
(`pcbnew/pcb_io/allegro/`, ~414 KB across 9 files) is GPLv3+, © Quilter and the KiCad
Developers. `allegro_parser.cpp` (84 KB) and `allegro_pcb_structs.h` (65 KB) must not be
transliterated to TypeScript; doing so makes pcb-lens a GPL derivative, which the June doc
correctly ruled out for an Apache-2.0 npm package.

`FORMAT.md` sits in the same GPL repository, so its *text* is copyrighted. But what we need
from it are **facts about a third party's file format** — that block tag `0x1C` is a padstack,
that the string table begins at `0x1200`, that rotation is in millidegrees. Facts are not
copyrightable, and interoperability information specifically enjoys protection in most
jurisdictions. So the defensible position is: implement from the documented *facts*, verified
against our own fixtures; never copy the *prose*, the struct declarations, or the code.

Practical rules for whoever writes the parser:

- Work from `FORMAT.md` and from our fixtures. Do not open `allegro_parser.cpp` or
  `allegro_pcb_structs.h`.
- Derive byte offsets empirically from fixtures. This is unavoidable regardless, since
  `FORMAT.md` does not contain an offset table.
- Do not carry over KiCad identifiers (`m_Ptr7_16x`, `BLK_0x28_SHAPE`, `COND_GE`). Name things
  in our own terms.
- Record provenance per field in our own `docs/allegro-brd-format.md`: what we observed, in
  which fixture, at which offset. This is what universal-netlist does with
  `docs/dsn-format.md`, and it is the artifact that demonstrates independent derivation.

The stricter alternative — clean-room with a two-person spec/implement split — is available if
you want maximum defensibility, at meaningful cost in speed. My read is that the middle path
is proportionate for reading a competitor's undocumented format for interoperability, but
this deserves a real opinion before release rather than my judgment.

---

## The intermediate representation

> *"We need to define a standard PCB intermediate format kinda like we do for universal
> netlist JSON format. I think we could just re-use IPC2581?"*

The instinct is right and the specific answer should be no. Here is why, and what to do
instead.

### What pcb-lens does today

There is **no intermediate representation**. All five tools parse IPC-2581 XML directly, by
regex over lines:

```
src/tools/lib/xml-utils.ts:
  "IPC-2581 XML is well-formatted (one element per line), so regex
   attribute extraction works without a DOM/SAX parser."
```

`get_pcb_net` streams the file and pattern-matches `<LogicalNet`, `<PinRef`, `<PhyNetPoint`
across three passes; `render_net` does seven. `types.ts` describes *tool response shapes*
(`QueryNetResult`, `ComponentResult`), not a board model. The 4,981 lines under `src/tools/`
are IPC-2581-shaped throughout.

That design was correct for one input format. It does not extend to four.

### Why not re-use IPC-2581 as the IR

Re-using it means writing an Allegro → IPC-2581 XML *generator*, then feeding the existing
tools. Attractive because the tools would not change. It fails on five counts:

1. **We would serialise to text purely to regex it back.** The generator writes
   `<LineDescRef>` / `<StandardPrimitive>` / `<Contour>` ceremony; milliseconds later the same
   process re-parses it with `attr(line, "name")`. All cost, no benefit.
2. **The regex reader depends on Cadence's exact formatting.** The one-element-per-line
   assumption is a property of `ipc2581_out.exe`'s output, not of the standard. Our generator
   would have to reproduce that layout faithfully or the readers break — a coupling to a
   formatting quirk of a tool we are trying to stop depending on.
3. **Impedance mismatch in both directions.** IPC-2581 has no natural home for Allegro's
   physical constraint sets, match groups, teardrop discriminators or `0x21` stackup rules;
   forcing them in means inventing conventions, at which point it is our format wearing a
   standard's name. Conversely, generating conformant IPC-2581 obliges us to emit content
   dictionaries and structure that carry no information we need.
4. **Cost.** IPC-2581 boards run 14 MB and 300 K+ lines. Every query pays serialisation plus
   re-parse. An in-memory model with indices is faster by orders of magnitude, and pcb-lens is
   explicitly built around token- and time-efficient queries.
5. **It is lossy where we care.** Round-tripping through any wire format discards what the
   format cannot name. For a tool whose value is precise layout answers, that is the wrong
   default.

IPC-2581 remains exactly what it is today and should stay: an excellent **input** format, and
the right **export** format when someone wants to hand a board to another tool. It should not
be our internal exchange.

### What to do instead: a native `PcbDesign` IR

Do what universal-netlist already did. It does not re-use OrCAD's or Altium's format
internally — it defines a small TS model:

```ts
// universal-netlist/src/types.ts
export interface ParsedNetlist {
  nets: NetConnections;
  components: ComponentDetails;
}
```

Cadence `.dat`/`.DSN`, Altium `.SchDoc` and KiCad `.net` readers all produce `ParsedNetlist`,
and every tool queries that. Adding a format touches one parser and no tools. That is the
property we want for pcb-lens, and the layout equivalent is a `PcbDesign`:

```ts
interface PcbDesign {
  source:     { format: "ipc2581" | "allegro" | "odbpp" | "altium"; file: string;
                formatVersion?: string; };
  // All lengths in microns, all angles in degrees CCW, origin bottom-left,
  // Y increasing upward — normalised once, at parse time.
  stackup:    Layer[];        // ordered top→bottom; conductor + dielectric
  components: Component[];    // refdes, package, x, y, rotation, side, pads
  padstacks:  Padstack[];     // shapes per layer, drill, thermal relief
  nets:       Net[];          // name, pin refs, netclass ref
  routing:    Trace[];        // layer, width, points, arcs
  vias:       Via[];          // x, y, padstack, layer span
  pours:      Pour[];         // outline, fill polygons, net, layer
  outline:    Contour;        // board edge
  keepouts:   Keepout[];
  rules:      ConstraintSet[]; // clearance, width, diff-pair gap, per-net overrides
  text:       TextItem[];
}
```

Design commitments that matter more than the field list:

- **Normalise units at the boundary.** Microns everywhere, converted once in each reader.
  pcb-lens already promises this in its MCP instructions ("normalized to microns regardless of
  the source file's native unit"); the IR makes it structural instead of per-tool.
- **Model the superset, mark absence explicitly.** Allegro has constraint sets that IPC-2581
  lacks; IPC-2581 has dielectric detail Allegro may hide in `0x21`. The IR should carry both
  and let a field be `undefined` with a machine-readable reason, so a tool can answer "this
  format does not record that" instead of silently returning zero.
- **Keep it columnar where it is large.** `types.ts` already uses `PadRow` / `ViaRow` /
  `NetRow` tuples for exactly this reason. Extend that discipline into the IR rather than
  building an object graph with a million small objects.
- **Build indices, not scans.** `Map<refdes, Component>`, `Map<netName, Net>`, and a spatial
  index for geometry queries. This is where the real speedup over today's multi-pass streaming
  comes from.
- **Keep it in-memory, and make JSON a debug view.** A `toJSON()` for inspection and fixtures
  is valuable; a JSON file as the *mandatory* hop between reader and tool would repeat the
  IPC-2581 mistake at lower verbosity.

The migration is genuinely incremental: write `PcbDesign` and an IPC-2581 → `PcbDesign` reader
first, move the five tools onto it one at a time with the existing tests as the contract, and
only then add the Allegro reader. Allegro support then lands as a new reader plus zero tool
changes — and that is the proof the abstraction is right.

---

## Test fixtures

We already have **11 Allegro boards** in `test/fixtures/cadence/` (the shared
[test-fixtures](https://github.com/IntelligentElectron/test-fixtures) submodule), which is a
better starting position than expected. Current version coverage:

| Version | Boards | Fixtures |
|---|---|---|
| 16.4 | 1 | BeagleBoard-xM |
| 16.6 | 3 | CutiePi V2.3, CC13xxEM, LAUNCHXL-CC1310 |
| 17.2 | 1 | BeagleBone Black RevC (+2 derived copies) |
| 17.4 | 5 | Seeed Jetson series (reComputer J202/J401/J201, reServer J2032/J401) |

Gaps, in priority order:

1. **18.0+** — the second big format break (header restructure, 28 linked lists, object-stream
   gaps, padstack trailer). We have zero coverage and cannot validate any V18 code path.
2. **22.x / 23.x (OrCAD X)** — KiCad claims 16→23; we cannot confirm any of it.
3. **16.0 / 16.2** — the oldest supported magics, untested.
4. **17.5** — untested.
5. **Flex and rigid-flex** — zero coverage. These exercise stackup handling hardest, which is
   where our most interesting open question lives.
6. **HDI / microvias / blind-buried** — the `0x1C` layer-span logic (`count > 1 && count <
   totalCu` → blind/buried) has no fixture that exercises it.

On sourcing: automated discovery does not work here. GitHub code search does not index binary
`.brd`, and the extension collides with Eagle's ASCII `.brd` — a `path:*.brd allegro` search
returns 123 results, all Eagle files that merely mention Allegro Microsystems as a component
vendor. `gh` is also not currently authenticated on this machine
(`gh auth refresh -h github.com` to fix), so org-scoped API search is unavailable.

This needs a curated hunt through known open-hardware publishers rather than a query. The
productive seams, based on where our existing 11 came from:

- **TI** reference designs and EVMs ship Allegro source (LAUNCHXL-CC1310 and CC13xxEM came
  from there) and are the single best source for recent versions.
- **NXP** i.MX EVK/SOM boards — notably, KiCad's own `FORMAT.md` cites "EVK_BaseBoard" and
  "EVK_SOM" as test boards, so those files are obtainable.
- **BeagleBoard.org**, **Seeed OSHW** — already mined; check for newer revisions on 18.x.
- **AMD/Xilinx VCU118** — cited in `FORMAT.md` as their largest pre-V172 test case; licence
  terms need checking, they are usually restrictive.
- **96Boards**, **Analog Devices** reference designs.

Flex and rigid-flex in Allegro with a redistributable licence are genuinely rare, and I would
not promise them. If none surface, the fallback is to construct one: Allegro's free viewer
cannot export, but a licensed seat can produce a small purpose-built rigid-flex fixture we
own outright and can licence however we like. That may be the only reliable route to
categories 5 and 6.

Every addition goes to the test-fixtures repo with a `NOTICE.md` row (upstream, licence,
copyright), per the convention already there.

---

## The build-vs-shell-out decision

KiCad's importer is genuinely complete — it reads 16→23, handles pad shapes, zones,
teardrops and constraint sets. "Just use it" is a real option, and it is the June plan. The
two paths, stated plainly:

| | External KiCad process | Native clean-room parser |
|---|---|---|
| Effort | Low — drive `pcbnew`, parse `.kicad_pcb` | Weeks, staged by capability |
| Licence | Clean (process boundary = aggregation) | Clean if implemented from facts only |
| Deployment | Requires a **KiCad 10 install on the host** | Nothing; pure TS in the existing binary |
| Stackup | Not extracted — Cadence stays required | `0x21` unexplored; may close the gap |
| Fidelity ceiling | Whatever KiCad's data model can hold | Whatever the format holds |
| Failure mode | Opaque — debugging happens in someone else's C++ | Ours to fix |

The deployment line is the one that decides it for pcb-lens specifically. We ship
self-contained Bun binaries for five platforms and an npm package; requiring users to
install KiCad 10 to read a board is a large regression in what this tool *is*. The shell-out
also keeps a permanent ceiling at KiCad's data model, which is precisely where the stackup
gap comes from.

Recommendation: **native**, with the external path kept as the fallback if the clean-room
posture turns out to be untenable.

## Licence posture for the project itself

Raised today and worth recording, since it is cheaper to settle before the Allegro work
lands than after.

pcb-lens and universal-netlist are both **Apache-2.0**. Nothing in this plan changes that —
the whole point of the clean-room route is to *keep* it. The GPL discussion here is about
avoiding an involuntary licence change, not proposing a deliberate one.

A deliberate change is available if wanted: we hold copyright on both codebases and could
move future releases to GPLv3, AGPL, or a dual GPL-plus-commercial model. Three constraints
if that is ever considered:

- Published releases are permanently Apache-2.0; relicensing binds only future ones, and
  anyone may fork from the last permissive tag.
- It covers only code we own. Outside contributors keep copyright on their commits absent a
  CLA, and vendored MIT subtrees stay MIT.
- Copyleft is a real adoption deterrent for an MCP server, since these get embedded into
  other organisations' agent stacks where GPL policies bite hardest.

Also worth noting: licence choice is weak protection for the Allegro work specifically. The
format facts are public in KiCad's `FORMAT.md`; the moat is the implementation quality and
the fixture corpus, not the licence.

## Recommended sequence

Nothing below is started; this is the proposal to react to.

1. **Decide the three open questions** — kicad-allegro's licence status, how strict a
   clean-room posture to adopt, and whether `PcbDesign` is the agreed direction.
2. **Land `PcbDesign` + an IPC-2581 reader**, and migrate the five existing tools onto it,
   using the current test suite as the behavioural contract. No new format yet — this step
   should be provably behaviour-preserving.
3. **Write `docs/allegro-brd-format.md`** as we go: our own offset table, derived from
   fixtures, with provenance per field. This is both the engineering artifact and the
   independent-derivation record.
4. **Build the Allegro reader in capability order**, each stage independently useful:
   header + string table → nets → components + placement → padstacks → routing + vias →
   shapes/pours → constraints → text/graphics.
5. **Target 17.2+ first** (6 of our 11 fixtures, and the modern format), then pre-17.2
   (5 fixtures), then V18 once we have a fixture for it.
6. **Investigate block `0x21`** for dielectric stackup. If it yields material/Dk/thickness,
   pcb-lens reads Allegro boards more completely than KiCad does, and the June plan's #1 gap
   closes.
7. **Expand fixtures** in parallel, prioritising a V18 board — without one, step 5's last
   stage cannot be validated at all.

## Sources

- KiCad Allegro `FORMAT.md` (the specification this rests on):
  <https://github.com/KiCad/kicad-source-mirror/blob/master/pcbnew/pcb_io/allegro/FORMAT.md>
- KiCad 10 importers announcement:
  <https://www.kicad.org/blog/2026/02/Three-New-Importers-in-KiCad-10-Allegro-PADS-and-gEDA/>
- KiCad licences (GPLv3+): <https://www.kicad.org/about/licenses/>
- OpenAllegroParser (MIT, archived, `.pad` only):
  <https://github.com/Werni2A/OpenAllegroParser>
- system76/kicad-allegro (no licence, extracta CSVs):
  <https://github.com/system76/kicad-allegro>
- Prior research: [`allegro-brd-direct-read.md`](./allegro-brd-direct-read.md)

[format-md]: https://github.com/KiCad/kicad-source-mirror/blob/master/pcbnew/pcb_io/allegro/FORMAT.md
