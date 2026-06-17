import { describe, it, expect } from "vitest";
import { parsePackageRef } from "./package-parser.js";

describe("parsePackageRef", () => {
  // ---------------------------------------------------------------------------
  // Full Cadence format: FAMILY<pins>C<pitch>P<cols>X<rows>_<W>X<H>X<height>
  // ---------------------------------------------------------------------------
  it("parses full Cadence BGA string", () => {
    const result = parsePackageRef("BGA256C80P17X17_1500X1500X185");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("BGA");
    expect(result!.pinCount).toBe(256);
    expect(result!.pitch_mm).toBeCloseTo(0.8);
    expect(result!.bodySize_mm).toEqual({ width: 15, height: 15 });
    expect(result!.ballHeight_mm).toBeCloseTo(1.85);
  });

  it("parses QFP format", () => {
    const result = parsePackageRef("QFP64C50P12X12_1000X1000X160");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("QFP");
    expect(result!.pinCount).toBe(64);
    expect(result!.pitch_mm).toBeCloseTo(0.5);
    expect(result!.bodySize_mm).toEqual({ width: 10, height: 10 });
  });

  it("parses QFN format", () => {
    const result = parsePackageRef("QFN48C50P7X7_700X700X90");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("QFN");
    expect(result!.pinCount).toBe(48);
    expect(result!.pitch_mm).toBeCloseTo(0.5);
    expect(result!.bodySize_mm).toEqual({ width: 7, height: 7 });
    expect(result!.ballHeight_mm).toBeCloseTo(0.9);
  });

  // ---------------------------------------------------------------------------
  // Simple format: FAMILY<pins> or FAMILY<pins>_suffix
  // ---------------------------------------------------------------------------
  it("parses simple BGA with pin count", () => {
    const result = parsePackageRef("BGA256_1MM");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("BGA");
    expect(result!.pinCount).toBe(256);
    expect(result!.pitch_mm).toBeUndefined();
    expect(result!.bodySize_mm).toBeUndefined();
  });

  it("parses whitelisted IC family with a true pin count (SOIC8)", () => {
    const result = parsePackageRef("SOIC8");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("SOIC");
    expect(result!.pinCount).toBe(8);
  });

  // ---------------------------------------------------------------------------
  // Chip passives and JEDEC-coded families: the trailing digits are a case-size
  // or package code, NOT a pin count. The family is surfaced but pinCount is
  // left undefined for the caller to derive from geometry (issue #38).
  // ---------------------------------------------------------------------------
  it("does not treat a chip-resistor case size as a pin count", () => {
    const result = parsePackageRef("RES0402");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("RES");
    expect(result!.pinCount).toBeUndefined();
  });

  it("does not treat chip cap / inductor / ferrite case sizes as pin counts", () => {
    for (const [ref, family] of [
      ["CAP0402", "CAP"],
      ["C0402", "C"],
      ["IND0201", "IND"],
      ["INDP0603", "INDP"],
      ["F0603", "F"],
    ] as const) {
      const result = parsePackageRef(ref);
      expect(result).not.toBeNull();
      expect(result!.packageFamily).toBe(family);
      expect(result!.pinCount).toBeUndefined();
    }
  });

  it("does not treat a SOT JEDEC code as a pin count", () => {
    const result = parsePackageRef("SOT23");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("SOT");
    expect(result!.pinCount).toBeUndefined();
  });

  it("does not treat CAPAE body dimensions as a pin count", () => {
    const result = parsePackageRef("CAPAE660X610");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("CAPAE");
    expect(result!.pinCount).toBeUndefined();
  });

  it("surfaces the family even when the name has no trailing digits", () => {
    const result = parsePackageRef("DIODEM");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("DIODEM");
    expect(result!.pinCount).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  it("returns null for empty string", () => {
    expect(parsePackageRef("")).toBeNull();
  });

  it("returns null for pure numeric string", () => {
    expect(parsePackageRef("12345")).toBeNull();
  });

  it("returns null for unrecognized format", () => {
    expect(parsePackageRef("_CUSTOM_")).toBeNull();
  });

  it("handles case-insensitive input", () => {
    const result = parsePackageRef("bga256c80p17x17_1500x1500x185");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("BGA");
    expect(result!.pinCount).toBe(256);
  });
});
