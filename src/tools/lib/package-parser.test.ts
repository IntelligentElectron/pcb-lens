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

  it("parses simple resistor package", () => {
    const result = parsePackageRef("RES0402");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("RES");
    expect(result!.pinCount).toBe(402);
  });

  it("parses SOT with pin count", () => {
    const result = parsePackageRef("SOT23");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("SOT");
    expect(result!.pinCount).toBe(23);
  });

  it("parses CAPAE (aluminum electrolytic)", () => {
    const result = parsePackageRef("CAPAE660X610");
    expect(result).not.toBeNull();
    expect(result!.packageFamily).toBe("CAPAE");
    expect(result!.pinCount).toBe(660);
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
