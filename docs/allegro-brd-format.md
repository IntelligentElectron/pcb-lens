# Allegro .brd Constraint Data

This document describes where a Cadence Allegro `.brd` file keeps its design constraints and how `get_constraints` reads them without Cadence software. It covers constraint data only: physical, spacing and electrical constraint sets, net classes, match groups, differential pairs, regions, per-net assignments and the stackup. Geometry (tracks, pads, shapes) is out of scope.

It is derived from reverse engineering. The file header, string table and block framing follow the KiCad importer's notes ([FORMAT.md](https://github.com/KiCad/kicad-source-mirror/blob/master/pcbnew/pcb_io/allegro/FORMAT.md)). The constraint layouts were decoded here by matching binary values against the Constraint Manager XML that the same boards embed (section 2), and several field meanings differ from the KiCad notes; those are marked.

Each section marks its confidence level:

- **VERIFIED**: every value matched the Constraint Manager XML of the same board, on several boards
- **OBSERVED**: consistent across all boards read, not checked value by value
- **HEURISTIC**: works on the boards read; the reasoning is inferred
- **UNKNOWN**: bytes skipped

Coverage: Allegro 17.x files (magic `0x0014xxxx`). Files written by 17.2 (`0x00140400`), by a 17.2 build with magic `0x00140500`, and by 17.4 (`0x00140902`) were decoded. 16.x and 18.x files differ in header and block layouts; for them only the embedded archives are read.

## Table of Contents

1. [Two Stores](#1-two-stores)
2. [Embedded Constraint Manager Archives](#2-embedded-constraint-manager-archives)
3. [Constraint Manager XML](#3-constraint-manager-xml)
4. [Binary Header and String Table](#4-binary-header-and-string-table)
5. [Block Framing and Lists](#5-block-framing-and-lists)
6. [Constraint Blocks](#6-constraint-blocks)
7. [Field Codes](#7-field-codes)
8. [How get_constraints Reports Them](#8-how-get_constraints-reports-them)
9. [Known Gaps](#9-known-gaps)

---

## 1. Two Stores

**Confidence: OBSERVED**

A board carries its constraints in two places:

| Store | Holds | Section names in `get_constraints` |
|-------|-------|-------------------------------------|
| Embedded Constraint Manager archives: zip archives of XML inside the `.brd` | Whatever Constraint Manager saved: from a full database (every object kind and the stackup) down to a few object kinds | Constraint Manager names: `PhysicalCSet`, `SpacingCSet`, `ElectricalCSet`, `NetClass`, `MatchGroup`, `DiffPair`, `Region`, `Design`, ... |
| Binary object database | The board's live rules: physical and electrical constraint sets, net classes, match groups, diff pairs, regions, per-net assignments, and the stackup | `Brd*`: `BrdPhysicalCSet`, `BrdElectricalCSet`, `BrdNetClass`, `BrdMatchGroup`, `BrdDiffPair`, `BrdRegion`, `BrdXnet`, `BrdBus`, `BrdNet`, `BrdStackup` |

The two can disagree. An archive is a snapshot: on boards read so far it matched the binary value for value in most cases, a few values were older, and in one case the archive held the database of a different design (other layer count, other names, its Design object named after a temporary file). Treat the `Brd*` sections as the board's rules and the archives as the richer but possibly stale description (spacing sets, regions, topology, stackup). Compare names and layer counts before mixing them.

A `.dcf` file (Constraint Manager database of a schematic or board) is one such archive as a standalone file.

## 2. Embedded Constraint Manager Archives

**Confidence: OBSERVED**

The archives are ordinary zip data (local file headers `PK\x03\x04`, methods 0 stored and 8 deflate, sizes in the local header) placed inside the `.brd`. There is no directory of them in the binary header; they are found by scanning for the local header signature and keeping entries that decompress.

Each archive starts with a `FileType.txt` member and its members share a path prefix:

```
FileType.txt            "Design" or "Attach"
FormatVersion.txt       e.g. "17.220"
Header.xml              <root Name=".." Key="physical|logical"><Contents>mask</Contents>
                        <revisionNumber ../><precision units="mm" numberOfDecimalPlaces="4"/></root>
objects/<Kind>.xml      one file per object kind: PhysicalCSet, SpacingCSet, ElectricalCSet,
                        SameNetSpacingCSet, NetClass, ClassClass, MatchGroup, DiffPair, PinPair,
                        Region, Net, Xnet, Bus, NetGroup, Stackup, Design, GenericLayer, ...
userPropertyDefinitions.xml
topology/T<n>.txt       topology templates (some archives)
```

Archives seen in one board, in file order:

| FileType | Prefix | Key | Contents |
|----------|--------|-----|----------|
| `Design` | `Attachments/cmdbview.dat/` | logical | A logical (schematic side) view, object names as schematic paths |
| `Design` | none | physical | The board's Constraint Manager database. `Contents` is a bit mask of the object kinds included; full databases and partial ones (nets and net groups only) both occur |
| `Attach` | none | none | Constraint set definitions (`PhysicalCSet`, `SpacingCSet`, `SameNetSpacingCSet`) with `GenericLayer.xml` |

Other zip members appear between archives (temporary files, design-exchange files); they belong to no archive and are ignored. `objects/Gate.xml`, `Part.xml`, `PartDefn.xml`, `Pin.xml` and `DesignInstance.xml` hold component data and are not read.

## 3. Constraint Manager XML

**Confidence: VERIFIED for attributes, references, members and the cross-section; OBSERVED for kind codes**

Each object file is one line of XML:

```xml
<root>
  <o N="DIFF_90" A="@lib.lib(sch_1):\DIFF_90\">            object: N name, A schematic path
    <a N="MIN_LINE_WIDTH">                                  attribute
      <v V="0.1000:0.0600:0.0600:0.1000" G="0.0600:0.1000"/>  V per layer, G per generic layer
      <o>1</o>                                              origin flag (not an object)
    </a>
    <r K="39" N="@lib.lib(view):\DEFAULT\"/>                reference to another object
    <m K="10" N="NET_A"/>                                   member
    <c K="24"><o N="ECS:MG_1">...</o></c>                   container of child objects
  </o>
</root>
```

- `N` is sometimes the schematic path (`@lib.cell(view):\NAME\`) and `A` the plain name, sometimes the reverse. The name is the last `\`-delimited segment.
- `V` lists one value per copper layer, top to bottom, separated by `:`; a single value applies to all layers. `G` lists one value per generic layer type, in the order of `GenericLayer.xml` (for example `Conductor`, `Conductor/EXTERNAL`, `Plane`). An attribute can carry `G` only.
- Lengths are in the units of `Header.xml` `precision`; delays carry their unit in the value (`0.002 ns`). Archives without a precision element use the board's units (section 4).
- `<a>` can also contain `<p K N/>` (scope of the value, e.g. the match group a pin-pair delay applies to) and `<s>` (status bits).
- An ElectricalCSet nests its match groups and pin pairs in `<c K="24">` and `<c K="25">` containers, with attributes such as `RELATIVE_PROPAGATION_DELAY_CNS` on the children.

Kind codes of `<r>`, `<m>`, `<c>` and `<p>`, identified by the object each one names:

| K | Kind | K | Kind |
|---|------|---|------|
| 8 | Pin | 21 | MatchGroup |
| 9 | Xnet | 24 | MatchGroup |
| 10 | Net | 25 | PinPair |
| 11 | Stackup layer | 39 | PhysicalCSet |
| 14 | ElectricalCSet | 40 | SpacingCSet |
| 18 | DiffPair | 46 | SameNetSpacingCSet |
| 20 | PinPair | | |

### Stackup cross-section

The `Design` object holds the stackup:

```xml
<xs><g><t>Conductor</t><t>Plane</t></g>                generic layer types
  <c S="0 " P="PRIMARY" T="0" B="11">                  primary stackup, top and bottom conductor index
    <o T="0"><a N="CDS_LAYER_MATERIAL"><v V="AIR"/></a>...</o>   one <o T> per layer, surface to surface
    <o T="1"><a N="CDS_LAYER_NAME"><v V="TOP"/></a>
             <a N="CDS_LAYER_THICKNESS"><v V="0.03"/></a>
             <a N="CDS_LAYER_DIELECTRIC_CONSTANT"><v V="4.5"/></a>
             <a N="CDS_LAYER_FUNCTION"><v V="CONDUCTOR"/></a>...</o>
  </c></xs>
```

`CDS_LAYER_FUNCTION` names the layer type (`SURFACE`, `CONDUCTOR`, `PLANE`, `DIELECTRIC`, `DIELECTRIC_PREPREG`, ...); `T` is a numeric type code. Thicknesses are in the archive's units.

## 4. Binary Header and String Table

**Confidence: VERIFIED** (offsets for 16.x and 17.x headers; 18.x moves fields)

All integers are little-endian.

| Offset | Size | Field |
|--------|------|-------|
| 0x000 | u32 | Magic. Upper 16 bits: `0x0013` 16.x, `0x0014` 17.x, `0x0015` 18.x. Release byte `(magic >> 8) & 0xFF`: `0x04` 17.2, `0x09` 17.4, `0x15` 17.5 |
| 0x03C | 23 × (u32, u32) | Linked list descriptors: tail sentinel, head key (section 5) |
| 0x0F8 | 60 bytes | Allegro build string |
| 0x180 | u8 | Board units: 1 mils, 2 inches, 3 mm, 4 cm, 5 µm |
| 0x194 | u32 | String count |
| 0x26C | u32 | Units divisor: internal units per board unit |
| 0x1200 | | String table |

A length in internal units converts as `value × unit / divisor`; with units mm and divisor 10000, one internal unit is 0.1 µm.

String table: `string count` entries from 0x1200, each a u32 id, the string and a NUL, padded to a multiple of 4 bytes. Ids are referenced throughout the blocks. The first object block starts right after the last entry.

## 5. Block Framing and Lists

**Confidence: OBSERVED**

Object blocks follow one another with no padding; every block is a whole number of 4-byte words. A block starts with a type byte and, for the blocks read here, has its key in word 1:

```
word 0   type byte, then type-specific bytes (subtype, code)
word 1   key: unique id of the block
word 2   next: key of the next block in its list
```

Block sizes depend on type and version, and this reader does not walk the whole stream. It indexes candidate block starts by key in one pass over the words (word 0 matching the type, word 1 the key) and then walks the header lists, accepting at each step the candidate whose chain continues. A data word can look like a block start, so a candidate is accepted only when its own next key is the list tail or another candidate.

A list ends where a block's next key equals the list's tail sentinel. The tails form a run of consecutive values (0x65, 0x66, ... for lists 0, 1, ...).

Lists used:

| List | Holds |
|------|-------|
| 5 | 0x1B nets |
| 12 | 0x1D physical constraint sets, 0x1E electrical constraint sets, 0x1F padstack dimensions (interleaved) |
| 15 | 0x2C tables |

The 0x36 cross-section is found by its first word (section 6) rather than through list 19.

## 6. Constraint Blocks

### 0x1B Net (60 bytes)

**Confidence: OBSERVED**

| Word | Content |
|------|---------|
| 0 | `0x0000001B` |
| 1 | key |
| 2 | next net |
| 3 | net name (string id) |
| 7 | net assignment |
| 9 | head of the net's 0x03 field chain |
| 10 | 0x26 group link |

Constraints are attached to a net as 0x03 fields (section 7).

### 0x1D Physical constraint set

**Confidence: VERIFIED** (all eleven length slots, every layer, on three boards)

```
word 0    0x0000001D
word 1    key
word 2    next in list 12
word 3    name (string id)
word 4    key of a 0x03 field holding the schematic path
word 5    u16 nA (low half): via slots; u16 nB (high half): copper layer count
+24       nB records of 56 bytes, one per copper layer, top to bottom
          nA slots of 256 bytes: 4-byte prefix, then a NUL-terminated padstack name
+4        trailing word
```

The 56-byte record is 14 int32 in internal units:

| Slot | Constraint | Note |
|------|------------|------|
| 0 | (always 0) | UNKNOWN |
| 1 | `MIN_LINE_WIDTH` | |
| 2 | `MIN_NECK_WIDTH` | KiCad notes call it spacing |
| 3 | `MAXIMUM_NECK_LENGTH` | KiCad notes call it max length |
| 4 | `MIN_BVIA_STAGGER` | KiCad notes call it clearance |
| 5 | `MAX_BVIA_STAGGER` | |
| 6 | bit 0 `ALLOW_ON_ETCH_SUBCLASS`; bits 16 and up `PAD_PAD_DIRECT_CONNECT` (0 `ALL_ALLOWED`, 5 `MICROVIAS_MICROVIAS_COINCIDENT_ONLY`, other codes seen) | VERIFIED on 744 layer records; `TS_ALLOWED` was `ANYWHERE` on all of them and its bits are not identified |
| 7 | `DIFFP_PRIMARY_GAP` | |
| 8 | `DIFFP_NECK_GAP` | KiCad notes call it neck width |
| 9 | `MAX_LINE_WIDTH` | KiCad notes call it neck gap |
| 10 | `DIFFP_MIN_SPACE` | |
| 11 | `DIFFP_COUPLED_PLUS` | |
| 12 | `DIFFP_COUPLED_MINUS` | |
| 13 | (0) | UNKNOWN |

The via slots hold `VIA_LIST`. The live list ends at the first empty slot; later slots keep names from earlier edits and bytes of no meaning.

### 0x1E Electrical constraint set

**Confidence: VERIFIED** (names and field values on four boards)

```
word 0  0x0000001E
word 1  key
word 2  next in list 12
word 3  name (string id)
```

Its rules are 0x03 fields owned by the block (section 7). The KiCad notes describe 0x1E as signal integrity models; on these boards every 0x1E named an electrical constraint set and carried its delay and differential pair rules.

### 0x2C Table

**Confidence: VERIFIED** for subtypes 0x06, 0x15, 0x16, 0x102, 0x103; OBSERVED for 0x104

```
word 0  type byte 0x2C, then u16 subtype in the upper half
word 1  key
word 2  next in list 15
word 3  list 15 tail sentinel
word 6  name (string id)
word 7  key of the first 0x37 member array (0 when none)
```

| Subtype | Object |
|---------|--------|
| 0x0006 | MatchGroup |
| 0x0015 | NetClass |
| 0x0016 | Region |
| 0x0102 | Xnet |
| 0x0103 | DiffPair |
| 0x0104 | Bus |
| others | Drill legends, wire profiles, room-like objects and others: not read |

Constraint values and set assignments are 0x03 fields owned by the table.

### 0x37 Member array

**Confidence: VERIFIED** (net class members on four boards)

```
word 0  0x00000037
word 1  key
word 2  previous: the table for the first array, else the previous array
word 3  next array (0 at the end)
word 4  capacity (100)
word 5  used slots
word 6  capacity + 1 slots of member keys, 0 where empty
```

Members are net keys, Xnet table keys or diff pair table keys. Net classes list their members here.

### 0x26 Group link

**Confidence: VERIFIED** (diff pair members on three boards)

```
word 0  0x00000026
word 3  member: net or Xnet key
word 4  group: 0x2C table key
```

Diff pairs and match groups get their members through these links rather than member arrays. A match group whose members are pin pairs has none of either; pin pairs are not decoded.

### 0x36 Cross-section (substruct 0x10)

**Confidence: VERIFIED** (thickness of every layer on three boards; Dk on two)

The stackup is a 0x36 definition table whose substruct byte (bits 16 to 23 of word 0) is 0x10:

```
word 0   0x00100036
word 1   key
word 2   next
word 4   (0x96 on every board read)
word 5   layer count, surfaces and masks included
word 6   last slot: word 6 + 1 records follow
word 7   0
+32      records of 108 bytes; unused slots are all zero (no material)
```

| Offset | Content |
|--------|---------|
| +8 | u32 position of the layer in the stack, 0 at the top surface. Records are not always stored in order |
| +24 | u32 layer type: 0 surface, 1 conductor, 2 dielectric, 3 plane, 21 prepreg (other codes seen on masks) |
| +40 | material (string id: `AIR`, `SOLDERMASK`, `COPPER`, `FR-4`, ...) |
| +60 | thickness, metres |
| +68, +76 | two more doubles, probably the thickness tolerances |
| +84 | dielectric constant |
| +92 | loss tangent |
| +100 | electrical conductivity, S/m |

Doubles are IEEE 754 stored as two little-endian 32-bit words, the high word first. Layer names are not in the record; conductors run top to bottom in position order.

## 7. Field Codes

**Confidence: per row**

A 0x03 block is one property of another object:

```
word 0  type byte 3, byte 0, u16 property code
word 1  key
word 2  next field; the chain ends where next equals the owner's key
word 3  owner key
word 4  u8 value type, u8, u16 string length
word 5  0
word 6  value
```

| Value type | Value |
|------------|-------|
| 0x64 | integer |
| 0x65 | none (presence flag) |
| 0x66 | int32 length in internal units |
| 0x68 | string of the given length from word 6 |
| 0x6A | string id |
| others (0x69, 0x6B, 0x6C, 0x6E, 0x71, 0x73, 0x74, ...) | records, not decoded |

The reader collects fields by owner key in one pass, without following the chains.

| Code | Constraint | Value type | Confidence |
|------|------------|------------|------------|
| 0x037 | schematic path of the owner | 0x68 | OBSERVED, not reported |
| 0x03A | `TOPOLOGY_TEMPLATE_REVISION` | 0x68 | VERIFIED |
| 0x049 | `PROPAGATION_DELAY` (`pin:pin:min:max`, `AD:AR` for all drivers and receivers) | 0x6A | OBSERVED |
| 0x055 | `MIN_LINE_WIDTH` | 0x66 | KiCad notes |
| 0x05B | `VIA_LIST` | 0x68 | OBSERVED |
| 0x063 | `RELATIVE_PROPAGATION_DELAY` (`group:scope:pin:pin:delta:tolerance`) | 0x6A | OBSERVED |
| 0x065 | `DIFFP_PRIMARY_GAP` | 0x66 | HEURISTIC (one match) |
| 0x066 | `DIFFP_NECK_GAP` | 0x66 | HEURISTIC (one match) |
| 0x068 | `DIFFP_COUPLED_PLUS` | 0x66 | HEURISTIC (plus and minus held equal values) |
| 0x069 | `DIFFP_COUPLED_MINUS` | 0x66 | HEURISTIC |
| 0x06C | `DIFFP_MIN_SPACE` | 0x66 | VERIFIED |
| 0x06F | `DIFFP_PHASE_TOL` | 0x68 | VERIFIED |
| 0x077 | `ELECTRICAL_CONSTRAINT_SET` | 0x6A | OBSERVED (KiCad notes: net schedule) |
| 0x07C | `DIFFP_UNCOUPLED_LENGTH` | 0x66 | VERIFIED |
| 0x173 | `MAX_LINE_WIDTH` | 0x66 | KiCad notes |
| 0x1A0 | `PHYSICAL_CONSTRAINT_SET` | 0x6A | VERIFIED |
| 0x1A1 | `SPACING_CONSTRAINT_SET` | 0x6A | VERIFIED |
| 0x1DA | `LINE_TO_LINE_SPACING` (region) | 0x66 | HEURISTIC |

Other codes are reported on sets and tables as `FIELD_0x<code>` with their decoded value, and dropped on nets, where most carry bookkeeping codes. Regions carry a run of codes 0x1CE to 0x27B (spacing and physical overrides per object pair) that are not mapped yet.

## 8. How get_constraints Reports Them

- Archive sections keep their Constraint Manager names. When two archives hold the same kind, the first in this order keeps the plain name and the others get `#<archive number>`: the board's own `Design` archive, then `Attach`, then prefixed views. `source` names the archive and the name of its Design object.
- Binary sections are named `Brd<Kind>` with `source: "binary"`. Lengths are converted to mm with four decimals; a per-layer value is a `:` list top to bottom, a uniform one a single number.
- `units` gives the unit of the lengths in a section.

## 9. Known Gaps

| Gap | Effect |
|-----|--------|
| 16.x and 18.x binary layouts | Only embedded archives are read |
| Spacing constraint sets in the binary | Not located; read from the archives (every board read has them in one of its archives) |
| Stackup on 17.4 (`0x00140902`) | The 0x36 cross-section was not found on the one 17.4 board read; its stackup comes from an archive's `Design` object when one has it |
| Layer names in `BrdStackup` | Not decoded; conductors are listed top to bottom |
| Pin pairs, match groups of pin pairs | Not decoded |
| 0x1D slots 0 and 13, `TS_ALLOWED`, pad-to-pad codes other than 0 and 5 | Not reported, or reported as a number |
| Region override codes 0x1CE to 0x27B | Reported as `FIELD_0x...` |
| Zip entries with a trailing data descriptor | Skipped; none seen |
