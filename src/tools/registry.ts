/**
 * The shape every tool shares: the MCP server registers it, and the command
 * line runs it under its name with flags built from its input schema.
 */

import type { z } from "zod";

export interface ToolDefinition<S extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: S;
  readonly run: (args: z.output<z.ZodObject<S>>) => Promise<unknown>;
}

/** Type a tool's definition, inferring its arguments from its schema. */
export const defineTool = <S extends z.ZodRawShape>(tool: ToolDefinition<S>): ToolDefinition<S> =>
  tool;
