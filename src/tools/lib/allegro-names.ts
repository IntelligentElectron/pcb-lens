/**
 * Names of Allegro layer classes and of their built-in subclasses. A layered block holds a class
 * (byte 2) and a subclass (byte 3); user subclasses index the class's 0x2A list from 0, built-in
 * ones are the top n codes ending at 0xFD, n being the class's built-in count in the header.
 * Built-in names are not stored in the file.
 */

import { FIELD_NAMES } from "./allegro-brd.js";

export const CLASS_NAMES: Record<number, string> = {
  1: "BOARD_GEOMETRY",
  2: "COMPONENT_VALUE",
  3: "DEVICE_TYPE",
  4: "DRAWING_FORMAT",
  5: "DRC_ERROR",
  6: "ETCH",
  7: "MANUFACTURING",
  8: "ANALYSIS",
  9: "PACKAGE_GEOMETRY",
  10: "PACKAGE_KEEPIN",
  11: "PACKAGE_KEEPOUT",
  12: "PIN",
  13: "REF_DES",
  14: "ROUTE_KEEPIN",
  15: "ROUTE_KEEPOUT",
  16: "TOLERANCE",
  17: "USER_PART_NUMBER",
  18: "VIA_CLASS",
  19: "VIA_KEEPOUT",
  20: "ANTI_ETCH",
  21: "BOUNDARY",
  22: "CONSTRAINT_REGION",
  26: "RIGID_FLEX",
};

// built-in subclass names from 0xFD downwards
const LABELS = [
  "ASSEMBLY_TOP",
  "ASSEMBLY_BOTTOM",
  "SILKSCREEN_TOP",
  "SILKSCREEN_BOTTOM",
  "DISPLAY_TOP",
  "DISPLAY_BOTTOM",
];
const MASKS = [
  "SOLDERMASK_TOP",
  "SOLDERMASK_BOTTOM",
  "PASTEMASK_TOP",
  "PASTEMASK_BOTTOM",
  "FILMMASKTOP",
  "FILMMASKBOTTOM",
];
const BUILT_IN: Record<number, string[]> = {
  1: [
    "OUTLINE",
    "PLATING_BAR",
    "ASSEMBLY_NOTES",
    "TOOLING_CORNERS",
    "DIMENSION",
    "PLACE_GRID_TOP",
    "PLACE_GRID_BOTTOM",
    "TOP_ROOM",
    "BOTTOM_ROOM",
    "BOTH_ROOMS",
    "SWITCH_AREA_TOP",
    "SWITCH_AREA_BOTTOM",
    "SILKSCREEN_TOP",
    "SILKSCREEN_BOTTOM",
    "ASSEMBLY_DETAIL",
    "SOLDERMASK_TOP",
    "SOLDERMASK_BOTTOM",
    "OFF_GRID_AREA",
    "WB_GUIDE_LINE",
    "DESIGN_OUTLINE",
    "CUTOUT",
  ],
  2: LABELS,
  3: LABELS,
  4: ["OUTLINE", "TITLE_BLOCK", "TITLE_DATA", "REVISION_BLOCK", "REVISION_DATA", "DRAWING_ORIGIN"],
  5: ["ALL"],
  7: [
    "PHOTOPLOT_OUTLINE",
    "NO_GLOSS_ALL",
    "NO_GLOSS_TOP",
    "NO_GLOSS_BOTTOM",
    "NO_GLOSS_INTERNAL",
    "NCDRILL_LEGEND",
    "NCDRILL_FIGURE",
    "PROBE_TOP",
    "PROBE_BOTTOM",
    "AUTOSILK_TOP",
    "AUTOSILK_BOTTOM",
    "NO_PROBE_TOP",
    "NO_PROBE_BOTTOM",
    "XSECTION_CHART",
  ],
  8: [
    "LOW_ISOCONTOUR",
    "MEDIUM1_ISOCONTOUR",
    "MEDIUM2_ISOCONTOUR",
    "MEDIUM3_ISOCONTOUR",
    "HIGH_ISOCONTOUR",
    "PCB_TEMPERATURE",
  ],
  9: [
    "ASSEMBLY_TOP",
    "ASSEMBLY_BOTTOM",
    "PLACE_BOUND_TOP",
    "PLACE_BOUND_BOTTOM",
    "PIN_NUMBER",
    "PAD_STACK_NAME",
    "SILKSCREEN_TOP",
    "SILKSCREEN_BOTTOM",
    "BODY_CENTER",
    "SOLDERMASK_TOP",
    "SOLDERMASK_BOTTOM",
    "DISPLAY_TOP",
    "DISPLAY_BOTTOM",
    "MODULES",
    "DFA_BOUND_TOP",
    "DFA_BOUND_BOTTOM",
    "PASTEMASK_TOP",
    "PASTEMASK_BOTTOM",
    "MODEL_OUTLINE",
  ],
  10: ["ALL"],
  11: ["ALL", "TOP", "BOTTOM"],
  12: MASKS,
  13: LABELS,
  14: ["ALL"],
  15: ["ALL"],
  16: LABELS,
  17: LABELS,
  18: MASKS,
  19: ["ALL"],
  20: ["ALL"],
  22: ["ALL", "OUTER_LAYERS", "INNER_SIGNAL_LAYERS", "INNER_PLANE_LAYERS"],
  26: [
    "ZONE_OUTLINE",
    "BEND_AREA",
    "BEND_LINE",
    "TRANSITION_ZONE",
    "COVERLAY_TOP",
    "COVERLAY_BOTTOM",
    "EMI_SHIELD_TOP",
    "EMI_SHIELD_BOTTOM",
    "STIFFENER_TOP",
    "STIFFENER_BOTTOM",
    "STIFFENER_METAL_TOP",
    "STIFFENER_METAL_BOTTOM",
  ],
};

export const className = (c: number) => CLASS_NAMES[c] ?? `CLASS_${c}`;

/**
 * A subclass name: entry `s` of the class's list for a user subclass, the built-in name for a top
 * code (by number when it has no known name), or undefined for a deleted subclass.
 */
export const subclassName = (c: number, s: number, list: string[], builtIns: number) => {
  if (s < list.length) return list[s];
  if (s > 0xfd || s < 0xfe - builtIns) return undefined;
  return BUILT_IN[c]?.[0xfd - s] ?? `0x${s.toString(16).toUpperCase()}`;
};

/**
 * Names of 0x03 property codes: the constraint fields, Allegro's names for the other known codes,
 * and a descriptive name for codes whose role is known but whose Allegro name is not. User
 * properties (16000 and up) are named by the board's own dictionary.
 */
export const PROPERTY_NAMES: Record<number, string> = {
  ...FIELD_NAMES,
  0x02: "VALUE",
  0x05: "PART_NUMBER",
  0x18: "ALT_FOOTPRINTS",
  0x27: "VOLTAGE",
  0x4d: "PADSTACK_FILE",
  0x79: "MAX_VIA_COUNT",
  0x7a: "DIFFERENTIAL_PAIR",
  0xc4: "DEVICE_CLASS",
  0x10f: "PACKAGE_HEIGHT_MIN",
  0x110: "PACKAGE_HEIGHT_MAX",
  0x119: "DFA_DEV_CLASS",
  0x11e: "TOTAL_ETCH_LENGTH",
  0x14a: "LAST_MODIFIED",
  0x168: "DYN_FIXED_THERM_WIDTH",
  0x1fb: "MAXIMUM_NECK_LENGTH",
  0x228: "SN_SHAPE_TO_SMDPIN_SPACING",
  0x250: "MECH_PIN_TO_MECH_PIN_SPACING",
  0x261: "MECH_PIN_TO_CONDUCTOR_SPACING",
  0x26d: "MVIA_TO_LINE_SPACING",
  0x296: "NAME",
  0x2dc: "LAST_MODIFIED_BY",
  0x2f8: "MIN_METAL_SPACING",
  0x345: "MODEL_3D",
  0x354: "MINIMUM_LINE_TO_LINE_ANGLE",
  0x355: "MINIMUM_LINE_TO_SHAPE_ANGLE",
  0x356: "MINIMUM_LINE_TO_PAD_ANGLE",
  0x357: "MINIMUM_SHAPE_EDGE_ANGLE",
  0x389: "CDS_DI_CONTROL_MASK",
  0x794: "DFF_MAX_VIA_ALGN_TOL",
  0x8c8: "MAX_RSS_FIBERWEAVE_ANGLE",
  0x8c9: "MAX_RSS_FIBERWEAVE_IGNORE_LEN",
  0x8d0: "DP_PHASE_TUNE_LEN_TOL",
  0x8d1: "DP_PHASE_TUNE_SPC_TOL",
  0x8d2: "DP_PHASE_TUNE_ANG_TOL",
};
