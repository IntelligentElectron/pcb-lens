import { stat } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCadenceInstalls, requireWindows, serializeCadenceCall } from "./lib/cadence.js";
import type { ErrorResult, ExportCadenceConstraintsResult } from "./lib/types.js";
import { formatResult } from "./shared.js";
import { withTelemetry } from "../telemetry.js";

const execAsync = promisify(exec);

export const exportCadenceConstraints = async (
  brdPath: string,
  options?: { output?: string }
): Promise<ExportCadenceConstraintsResult | ErrorResult> => {
  const windowsError = requireWindows("Cadence constraint export");
  if (windowsError) return windowsError;

  const resolvedBrd = path.resolve(brdPath);
  if (!resolvedBrd.toLowerCase().endsWith(".brd")) {
    return { error: `Expected a .brd file, got: '${path.basename(resolvedBrd)}'` };
  }
  try {
    const s = await stat(resolvedBrd);
    if (!s.isFile()) {
      return { error: `'${resolvedBrd}' is not a file` };
    }
  } catch {
    return { error: `Board file not found: '${resolvedBrd}'` };
  }

  const installs = await detectCadenceInstalls("techfile.exe");
  if (installs.length === 0) {
    return {
      error:
        "No Cadence SPB installation with techfile.exe found in C:/Cadence. Ensure Cadence Allegro/OrCAD PCB Editor is installed.",
    };
  }
  const cadence = installs[0];

  const brdDir = path.dirname(resolvedBrd);
  const brdName = path.basename(resolvedBrd, ".brd");
  const outputPath = options?.output ?? path.join(brdDir, `${brdName}_constraints.tcfx`);

  const command = `"${cadence.exePath}" -w "${resolvedBrd}" "${outputPath}"`;

  return serializeCadenceCall(async () => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: brdDir,
        timeout: 120_000,
      });

      const log = (stdout + stderr).trim();

      if (log.includes("License checking failed")) {
        return {
          error: `Cadence license check failed. Ensure a valid Allegro license is available. Log: ${log}`,
        };
      }

      try {
        const outStat = await stat(outputPath);
        if (outStat.size < 100) {
          return {
            error: `Output file is suspiciously small (${outStat.size} bytes): '${outputPath}'`,
          };
        }
      } catch {
        return {
          error: `Export completed but output file not found: '${outputPath}'`,
        };
      }

      return {
        success: true,
        outputPath,
        cadenceVersion: cadence.version,
        log: log || undefined,
      };
    } catch (err: unknown) {
      const execError = err as { message?: string; stdout?: string; stderr?: string };
      const combinedLog = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
      return {
        error: `Cadence techfile failed: ${execError.message ?? "Unknown error"}${combinedLog ? `\nLog: ${combinedLog}` : ""}`,
      };
    }
  });
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "export_cadence_constraints",
    {
      description:
        "Export a Cadence Allegro .brd file to .tcfx constraint XML. Windows only. Requires Cadence SPB installation (auto-detected). Calls are serialized internally to avoid license conflicts.",
      inputSchema: {
        board: z.string().describe("Path to Cadence Allegro .brd file"),
        output: z
          .string()
          .optional()
          .describe("Output .tcfx path. Defaults to <boardname>_constraints.tcfx next to the .brd"),
      },
    },
    withTelemetry("export_cadence_constraints", async ({ board, output }) => {
      const result = await exportCadenceConstraints(board, { output });
      return formatResult(result);
    })
  );
};
