/**
 * The query command line: every registry tool as a subcommand under its MCP
 * name, with flags named as its schema's arguments, which the MCP server
 * registers too.
 *
 *   pcb-lens get_pcb_net board.xml --pattern '^DDR_D'
 *   pcb-lens get_constraints --file board.brd --section BrdStackup
 *
 * The flags are built from each tool's schema, so the command line takes the
 * same arguments as the MCP tool and applies the same defaults. A string or
 * number flag takes the next token or `=value`; a value starting with a dash
 * needs `=`. A boolean flag alone means true, and takes `true` or `false` after
 * it or after `=`. An array flag repeats. The file the tool reads (`file` or
 * `board`) may also come first, as a positional argument.
 *
 * The result is the tool's JSON on stdout, indented on a terminal and compact
 * otherwise. A result with an `error` field exits 1; a usage error prints to
 * stderr with the tool's usage line and exits 2.
 */

import { z } from "zod";
import { BINARY_NAME } from "./version.js";
import { TOOLS, findTool, type AnyToolDefinition } from "../tools/index.js";
import { isErrorResult } from "../tools/lib/types.js";

// =============================================================================
// Flags from a schema
// =============================================================================

export type FlagKind = "string" | "number" | "boolean" | "array";

export interface FlagSpec {
  readonly name: string;
  readonly kind: FlagKind;
  readonly required: boolean;
  readonly description?: string;
  readonly default?: unknown;
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
}

/** A tool's flags, in its schema's order, from the schema's input JSON Schema. */
export const flagsOf = (tool: AnyToolDefinition): FlagSpec[] => {
  const schema = z.toJSONSchema(z.object(tool.inputSchema), { io: "input" }) as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    kind:
      property.type === "array"
        ? "array"
        : property.type === "boolean"
          ? "boolean"
          : property.type === "integer" || property.type === "number"
            ? "number"
            : "string",
    required: required.has(name),
    ...(property.description !== undefined ? { description: property.description } : {}),
    ...(property.default !== undefined ? { default: property.default } : {}),
  }));
};

/** The argument naming the file a tool reads, which may come first without its flag. */
export const positionalOf = (tool: AnyToolDefinition): string | undefined =>
  ["file", "board"].find((name) => name in tool.inputSchema);

// =============================================================================
// Parsing
// =============================================================================

/** What a tool's command line asks for. */
export type ParsedQuery =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly args: Record<string, unknown> }
  | { readonly kind: "usage"; readonly message: string };

const BOOLEAN_WORDS: Record<string, boolean> = { true: true, false: false };

/** A number in the form a person types: an optional sign, digits, an optional fraction. */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Parse the tokens after a tool's name. Errors name the flag and say how to
 * write it; they are usage errors, and nothing runs.
 */
export const parseQueryArgs = (tool: AnyToolDefinition, tokens: readonly string[]): ParsedQuery => {
  if (tokens.some((token) => token === "--help" || token === "-h")) return { kind: "help" };

  const flags = new Map(flagsOf(tool).map((flag) => [flag.name, flag]));
  const positional = positionalOf(tool);
  const args: Record<string, unknown> = {};
  const usage = (message: string): ParsedQuery => ({ kind: "usage", message });

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token.startsWith("-") || token === "-") {
      // The one positional argument is the file, and only in first place.
      if (i === 0 && positional) {
        args[positional] = token;
        continue;
      }
      return usage(
        positional
          ? `Unexpected argument '${token}'. Only --${positional} may be given without a flag, and only first.`
          : `Unexpected argument '${token}'. ${tool.name} takes only flags.`
      );
    }

    if (!token.startsWith("--")) {
      return usage(
        `Unknown flag '${token}'. Flags are spelled --name, as the tool's arguments are.`
      );
    }

    const equals = token.indexOf("=");
    const name = token.slice(2, equals === -1 ? undefined : equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);

    const flag = flags.get(name);
    if (!flag) {
      const suggestion = flags.has(name.replace(/-/g, "_"))
        ? ` Did you mean --${name.replace(/-/g, "_")}?`
        : "";
      return usage(`Unknown flag '--${name}'.${suggestion}`);
    }
    if (flag.kind !== "array" && name in args) {
      return usage(
        name === positional
          ? `The ${name} is given twice. Give it first or as --${name}, once.`
          : `--${name} is given twice. Only an array flag repeats.`
      );
    }

    // The flag's text: after `=`, or the next token when the kind takes one.
    let text = inline;
    if (text === undefined) {
      const next = tokens[i + 1];
      if (flag.kind === "boolean") {
        if (next !== undefined && next in BOOLEAN_WORDS) {
          args[name] = BOOLEAN_WORDS[next];
          i++;
        } else {
          args[name] = true;
        }
        continue;
      }
      if (next === undefined) return usage(`--${name} needs a value.`);
      if (next.startsWith("-")) {
        return usage(
          `--${name} needs a value, and '${next}' starts with a dash. Write --${name}=${next} for a value that does.`
        );
      }
      text = next;
      i++;
    }

    switch (flag.kind) {
      case "boolean":
        if (!(text in BOOLEAN_WORDS)) return usage(`--${name} takes true or false, not '${text}'.`);
        args[name] = BOOLEAN_WORDS[text];
        break;
      case "number":
        if (!NUMBER.test(text)) return usage(`--${name} takes a number, not '${text}'.`);
        args[name] = Number(text);
        break;
      case "array":
        args[name] = [...((args[name] as string[] | undefined) ?? []), text];
        break;
      default:
        args[name] = text;
    }
  }

  return { kind: "run", args };
};

// =============================================================================
// Help
// =============================================================================

const placeholder = (flag: FlagSpec): string =>
  flag.kind === "boolean" ? "" : flag.kind === "number" ? " <number>" : " <text>";

/** One line naming the tool and its flags, required ones bare and the rest in brackets. */
export const usageLine = (tool: AnyToolDefinition): string => {
  const positional = positionalOf(tool);
  const parts = [`${BINARY_NAME} ${tool.name}`];
  if (positional) parts.push(`<${positional}>`);
  for (const flag of flagsOf(tool)) {
    if (flag.name === positional) continue;
    const text = `--${flag.name}${placeholder(flag)}${flag.kind === "array" ? " ..." : ""}`;
    parts.push(flag.required ? text : `[${text}]`);
  }
  return parts.join(" ");
};

/** A tool's description and every flag, from the registry. */
export const toolHelp = (tool: AnyToolDefinition): string => {
  const lines = [`Usage: ${usageLine(tool)}`, "", tool.description, "", "Flags:"];
  for (const flag of flagsOf(tool)) {
    const notes: string[] = [];
    if (flag.required) notes.push("required");
    if (flag.kind === "array") notes.push("repeat for more than one");
    if (flag.kind === "boolean") notes.push("alone means true");
    if (flag.default !== undefined) notes.push(`default ${JSON.stringify(flag.default)}`);
    if (flag.name === positionalOf(tool)) notes.push("may be given first, without the flag");
    lines.push(`  --${flag.name}${placeholder(flag)}`);
    if (flag.description) lines.push(`      ${flag.description}`);
    if (notes.length > 0) lines.push(`      (${notes.join("; ")})`);
  }
  lines.push(
    "",
    "Prints the result as JSON on stdout. Exits 1 when the result has an error field,",
    "2 on a usage error."
  );
  return lines.join("\n");
};

/** The tools `--help` prints. */
export const toolList = (): string =>
  TOOLS.map((tool) => `  ${tool.name.padEnd(30)}${tool.title}`).join("\n");

// =============================================================================
// Running
// =============================================================================

/** What a call prints and how it exits. */
export interface QueryOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Why the call failed, for telemetry. */
  readonly errorMessage?: string;
}

/** Run a tool's command line. */
export const runQuery = async (
  tool: AnyToolDefinition,
  tokens: readonly string[],
  options: { isTTY: boolean }
): Promise<QueryOutcome> => {
  const parsed = parseQueryArgs(tool, tokens);
  if (parsed.kind === "help") return { exitCode: 0, stdout: toolHelp(tool) };

  const usageError = (message: string): QueryOutcome => ({
    exitCode: 2,
    stderr: `error: ${message}\nusage: ${usageLine(tool)}\nRun '${BINARY_NAME} ${tool.name} --help' for every flag.`,
    errorMessage: message,
  });
  if (parsed.kind === "usage") return usageError(parsed.message);

  const checked = z.object(tool.inputSchema).safeParse(parsed.args);
  if (!checked.success) {
    return usageError(
      checked.error.issues
        .map((issue) => {
          const at = issue.path.length > 0 ? `--${issue.path.join(".")}: ` : "";
          return issue.code === "invalid_type" && issue.input === undefined
            ? `${at}required`
            : `${at}${issue.message}`;
        })
        .join("; ")
    );
  }

  let result: unknown;
  try {
    result = await tool.run(checked.data);
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  const json = options.isTTY ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  return {
    exitCode: isErrorResult(result) ? 1 : 0,
    stdout: json,
    ...(isErrorResult(result) ? { errorMessage: result.error } : {}),
  };
};

/** The registry tool a command-line word names, if any. */
export const toolNamed = (word: string | undefined): AnyToolDefinition | undefined =>
  word === undefined ? undefined : findTool(word);
