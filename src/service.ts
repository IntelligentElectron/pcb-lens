/**
 * PCB Lens Service
 *
 * Public API for IPC-2581 PCB layout analysis.
 * All tool logic is exposed as standalone async functions for programmatic use.
 */

export { getDesignOverview } from "./tools/get-pcb-metadata.js";
export { queryComponents } from "./tools/get-pcb-components.js";
export { queryNet } from "./tools/get-pcb-net.js";
export { exportCadenceBoard } from "./tools/export-cadence-ipc2581.js";
export { exportCadenceConstraints } from "./tools/export-cadence-constraints.js";
export { queryConstraints } from "./tools/get-constraints.js";

// Re-export types that appear in public API signatures
export type {
  ErrorResult,
  DesignOverview,
  LayerInfo,
  SectionInfo,
  ComponentInfo,
  ComponentResult,
  QueryComponentsResult,
  NetPin,
  NetRouteInfo,
  ViaDrill,
  ViaRow,
  QueryNetResult,
  QueryNetsResult,
  CadenceInstall,
  ExportCadenceBoardResult,
  ExportCadenceConstraintsResult,
  ConstraintObject,
  CrossSection,
  CrossSectionLayer,
  ConstraintsOverviewResult,
  ConstraintsSectionResult,
} from "./tools/lib/types.js";

export { isErrorResult } from "./tools/lib/types.js";
