/**
 * Cadence Constraint Manager databases stored as zip archives of XML.
 *
 * A `.dcf` file is one such archive. An Allegro `.brd` file embeds several
 * (a physical database, a technology "Attach" and sometimes a logical view),
 * each starting with a `FileType.txt` member. The object files
 * (`objects/PhysicalCSet.xml`, `objects/MatchGroup.xml`, ...) are single-line
 * XML; see docs/allegro-brd-format.md for the schema.
 */

import { inflateRawSync } from "node:zlib";
import type { ConstraintObject, CrossSectionLayer } from "./types.js";

export interface ZipMember {
  name: string;
  data: Buffer;
}

export interface CmArchive {
  fileType: string; // "Design" or "Attach"
  key?: string; // "physical" or "logical" (Header.xml)
  units?: string; // precision units declared by Header.xml
  prefix: string; // member path prefix, "" for a top-level archive
  objects: Map<string, string>; // section name -> XML text
}

const LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Inflate limits: the largest Constraint Manager member seen is tens of MB
const MAX_ENTRY_BYTES = 256 * 2 ** 20;
const MAX_TOTAL_BYTES = 1024 * 2 ** 20;

/** Every zip local-file entry in a buffer, in file order. */
export const scanZipMembers = (buf: Buffer): ZipMember[] => {
  const out: ZipMember[] = [];
  let budget = MAX_TOTAL_BYTES;
  let p = buf.indexOf(LOCAL_HEADER);
  while (p >= 0 && p + 30 <= buf.length && budget > 0) {
    const flags = buf.readUInt16LE(p + 6);
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const unpacked = buf.readUInt32LE(p + 22);
    const nameLen = buf.readUInt16LE(p + 26);
    const start = p + 30 + nameLen + buf.readUInt16LE(p + 28);
    let next = p + 4;
    // shortcut: entries with a trailing data descriptor (flag bit 3) carry no size here and are
    // skipped; Allegro and Constraint Manager write none. Read the central directory if one appears.
    if (!(flags & 8) && (method === 0 || method === 8) && start + size <= buf.length) {
      const raw = buf.subarray(start, start + size);
      try {
        // capped at the header's size, an absolute limit and a budget for the whole file
        const limit = Math.max(1, Math.min(unpacked, MAX_ENTRY_BYTES, budget));
        const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: limit }) : raw;
        budget -= method === 8 ? data.length : 0;
        out.push({ name: buf.toString("latin1", p + 30, p + 30 + nameLen), data });
        // skip a member only once inflating proved it real; a stored one is unverified
        if (method === 8) next = start + size;
      } catch {
        // not a real entry: the signature bytes occurred inside binary data
      }
    }
    p = buf.indexOf(LOCAL_HEADER, next);
  }
  return out;
};

// Component data, not constraints; large and skipped
const SKIPPED_OBJECTS = new Set(["Gate", "Part", "PartDefn", "Pin", "DesignInstance"]);

/** Group zip members into Constraint Manager archives (each starts at a FileType.txt). */
export const groupCmArchives = (members: ZipMember[]): CmArchive[] => {
  const archives: CmArchive[] = [];
  let cur: CmArchive | undefined;
  for (const m of members) {
    const base = m.name.slice(m.name.lastIndexOf("/") + 1);
    if (base === "FileType.txt") {
      cur = {
        fileType: m.data.toString("latin1").trim(),
        prefix: m.name.slice(0, m.name.length - base.length),
        objects: new Map(),
      };
      archives.push(cur);
      continue;
    }
    if (!cur || !m.name.startsWith(cur.prefix)) continue;
    const rel = m.name.slice(cur.prefix.length);
    if (rel === "Header.xml") {
      const t = m.data.toString("utf8");
      cur.key = /Key="(\w+)"/.exec(t)?.[1];
      cur.units = /precision units="(\w+)"/.exec(t)?.[1];
    } else if (rel.startsWith("objects/") && rel.endsWith(".xml")) {
      const section = rel.slice(8, -4);
      if (!SKIPPED_OBJECTS.has(section)) cur.objects.set(section, m.data.toString("utf8"));
    }
  }
  return archives;
};

// Kind codes of <r>, <m>, <c> and <p> elements, observed against the object each one names
const KIND_NAMES: Record<string, string> = {
  "8": "Pin",
  "9": "Xnet",
  "10": "Net",
  "11": "Layer",
  "14": "ElectricalCSet",
  "18": "DiffPair",
  "20": "PinPair",
  "21": "MatchGroup",
  "24": "MatchGroup",
  "25": "PinPair",
  "39": "PhysicalCSet",
  "40": "SpacingCSet",
  "46": "SameNetSpacingCSet",
};
const kindName = (k: string | undefined): string => (k ? (KIND_NAMES[k] ?? k) : "");

/** `@lib.lib(sch_1):\DEFAULT\` -> `DEFAULT`; plain names pass through. */
export const shortName = (s: string): string => {
  const parts = s.split("\\").filter(Boolean);
  return s.includes("\\") && parts.length > 1 ? parts[parts.length - 1] : s;
};

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const parseAttrs = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z_]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
};

type Frame =
  | { tag: "object"; obj: ConstraintObject }
  | { tag: "layer"; layer: CrossSectionLayer; t?: string }
  | { tag: "attr"; name: string }
  | { tag: "children"; kind: string }
  | { tag: "xsection"; obj: ConstraintObject }
  | { tag: "other" };

/**
 * Parse one Constraint Manager object file (`objects/<Section>.xml`).
 *
 * `<o N>` is an object, `<a N><v V G/></a>` an attribute, `<r>` a reference,
 * `<m>` a member, `<c K>` a container of child objects, and `<xs><c P T B>`
 * the stackup cross-section of the Design object.
 */
export const parseCmObjects = (xml: string): ConstraintObject[] => {
  const objects: ConstraintObject[] = [];
  const stack: Frame[] = [];
  const nearest = <T extends Frame["tag"]>(tag: T) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag === tag) return stack[i] as Extract<Frame, { tag: T }>;
    }
    return undefined;
  };
  const owner = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (f.tag === "object" || f.tag === "layer") return f;
    }
    return undefined;
  };

  for (const m of xml.matchAll(/<(\/?)([A-Za-z]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const [, closing, tag, rest, selfClosing] = m;
    if (closing) {
      const f = stack.pop();
      if (f?.tag === "layer") {
        f.layer.type = f.layer.attributes.CDS_LAYER_FUNCTION ?? f.t ?? "";
        nearest("xsection")?.obj.crossSection?.layers.push(f.layer);
      }
      continue;
    }
    const a = parseAttrs(rest);
    const top = stack[stack.length - 1];
    let frame: Frame = { tag: "other" };

    if (tag === "o" && a.N !== undefined) {
      const obj: ConstraintObject = {
        name: shortName(a.N),
        attributes: {},
        references: [],
        members: [],
      };
      if (top?.tag === "children") {
        obj.kind = top.kind;
        const parent = nearest("object")?.obj;
        (parent ? (parent.children ??= []) : objects).push(obj);
      } else {
        objects.push(obj);
      }
      frame = { tag: "object", obj };
    } else if (tag === "o" && a.T !== undefined && top?.tag === "xsection") {
      frame = { tag: "layer", layer: { type: "", attributes: {} }, t: a.T };
    } else if (tag === "a" && a.N !== undefined) {
      frame = { tag: "attr", name: a.N };
    } else if (tag === "v" && top?.tag === "attr") {
      const target = owner();
      const value = a.V ?? a.G ?? "";
      if (target?.tag === "object") {
        target.obj.attributes[top.name] = { value, ...(a.G !== undefined ? { generic: a.G } : {}) };
      } else if (target?.tag === "layer") {
        target.layer.attributes[top.name] = value;
      }
    } else if ((tag === "r" || tag === "m") && a.N !== undefined && top?.tag === "object") {
      (tag === "r" ? top.obj.references : top.obj.members).push({
        kind: kindName(a.K),
        name: shortName(a.N),
      });
    } else if (tag === "xs" && top?.tag === "object") {
      frame = { tag: "xsection", obj: top.obj };
    } else if (tag === "c" && top?.tag === "xsection") {
      top.obj.crossSection = {
        ...(a.P !== undefined ? { primaryStackup: a.P } : {}),
        ...(a.T !== undefined ? { topIndex: Number(a.T) } : {}),
        ...(a.B !== undefined ? { bottomIndex: Number(a.B) } : {}),
        layers: [],
      };
      frame = { tag: "xsection", obj: top.obj };
    } else if (tag === "c") {
      frame = { tag: "children", kind: kindName(a.K) };
    }

    if (!selfClosing) stack.push(frame);
  }
  return objects;
};
