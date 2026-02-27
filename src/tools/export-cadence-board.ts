import { stat, readdir, access } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMutex } from "./lib/async-mutex.js";
import type { CadenceInstall, ErrorResult, ExportCadenceBoardResult } from "./lib/types.js";
import { formatResult } from "./shared.js";

const execAsync = promisify(exec);
const serializeExport = createMutex();
const CADENCE_BASE = "C:/Cadence";

export const detectCadenceVersions = async (
  cadenceBase = CADENCE_BASE
): Promise<CadenceInstall[]> => {
  const installs: CadenceInstall[] = [];

  try {
    const entries = await readdir(cadenceBase);

    for (const entry of entries) {
      const match = entry.match(/^SPB_(\d+\.\d+)$/);
      if (!match) continue;

      const version = match[1];
      const root = path.join(cadenceBase, entry);
      const exePath = path.join(root, "tools", "bin", "ipc2581_out.exe");

      try {
        await access(exePath);
        installs.push({ version, root, exePath });
      } catch {
        // ipc2581_out.exe not found in this install
      }
    }

    installs.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  } catch {
    // Cadence directory doesn't exist or isn't accessible
  }

  return installs;
};

const REV_B_FLAGS = "-f 1.03 -u MICRON -d -b -l -R -K -n -p -t -c -O -I -D -M -S -k -e";
const REV_C_FLAGS = "-f 1.04 -u MICRON -d -b -l -R -K -G -Y -p -t -c -O -I -D -M -A -B -C -U -k -e";

export const exportCadenceBoard = async (
  brdPath: string,
  options?: { output?: string; revision?: "B" | "C" }
): Promise<ExportCadenceBoardResult | ErrorResult> => {
  if (process.platform !== "win32") {
    return {
      error:
        "Cadence export is only available on Windows. The ipc2581_out utility requires a Windows environment with Cadence SPB installed.",
    };
  }

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

  const installs = await detectCadenceVersions();
  if (installs.length === 0) {
    return {
      error:
        "No Cadence SPB installation with ipc2581_out.exe found in C:/Cadence. Ensure Cadence Allegro/OrCAD PCB Editor is installed.",
    };
  }
  const cadence = installs[0];

  const revision = options?.revision ?? "C";
  const flags = revision === "B" ? REV_B_FLAGS : REV_C_FLAGS;

  const brdDir = path.dirname(resolvedBrd);
  const brdName = path.basename(resolvedBrd, ".brd");
  const outputBase = options?.output ?? path.join(brdDir, `${brdName}_ipc2581`);
  const expectedOutput = outputBase.endsWith(".xml") ? outputBase : `${outputBase}.xml`;

  const command = `"${cadence.exePath}" ${flags} -o "${outputBase}" "${resolvedBrd}"`;

  return serializeExport(async () => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: brdDir,
        timeout: 300_000,
      });

      const log = (stdout + stderr).trim();

      if (log.includes("License checking failed. Terminating")) {
        return {
          error: `Cadence license check failed. Ensure a valid Allegro license is available. Log: ${log}`,
        };
      }

      if (!log.includes("a2ipc2581 complete")) {
        return {
          error: `Export did not complete successfully. Log: ${log}`,
        };
      }

      try {
        const outStat = await stat(expectedOutput);
        if (outStat.size < 1024) {
          return {
            error: `Output file is suspiciously small (${outStat.size} bytes): '${expectedOutput}'`,
          };
        }
      } catch {
        return {
          error: `Export reported success but output file not found: '${expectedOutput}'`,
        };
      }

      return {
        success: true,
        outputPath: expectedOutput,
        revision,
        cadenceVersion: cadence.version,
        log: log || undefined,
      };
    } catch (err: unknown) {
      const execError = err as { message?: string; stdout?: string; stderr?: string };
      const combinedLog = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
      return {
        error: `Cadence ipc2581_out failed: ${execError.message ?? "Unknown error"}${combinedLog ? `\nLog: ${combinedLog}` : ""}`,
      };
    }
  });
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "export_cadence_board",
    {
      description:
        "Export a Cadence Allegro .brd file to IPC-2581 XML. Windows only. Requires Cadence SPB installation (auto-detected). Calls are serialized internally to avoid license conflicts.",
      inputSchema: {
        board: z.string().describe("Path to Cadence Allegro .brd file"),
        output: z
          .string()
          .optional()
          .describe(
            "Output path (without .xml extension — Cadence appends it). Defaults to <boardname>_ipc2581.xml next to the .brd"
          ),
        revision: z
          .enum(["B", "C"])
          .optional()
          .describe('IPC-2581 revision: "B" (1.03) or "C" (1.04, default). Rev C is richest.'),
      },
    },
    async ({ board, output, revision }) => {
      const result = await exportCadenceBoard(board, { output, revision });
      return formatResult(result);
    }
  );
};
