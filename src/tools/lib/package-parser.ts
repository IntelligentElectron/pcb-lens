/**
 * Best-effort parser for Cadence footprint naming conventions.
 *
 * Cadence uses 'P' as a decimal separator in footprint names. For example:
 *   BGA256C80P17X17_1500X1500X185 means:
 *     - BGA family, 256 pins
 *     - 80 = 0.80mm pitch (C80 prefix, P as decimal)
 *     - 17x17 ball array
 *     - 1500x1500 = 15.00mm body, 185 = 1.85mm height
 *
 * This is NOT standardized across all organizations, so the parser
 * returns null for unrecognized formats.
 */

export interface ParsedPackage {
  packageFamily: string;
  /**
   * Pin/pad count, only when the package name is an authoritative source for it.
   * The full Cadence format encodes it explicitly; for the simple format it is
   * trusted only for families where the leading number is genuinely a pin/ball
   * count (see PIN_COUNT_FAMILIES). For chip passives (RES/CAP/IND/INDP) and
   * packages like SOT/CAPAE the trailing digits are an imperial case-size or
   * JEDEC code, not a pin count, so this is left undefined and the caller should
   * derive the count from pad/net geometry instead.
   */
  pinCount?: number;
  bodySize_mm?: { width: number; height: number };
  pitch_mm?: number;
  ballHeight_mm?: number;
  ubmDiameter_mm?: number;
}

/**
 * Families where the digits immediately after the family prefix in the simple
 * footprint name denote the pin/ball count (e.g. BGA256, QFN48, SOIC8).
 *
 * Deliberately excludes chip passives (RES/CAP/IND/INDP/FER/FB) and families
 * whose trailing number is a case-size or JEDEC package code rather than a pin
 * count (e.g. SOT23, CAPAE). For those the count must come from pad/net geometry.
 */
const PIN_COUNT_FAMILIES = new Set([
  "BGA",
  "CBGA",
  "PBGA",
  "FBGA",
  "UBGA",
  "WLCSP",
  "CSP",
  "QFN",
  "VQFN",
  "QFP",
  "TQFP",
  "LQFP",
  "MQFP",
  "DFN",
  "SON",
  "LGA",
  "SOIC",
  "SOP",
  "SSOP",
  "TSSOP",
  "TSOP",
  "MSOP",
  "HSOP",
  "DIP",
  "PLCC",
]);

/**
 * Convert a Cadence P-as-decimal number to a real number.
 * "80" -> 0.80, "1500" -> 15.00, "65" -> 0.65
 *
 * The convention: the number is in units of 0.01mm (hundredths of a mm).
 */
const cadenceToMm = (raw: string): number => parseInt(raw, 10) / 100;

// Matches patterns like: BGA256C80P17X17_1500X1500X185
//   group 1: family (BGA, QFP, QFN, SOP, SOT, CAPAE, etc.)
//   group 2: pin count
//   group 3: pitch (the number after C and before P or X)
//   group 4: body width (after underscore)
//   group 5: body height (after X)
//   group 6: component height (after second X)
const CADENCE_FULL = /^([A-Z]+?)(\d+)C(\d+)P\d+X\d+_(\d+)X(\d+)X(\d+)$/i;

// Simpler variant: BGA256_1MM or PKG123 (family + trailing number)
const CADENCE_SIMPLE = /^([A-Z]+?)(\d+)/i;

// Family token only, no trailing digits (e.g. DIODEM, TESTPOINT)
const FAMILY_ONLY = /^([A-Za-z]+)/;

export const parsePackageRef = (packageRef: string): ParsedPackage | null => {
  const fullMatch = CADENCE_FULL.exec(packageRef);
  if (fullMatch) {
    const [, family, pins, pitch, bodyW, bodyH, height] = fullMatch;
    return {
      packageFamily: family.toUpperCase(),
      pinCount: parseInt(pins, 10),
      pitch_mm: cadenceToMm(pitch),
      bodySize_mm: {
        width: cadenceToMm(bodyW),
        height: cadenceToMm(bodyH),
      },
      ballHeight_mm: cadenceToMm(height),
    };
  }

  const simpleMatch = CADENCE_SIMPLE.exec(packageRef);
  if (simpleMatch) {
    const [, family, pins] = simpleMatch;
    const fam = family.toUpperCase();
    const pinCount = parseInt(pins, 10);
    // Only trust the trailing number as a pin count for families where it
    // genuinely encodes one. For everything else (chip passives, SOT, CAPAE,
    // ...) surface the family but leave pinCount for geometry to determine.
    if (PIN_COUNT_FAMILIES.has(fam) && pinCount > 0) {
      return { packageFamily: fam, pinCount };
    }
    return { packageFamily: fam };
  }

  // No trailing digits: still surface the family so `parsed` is emitted
  // consistently for every component (e.g. DIODEM, TESTPOINT).
  const familyOnly = FAMILY_ONLY.exec(packageRef);
  if (familyOnly) {
    return { packageFamily: familyOnly[1].toUpperCase() };
  }

  return null;
};
