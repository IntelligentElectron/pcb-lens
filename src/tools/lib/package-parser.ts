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
  pinCount: number;
  bodySize_mm?: { width: number; height: number };
  pitch_mm?: number;
  ballHeight_mm?: number;
  ubmDiameter_mm?: number;
}

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

// Simpler variant: BGA256_1MM or PKG123 (family + pin count only)
const CADENCE_SIMPLE = /^([A-Z]+?)(\d+)/i;

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
    const pinCount = parseInt(pins, 10);
    if (pinCount > 0) {
      return {
        packageFamily: family.toUpperCase(),
        pinCount,
      };
    }
  }

  return null;
};
