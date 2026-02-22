/**
 * TypeScript type definitions for IPC-2581 PCB layout analysis.
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
 * Combined component result (placement + BOM).
 */
export interface ComponentResult {
  refdes: string;
  packageRef: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  mountType?: string;
  description?: string;
  characteristics: Record<string, string>;
}

/**
 * Result from query_components tool.
 */
export interface QueryComponentsResult {
  pattern: string;
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
}

/**
 * Via info for a net.
 */
export interface NetViaInfo {
  padstackRef: string;
  count: number;
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
 * Result from query_net tool.
 */
export interface QueryNetResult {
  netName: string;
  units: string;
  pins: NetPin[];
  routing: NetRouteInfo[];
  vias: NetViaInfo[];
  totalSegments: number;
  totalVias: number;
  layersUsed: string[];
}
