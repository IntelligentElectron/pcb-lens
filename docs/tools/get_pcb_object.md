# get_pcb_object

Look inside the binary database of an Allegro `.brd`, for anything the named tools do not cover.

## Description

An Allegro board is a stream of typed blocks (nets, pads, shapes, properties, tables...) followed by attachments (embedded files). This tool is the backstop that makes every one of them reachable:

- **No arguments:** every block type with Allegro's name and count, and every attachment with its size and save time.
- **`type`:** the keys of the blocks of that type.
- **`key`:** one block's words, each word that names another block or a string resolved (`"0x1b NET"`, `"\"GND\""`), and the blocks whose words hold this key.
- **`attachment`:** that attachment's text, decompressed when zlib (ZIP payloads are reported by encoding only).

Use the named tools first: they decode these blocks into board terms.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | Yes | - | Path to an Allegro `.brd` file (Allegro 16.0 to 25.1) |
| `key` | string | No | - | A block key, decimal or hex (`'81234'`, `'0x13d52'`) |
| `type` | string | No | - | A block type number (`'0x1B'`) |
| `attachment` | string | No | - | An attachment name (`'ALLEGRO_DESIGN_WAS_LAST_SAVED'`) |

## Response Schema

```typescript
// common to every mode
interface ObjectQueryBase { fileName: string; layout: string; allegroVersion: string }

// no arguments
interface Inventory extends ObjectQueryBase {
  blockCount: number;
  types: Array<{ type: string; name?: string; count: number }>;
  attachments: Array<{ name: string; class?: string; bytes: number; savedAt?: string }>;
}

// type
interface TypeListing extends ObjectQueryBase {
  type: string; name?: string; count: number;
  keys: number[];          // capped to 300
  truncated?: boolean;
}

// key
interface Block extends ObjectQueryBase {
  key: number; type: string; name?: string;
  byteOffset: number;
  sizeWords: number;
  words: Array<[number, string, string?]>; // [index, hex value, what it names]; capped to 128
  referencedBy: Array<{ key: number; type: string; word: number }>; // capped to 50
  truncated?: boolean;
}

// attachment
interface AttachmentContent extends ObjectQueryBase {
  name: string; class?: string; bytes: number; savedAt?: string;
  encoding: "text" | "zip" | "zlib" | "binary";
  text?: string;           // printable payloads, capped to 20,000 characters
  truncated?: boolean;
}
```

## Notes

- A word is resolved when its value is a block key or a string id; a coordinate or count can coincide with one, so a resolution is a lead, not a fact. `referencedBy` has the same caveat.
