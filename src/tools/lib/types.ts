/**
 * TypeScript type definitions for IPC-2581 PCB layout analysis.
 *
 * IPC-2581 is an industry-standard XML format for PCB layout data. Key sections:
 * - Content: Dictionaries (line descriptors, pad shapes, colors)
 * - LogisticHeader: File metadata
 * - Bom: Bill of materials
 * - Ecad/CadData: Layer definitions, padstack definitions, package/footprint definitions
 * - Component (under Step): Component placement (x/y, rotation, layer)
 * - PhyNet: Physical net connectivity (pin connections)
 * - LayerFeature: Routing data (traces, vias, copper pours)
 */

/**
 * Error result structure.
 */
export interface ErrorResult {
  error: string;
}

/**
 * Type guard to check if result is an error.
 */
export const isErrorResult = (result: unknown): result is ErrorResult =>
  Boolean(result && typeof (result as ErrorResult).error === "string");

/**
 * Layer information from IPC-2581 stackup.
 */
export interface LayerInfo {
  name: string;
  side?: string;
  layerFunction?: string;
}

/**
 * Section size info for design overview.
 */
export interface SectionInfo {
  name: string;
  lineCount: number;
}

/**
 * Result from get_design_overview tool.
 */
export interface DesignOverview {
  fileName: string;
  fileSizeBytes: number;
  totalLines: number;
  units: string;
  ipc2581Revision?: string;
  stepName?: string;
  layers: LayerInfo[];
  componentCount: number;
  netCount: number;
  sections: SectionInfo[];
}

/**
 * Component placement information.
 */
export interface ComponentInfo {
  refdes: string;
  packageRef: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  mountType?: string;
}

/**
 * Parsed package/footprint information from Cadence naming conventions.
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
 * Unique pad shape definition, referenced by index from PadGeometry.
 */
export interface PadShape {
  shape: "rect" | "circle";
  width: number;
  height: number;
}

/**
 * Per-pin pad position, references a PadShape by index.
 */
export interface PadGeometry {
  pin: string;
  x: number;
  y: number;
  shapeIndex: number;
}

/**
 * Combined component result (placement + BOM).
 */
export interface ComponentResult {
  refdes: string;
  packageRef: string;
  parsed?: ParsedPackage;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  mountType?: string;
  description?: string;
  characteristics: Record<string, string>;
  nets: ComponentNetSummary[];
  padShapes?: PadShape[];
  pads?: PadGeometry[];
}

/**
 * Result from query_components tool.
 */
export interface QueryComponentsResult {
  pattern: string;
  package?: string;
  units: string;
  matches: ComponentResult[];
}

/**
 * Pin connection point on a net.
 */
export interface NetPin {
  refdes: string;
  pin: string;
}

/**
 * Routing segment info for a net.
 */
export interface NetRouteInfo {
  layerName: string;
  traceWidths: number[];
  segmentCount: number;
  traceLength: number;
}

/**
 * Individual via location on a net.
 */
export interface NetVia {
  x: number;
  y: number;
  drillDiameter: number;
  layer: string;
}

/**
 * Result from render_net tool.
 */
export interface RenderNetResult {
  netName: string;
  units: string;
  svg: string;
  stats: {
    traceCount: number;
    viaCount: number;
    pinCount: number;
    resolvedPads: number;
    layersUsed: string[];
  };
}

/**
 * Per-net result from query_net tool.
 */
export interface QueryNetResult {
  netName: string;
  pins: Record<string, string[]>;
  routing?: NetRouteInfo[];
  vias?: NetVia[];
  totalSegments?: number;
  totalVias?: number;
  totalTraceLength?: number;
  layersUsed: string[];
}

/**
 * Result from query_net tool (multi-match wrapper).
 */
export interface QueryNetsResult {
  pattern: string;
  units: string;
  matches: QueryNetResult[];
}

/**
 * Lightweight net summary for component net discovery.
 */
export interface ComponentNetSummary {
  netName: string;
  pins: string[];
  pinCount: number;
}

/**
 * Detected Cadence SPB installation.
 */
export interface CadenceInstall {
  version: string;
  root: string;
  exePath: string;
}

/**
 * Result from export_cadence_board tool.
 */
export interface ExportCadenceBoardResult {
  success: boolean;
  outputPath: string;
  revision: "B" | "C";
  cadenceVersion: string;
  log?: string;
}

/**
 * Result from export_cadence_constraints tool.
 */
export interface ExportCadenceConstraintsResult {
  success: boolean;
  outputPath: string;
  cadenceVersion: string;
  log?: string;
}

/**
 * Generic TCFX constraint object. Attribute names (MIN_LINE_WIDTH, LINE_TO_LINE,
 * etc.) carry domain semantics that the LLM interprets directly.
 */
export interface ConstraintObject {
  name: string;
  attributes: Record<string, { value: string; generic?: string }>;
  references: Array<{ kind: string; name: string }>;
  members: Array<{ kind: string; name: string }>;
  crossSection?: CrossSection;
}

/**
 * Stackup cross-section layer (nested inside Design section objects).
 */
export interface CrossSectionLayer {
  type: string; // Conductor, Dielectric, Mask, Surface
  attributes: Record<string, string>;
}

/**
 * Cross-section data from a Design section object.
 */
export interface CrossSection {
  primaryStackup?: string;
  topIndex?: number;
  bottomIndex?: number;
  layers: CrossSectionLayer[];
}

/**
 * Overview result from query_constraints (no section specified).
 */
export interface ConstraintsOverviewResult {
  fileName: string;
  fileSizeBytes: number;
  sections: Array<{ name: string; objectCount: number }>;
}

/**
 * Section query result from query_constraints.
 */
export interface ConstraintsSectionResult {
  fileName: string;
  section: string;
  objects: ConstraintObject[];
}
