/**
 * Every tool the MCP server registers and the command line runs, in the order
 * `--help` lists them.
 */

import type { ToolDefinition } from "./registry.js";
import { tool as getPcbMetadata } from "./get-pcb-metadata.js";
import { tool as getPcbComponent } from "./get-pcb-component.js";
import { tool as getPcbNet } from "./get-pcb-net.js";
import { tool as getPcbLayer } from "./get-pcb-layer.js";
import { tool as getConstraints } from "./get-constraints.js";
import { tool as exportCadenceIpc2581 } from "./export-cadence-ipc2581.js";
import { tool as exportCadenceConstraints } from "./export-cadence-constraints.js";

export type AnyToolDefinition = ToolDefinition;

export const TOOLS: readonly AnyToolDefinition[] = Object.freeze([
  getPcbMetadata,
  getPcbComponent,
  getPcbNet,
  getPcbLayer,
  getConstraints,
  exportCadenceIpc2581,
  exportCadenceConstraints,
] as unknown as AnyToolDefinition[]);

export const findTool = (name: string): AnyToolDefinition | undefined =>
  TOOLS.find((tool) => tool.name === name);
