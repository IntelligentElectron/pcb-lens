# Allegro .brd Format

This document describes where a Cadence Allegro `.brd` file keeps its design constraints and its layout, and how pcb-lens reads them without Cadence software. Sections 1 to 9 cover the constraint data `get_constraints` reads: physical, spacing and electrical constraint sets, net classes, match groups, differential pairs, regions, per-net assignments and the stackup. Section 10 covers the layout geometry `get_pcb_metadata`, `get_pcb_component` and `get_pcb_net` read: copper layers, components, pads, nets, tracks, vias and shapes.

It is derived from reverse engineering. The file header, string table and block framing follow the KiCad importer's notes ([FORMAT.md](https://github.com/KiCad/kicad-source-mirror/blob/master/pcbnew/pcb_io/allegro/FORMAT.md)). The constraint layouts were decoded here by matching binary values against the Constraint Manager XML that the same boards embed (section 2), and several field meanings differ from the KiCad notes; those are marked.

Each section marks its confidence level:

- **VERIFIED**: every value matched the Constraint Manager XML of the same board, on several boards
- **OBSERVED**: consistent across all boards read, not checked value by value
- **HEURISTIC**: works on the boards read; the reasoning is inferred
- **UNKNOWN**: bytes skipped

Public boards in the [test-fixtures](https://github.com/IntelligentElectron/test-fixtures) repo (`cadence/`) exercise the reader: one 17.2 board and five 17.4 boards read; the 16.x boards there are outside the binary coverage below.

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
10. [Layout Geometry](#10-layout-geometry)

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

**Confidence: VERIFIED** (thickness of every layer against the embedded XML on twelve 17.2 boards; 17.4 header OBSERVED on six boards)

The stackup is a 0x36 definition table whose substruct byte (bits 16 to 23 of word 0) is 0x10:

```
word 0   0x00100036
word 1   key
word 2   next
word 4   (0x96 on every board read)
word 5   layer count, surfaces and masks included
word 6   last slot: word 6 + 1 records follow
word 7   0
word 8   0 (17.4 files only)
+32      records of 108 bytes (+36 in 17.4 files); unused slots are all zero (no material)
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

### How the codes were named

Two kinds of evidence, both from boards that embed their Constraint Manager database:

- **Values**: a code's values single out one XML attribute on every object that holds both, across boards.
- **Order**: Constraint Manager XML lists an object's attributes in the order of its 0x03 chain, from the first field to the last, or in the reverse order (most electrical constraint sets). An object edited after it was created can list them in another order. A chain is taken as lined up with its XML when both hold the same number of attributes (set assignments and the schematic path are references in the XML and are left out), at least three already named codes sit at their own names, and every value is equal position by position. Each unnamed code in such a chain takes the name at its position; a name is kept only when every lined-up chain gives the same one.

Every name below agrees with the XML on every object that holds both, except where a row says otherwise.

| Code | Constraint | Value type | Confidence |
|------|------------|------------|------------|
| 0x037 | schematic path of the owner | 0x68 | OBSERVED, not reported |
| 0x03A | `TOPOLOGY_TEMPLATE_REVISION` | 0x68 | VERIFIED |
| 0x03C | `STUB_LENGTH` | 0x66 | VERIFIED: order on 9 electrical sets; values on 12 of 13 sets on 5 boards (one archive held another value) |
| 0x049 | `PROPAGATION_DELAY` (`pin:pin:min:max`, `AD:AR` for all drivers and receivers) | 0x6A | OBSERVED |
| 0x055 | `MIN_LINE_WIDTH` | 0x66 | KiCad notes |
| 0x058 | `MIN_BVIA_GAP` | 0x66 | VERIFIED: values on 7 regions, 4 boards |
| 0x05B | `VIA_LIST` | 0x68 | OBSERVED |
| 0x05C | `MIN_NECK_WIDTH` | 0x66 | VERIFIED: values on 3 objects, 3 boards |
| 0x063 | `RELATIVE_PROPAGATION_DELAY` (`group:scope:pin:pin:delta:tolerance`) | 0x6A | OBSERVED |
| 0x065 | `DIFFP_PRIMARY_GAP` | 0x66 | HEURISTIC (one match) |
| 0x066 | `DIFFP_NECK_GAP` | 0x66 | HEURISTIC (one match) |
| 0x068 | `DIFFP_COUPLED_PLUS` | 0x66 | HEURISTIC (plus and minus held equal values) |
| 0x069 | `DIFFP_COUPLED_MINUS` | 0x66 | HEURISTIC |
| 0x06A | `MIN_NOISE_MARGIN` (two values with units, high then low) | 0x68 | VERIFIED: order on 3 electrical sets, 2 boards; the XML writes the numbers without units |
| 0x06C | `DIFFP_MIN_SPACE` | 0x66 | VERIFIED |
| 0x06D | `DIFFP_GATHER_CONTROL`: integer, 0 `INCLUDE`, 1 `IGNORE` | 0x64 | VERIFIED: values on 67 objects; order on 44 objects, 12 boards |
| 0x06F | `DIFFP_PHASE_TOL` | 0x68 | VERIFIED |
| 0x070 | `MIN_FIRST_SWITCH` (`pin:pin:value:value`, values with units; the XML calls it `MIN_FIRST_SWITCH_CNS`) | 0x68 | VERIFIED: order on 3 electrical sets, 2 boards |
| 0x071 | `MAX_FINAL_SETTLE` (as 0x070; XML `MAX_FINAL_SETTLE_CNS`) | 0x68 | VERIFIED: order on 3 electrical sets, 2 boards |
| 0x077 | `ELECTRICAL_CONSTRAINT_SET` | 0x6A | OBSERVED (KiCad notes: net schedule) |
| 0x078 | `RATSNEST_SCHEDULE`: integer, 0 `MIN_TREE`, 1 `MIN_DAISY_CHAIN`, 5 `TEMPLATE`, 6 `POWER_AND_GROUND` | 0x64 | VERIFIED: values on 827 of 832 sets, Xnets and nets; order on 572 objects, 12 boards. Two Xnets on one board read 0 where their archive says `MIN_DAISY_CHAIN` |
| 0x07C | `DIFFP_UNCOUPLED_LENGTH` | 0x66 | VERIFIED |
| 0x0D3 | `IMPEDANCE_RULE` (`pin:pin:target:tolerance`; the XML splits it into `IMPEDANCE_RULE_CNS` and `IMPEDANCE_RULE_CNS_TOL`) | 0x68 | HEURISTIC (one set: values and reverse order match) |
| 0x0E6 | `NET_SCHEDULE`: integer, 0 `DO_NOT_VERIFY`, 1 `VERIFY` | 0x64 | VERIFIED: values on 34 objects, 5 boards; order on 15 |
| 0x173 | `MAX_LINE_WIDTH` | 0x66 | KiCad notes |
| 0x1A0 | `PHYSICAL_CONSTRAINT_SET` | 0x6A | VERIFIED |
| 0x1A1 | `SPACING_CONSTRAINT_SET` | 0x6A | VERIFIED |
| 0x1FB | `MAXIMUM_NECK_LENGTH` (override on nets, Xnets and net classes) | 0x66 | VERIFIED: values on the 3 objects whose XML holds it (2 nets, 1 Xnet), 3 boards; the other attributes of those objects are named codes |
| 0x25F | `SAME_NET_SPACING_CONSTRAINT_SET` (region) | 0x6A | VERIFIED: equals the region's same-net spacing set reference (`<r K="46">`) on 2 regions, 2 boards; the XML uses this attribute name on Design objects |
| 0x62D | `CDS_SKILL_DEFINED` (presence flag; the XML writes `1`) | 0x65 | VERIFIED: on all 450 diff pairs, net classes and physical sets that carry it; order on 388 |

Integer codes of `DIFFP_GATHER_CONTROL`, `RATSNEST_SCHEDULE` and `NET_SCHEDULE` are reported by their XML value; codes not seen yet are reported as numbers. The ratsnest codes follow the order of the schedules in Allegro (minimum spanning tree, minimum daisy chain, source-load daisy chain, star, far-end cluster, template, power and ground); 2 to 4 were not seen.

### Spacing codes

Spacing, same-net spacing and via-gap overrides of regions, Xnets, nets and net classes are 0x66 lengths. The codes come in blocks, one per object kind. The layout is read from the named codes (**Confidence: OBSERVED**); the unnamed codes below are placed by it, not verified:

| Codes | Block |
|-------|-------|
| 0x1CE to 0x1DC | through pin, SMD pin, through via, line, shape: each kind with itself and the kinds after it |
| 0x1DD to 0x1E4 | blind/buried via with itself, the five kinds above, test pin and test via |
| 0x1E5 to 0x1F1 | test pin, then test via, each with itself, the other kinds and shape last |
| 0x1F2 to 0x1FA | bond pad |
| 0x220 to 0x24C | same-net (`SN_`) rules: the codes of 0x1CE to 0x1FA plus 0x52 (0x22D `SN_LINE_TO_SHAPE_SPACING` = 0x1DB + 0x52) |
| 0x251 to 0x255 | hole |
| 0x268 to 0x271 | microvia |
| 0x272 to 0x27B | same-net microvia: the codes of 0x268 to 0x271 plus 0x0A (0x278 `SN_MVIA_TO_SHAPE_SPACING` = 0x26E + 0x0A) |

| Code | Constraint | Named by |
|------|------------|----------|
| 0x1CE | `THRUPIN_TO_THRUPIN_SPACING` | order |
| 0x1D0 | `THRUPIN_TO_THRUVIA_SPACING` | order |
| 0x1D1 | `LINE_TO_THRUPIN_SPACING` | order |
| 0x1D2 | `THRUPIN_TO_SHAPE_SPACING` | values, order |
| 0x1D3 | `SMDPIN_TO_SMDPIN_SPACING` | values, order |
| 0x1D4 | `SMDPIN_TO_THRUVIA_SPACING` | order |
| 0x1D5 | `LINE_TO_SMDPIN_SPACING` | values, order |
| 0x1D6 | `SHAPE_TO_SMDPIN_SPACING` | values, order |
| 0x1D7 | `THRUVIA_TO_THRUVIA_SPACING` | order |
| 0x1D8 | `LINE_TO_THRUVIA_SPACING` | order |
| 0x1D9 | `SHAPE_TO_THRUVIA_SPACING` | order |
| 0x1DA | `LINE_TO_LINE_SPACING` | HEURISTIC; sits at its name in every lined-up chain |
| 0x1DB | `LINE_TO_SHAPE_SPACING` | order |
| 0x1DC | `SHAPE_TO_SHAPE_SPACING` | values, order |
| 0x1DD | `BBV_TO_BBV_SPACING` | values, order |
| 0x1DE | `BBV_TO_THRUPIN_SPACING` | order |
| 0x1DF | `BBV_TO_SMDPIN_SPACING` | order |
| 0x1E0 | `BBV_TO_THRUVIA_SPACING` | order |
| 0x1E1 | `BBV_TO_LINE_SPACING` | values, order |
| 0x1E2 | `BBV_TO_SHAPE_SPACING` | order |
| 0x1E3 | `BBV_TO_TESTPIN_SPACING` | order |
| 0x1E4 | `BBV_TO_TESTVIA_SPACING` | order |
| 0x1E5 | `TESTPIN_TO_TESTPIN_SPACING` | order |
| 0x1E6 | `TESTPIN_TO_THRUPIN_SPACING` | order |
| 0x1E7 | `SMDPIN_TO_TESTPIN_SPACING` | order |
| 0x1E8 | `TESTPIN_TO_THRUVIA_SPACING` | order |
| 0x1E9 | `TESTPIN_TO_TESTVIA_SPACING` | order |
| 0x1EA | `LINE_TO_TESTPIN_SPACING` | order |
| 0x1EB | `SHAPE_TO_TESTPIN_SPACING` | order |
| 0x1EC | `TESTVIA_TO_TESTVIA_SPACING` | order |
| 0x1ED | `TESTVIA_TO_THRUPIN_SPACING` | order |
| 0x1EE | `SMDPIN_TO_TESTVIA_SPACING` | order |
| 0x1EF | `TESTVIA_TO_THRUVIA_SPACING` | order |
| 0x1F0 | `LINE_TO_TESTVIA_SPACING` | order |
| 0x1F1 | `SHAPE_TO_TESTVIA_SPACING` | values, order |
| 0x1F5 | `BONDPAD_TO_THRUVIA_SPACING` | order |
| 0x1F6 | `BONDPAD_TO_LINE_SPACING` | order |
| 0x1F7 | `BONDPAD_TO_SHAPE_SPACING` | values, order |
| 0x1F8 | `BONDPAD_TO_BBV_SPACING` | order |
| 0x1F9 | `BONDPAD_TO_TESTPIN_SPACING` | order |
| 0x1FA | `BONDPAD_TO_TESTVIA_SPACING` | order |
| 0x22D | `SN_LINE_TO_SHAPE_SPACING` | values (one region) |
| 0x253 | `HOLE_TO_LINE_SPACING` | values, order |
| 0x268 | `MVIA_TO_MVIA_SPACING` | order |
| 0x269 | `MVIA_TO_THRUPIN_SPACING` | order |
| 0x26A | `MVIA_TO_SMDPIN_SPACING` | order |
| 0x26B | `MVIA_TO_THRUVIA_SPACING` | order |
| 0x26C | `MVIA_TO_BBV_SPACING` | values, order |
| 0x26D | `MVIA_TO_LINE_SPACING` | order; differs from the archive on one region |
| 0x26E | `MVIA_TO_SHAPE_SPACING` | order |
| 0x26F | `MVIA_TO_TESTPIN_SPACING` | order |
| 0x270 | `MVIA_TO_TESTVIA_SPACING` | order |
| 0x271 | `BONDPAD_TO_MVIA_SPACING` | order |
| 0x278 | `SN_MVIA_TO_SHAPE_SPACING` | values, order |

The chains that name codes by order are Xnets and regions on 5 boards. Each spacing name agrees in value with the XML on 4 to 32 objects.

### Codes left unnamed

These are reported as `FIELD_0x<code>`. The block layout points to a name for several of them, but no value pattern or lined-up chain singles one out.

| Code | Where | What is known |
|------|-------|---------------|
| 0x1CF | regions | Through pin block; its only object has the same value as several candidates. The layout puts `THRUPIN_TO_SMDPIN_SPACING` here |
| 0x1F2 to 0x1F4 | regions | Bond pad block: `BONDPAD_TO_BONDPAD_SPACING`, `SMDPIN_TO_BONDPAD_SPACING` and `THRUPIN_TO_BONDPAD_SPACING` in an unknown order |
| 0x225, 0x228 | regions | Same-net block, no XML counterpart; the +0x52 rule gives `SN_SMDPIN_TO_SMDPIN_SPACING` and `SN_SHAPE_TO_SMDPIN_SPACING` |
| 0x227, 0x22C | regions | `SN_LINE_TO_SMDPIN_SPACING` and `SN_LINE_TO_LINE_SPACING`, equal on their only object. The reverse order of that object and the +0x52 rule both put `SN_LINE_TO_SMDPIN_SPACING` at 0x227 and `SN_LINE_TO_LINE_SPACING` at 0x22C |
| 0x22F to 0x236, 0x24A | regions, net classes | Same-net blind/buried via rules; the +0x52 rule gives `SN_BBV_TO_BBV_SPACING` to `SN_BBV_TO_TESTVIA_SPACING` (as 0x1DD to 0x1E4) and `SN_BONDPAD_TO_BBV_SPACING` |
| 0x251, 0x252, 0x254, 0x255 | regions | With 0x253: `HOLE_TO_HOLE_SPACING`, `HOLE_TO_PIN_SPACING`, `HOLE_TO_VIA_SPACING` and `HOLE_TO_SHAPE_SPACING` in an unknown order |
| 0x272 to 0x277, 0x279 to 0x27B | regions | Same-net microvia rules; the +0x0A rule gives `SN_MVIA_TO_MVIA_SPACING` to `SN_BONDPAD_TO_MVIA_SPACING` (as 0x268 to 0x271) |
| 0x1FD | regions | Integer; no XML counterpart |
| 0x1A2 | net classes | Small even integers on most boards; no XML counterpart |
| 0x28D | diff pairs | Presence flag; no XML counterpart |
| 0x11E | electrical sets | String; no XML counterpart |
| 0x38C, 0x425, 0x426 | electrical sets | Integers; no XML counterpart |
| 0x39C, 0x39D, 0x3A0, 0x3B0, 0x3B1, 0x3B4, 0x3CE, 0x41B, 0x42A, 0x443, 0x45A, 0x6CB, 0x6CC, 0x6F1 | electrical sets | Lengths; the sets that hold them have no XML counterpart on the boards read |

Other codes are reported on sets and tables as `FIELD_0x<code>` with their decoded value, and dropped on nets, where most carry bookkeeping codes.

## 8. How get_constraints Reports Them

- Archive sections keep their Constraint Manager names. When two archives hold the same kind, the first in this order keeps the plain name and the others get `#<archive number>`: the board's own `Design` archive, then `Attach`, then prefixed views. `source` names the archive and the name of its Design object.
- Binary sections are named `Brd<Kind>` with `source: "binary"`. Lengths are converted to mm with four decimals; a per-layer value is a `:` list top to bottom, a uniform one a single number.
- `units` gives the unit of the lengths in a section.

## 9. Known Gaps

| Gap | Effect |
|-----|--------|
| 16.x and 18.x binary constraint layouts | Only embedded archives are read (layout geometry is read, section 10) |
| Spacing constraint sets in the binary | Not located; read from the archives (every board read has them in one of its archives) |
| Layer names in `BrdStackup` | Not decoded; conductors are listed top to bottom |
| Pin pairs, match groups of pin pairs | Not decoded |
| 0x1D slots 0 and 13, `TS_ALLOWED`, pad-to-pad codes other than 0 and 5 | Not reported, or reported as a number |
| Same-net, hole and bond pad spacing codes, and codes with no XML counterpart (section 7) | Reported as `FIELD_0x...` |
| Zip entries with a trailing data descriptor | Skipped; none seen |
| Embedded archive size | Each entry inflates to at most its header size and 256 MiB, and a file to 1 GiB in all; larger entries are skipped |

## 10. Layout Geometry

**Confidence: VERIFIED** against KiCad 10's Allegro importer, run as a separate program, on the ten public boards (one 16.4, three 16.6, one 17.2, five 17.4) and on 61 more boards from a local corpus (five 16.4, seven 16.5, thirty 16.6, twelve 17.2, six 17.4, one 18.0). On every board, every named component's position and side, every pad's position, size and net, every track segment, every arc (centre and direction) and every via (position, drill, net) agree, apart from KiCad's own departures: it names nets and parts it cannot resolve (`Net_<n>`, `UNK…`), lists mounting-hole pads under other pin names, and drops the routing of one net on the 18.0 board. On BeagleBone Black RevC the components, their values and device types, and the TOP and BOTTOM routing of the nets checked also agree with the board's IPC-2581 export.

The reader in `src/tools/lib/allegro-layout.ts` reads 16.x, 17.x and 18.x boards. It uses the header, string table and lists of sections 4 and 5, with these additions:

- 16.x files keep the string count at 0x194 too. 18.x files keep it at 0x34, the units byte at 0x18C (the divisor stays at 0x26C) and the list descriptors from 0x60; the string table still starts at 0x1200.
- Byte 1 of word 0 is 0 on most blocks and 2 on some (nets, segments, shapes, pads, vias seen). Candidates are indexed with byte 1 equal to 0 or 2, and a lookup tries the byte-1-clear candidates first, in file order.
- Net assignments, placed pads, tracks, copper rectangles, shapes and vias must also carry the layer class of their type in byte 2 (0x00, PIN 0x0C, ETCH 0x06, ETCH 0x06, ETCH 0x06, VIA_CLASS 0x12). This rejects data words that mimic a header.

Coordinates are signed internal units (section 4) with Y up; rotations are millidegrees counterclockwise. 18.x blocks are read with the 17.4 layouts; only the padstack header grows (see Padstacks).

### Copper layers

The header holds a layer map from 0x430: one `(u32, 0x2A list key)` pair per layer class, the key of class `c` at `0x42C + 8c`. ETCH is class 6. The 0x2A block with that key at its end names the copper layers top to bottom:

```
word 0    0x2A | count << 16
(17.4+)   one extra word
          count entries: 16.5+ [name string id][flags][0]; 16.4 [32-byte inline name][flags]
          key
```

Flag bit 0x8000 is set on routable layers; layers without it are the planes (the IPC-2581 export calls them `PLANE`).

### Footprints and components

| Block | Word (17.x) | Word (16.x) | Field |
|-------|-------------|-------------|-------|
| 0x2B definition (list 9) | 2 | 2 | footprint name (string id) |
| | 8 | 8 | next definition |
| | 9 | 9 | first 0x2D instance |
| 0x2D instance | 0 | 0 | byte 2: side, 1 bottom |
| | 2 | 2 | next instance; the chain ends at its definition |
| | 10 | 3 | 0x07 instance data |
| | 7 | 6 | rotation |
| | 8, 9 | 7, 8 | x, y |
| | 12 | 10 | first 0x32 placed pad |
| 0x07 instance data | 7 | 5 | refdes (string id) |
| | 2 | 2 | next instance of the same part; the chain ends at the 0x06 part |
| 0x06 part | 3 | 3 | device type (string id) |
| | 8 | 8 | first 0x03 field; fields chain through word 2 back to the part |

A field is `[0x03 | code << 16][key][next]`, then in 17.x and 18.x two more words, then `[subtype | length << 16]` and the value; subtype 0x68 is a string. The part's value is its field of code 2. A part without one has no value; KiCad then shows the value text printed on the board instead. The component's rotation is reported as stored for a top-side part and as `360 - rotation` for a bottom-side one, matching the IPC-2581 export.

### Pads

| Block | Word (17.2) | Word (17.4) | Word (16.x) | Field |
|-------|-------------|-------------|-------------|-------|
| 0x32 placed pad | 2 | 2 | 2 | next item on its net (see Nets) |
| | 6 | 6 | 5 | next pad of the component |
| | 9 | 9 | 8 | 0x0D pad definition |
| 0x0D pad definition | 2 | 2 | 2 | pin name (string id) |
| | 4, 5 | 5, 6 | 4, 5 | x, y in the footprint's frame |
| | 6 | 7 | 6 | 0x1C padstack |

A pad's board position is the footprint position plus its local offset rotated by the footprint rotation, with x negated first for a bottom-side footprint.

### Padstacks (0x1C)

| | 17.x, 18.x | 16.5, 16.6 | 16.4 |
|---|------|------------|------|
| Copper layer count | word 11 | upper half of word 12 | upper half of word 12 |
| Drill | word 16 | word 4 | word 4 |
| Header words | 48 (56 in 18.x) | 21 | 20 |
| Fixed components | 21 | 11 | 10 |
| Components per copper layer | 4 | 3 | 3 |
| Words per component | 9 | 7 | 7 |
| Component layout | [shape, ?, width, height, ...] | [?, shape, width, height, ...] | same as 16.5 |

The top byte of word 0 is the first copper layer of the span. The pad of copper layer `l` is component `fixed + perLayer × l + 2` (antipad and thermal relief come first). These sizes account for the whole block on 17.x boards (`48 + 21 × 9 + layers × 36` words) and on 16.x boards (`21 + (11 + 3 × layers) × 7`, or `20 + (10 + 3 × layers) × 7` before 16.5). Shape codes are those of the KiCad notes; rounded and chamfered rectangles are reported as `rect`.

### Nets

Each 0x1B net (list 5) points to its first 0x04 assignment (word 7 in 17.x, word 6 in 16.x). A net has one assignment per connected island:

```
0x04   word 1 key, word 2 next assignment (the net itself after the last), word 3 net, word 4 first item
```

From word 4, the island's items chain through their word 2 back to the assignment's key, and each item's word 3 is that key, which picks the right block when a key has several candidates. Items are 0x32 placed pads, 0x05 tracks, 0x33 vias, 0x28 shapes, 0x0E copper rectangles and 0x2E connections. A pad's net is the net whose chain holds its key; shapes and rectangles are counted per copper layer.

### Tracks, segments and vias

| Block | Word (17.x) | Word (16.x) | Field |
|-------|-------------|-------------|-------|
| 0x05 track | 0 | 0 | byte 3: copper layer index |
| | 14 | 12 | first segment |
| 0x15, 0x16, 0x17 line, 0x01 arc | 2 | 2 | next segment; the chain ends at the track |
| | 3 | 3 | track |
| | 6 | 5 | width |
| | 7-10 | 6-9 | start x, y, end x, y |
| 0x01 arc only | 0 | 0 | byte 3 bit 6: clockwise |
| | 11-14 | 10-13 | centre x, y as two doubles, high word first |
| 0x33 via | 8, 9 | 6, 7 | x, y |
| | 11 | 9 | 0x1C padstack, for the drill and span |
| 0x28 shape | 0 | 0 | byte 3: copper layer index |

Arc centres and directions were checked on 16.5, 17.4 and 18.0 boards. Shapes are counted per layer; their outlines are not read.

### Not read

- Board outline, keepouts, text and silkscreen
- Shape outlines, thermal spokes and custom pad outlines (reported by their bounding box)
- Components without a refdes (fiducials and other mechanical symbols)
