/**
 * Shared Cadence SPB utilities for export tools.
 *
 * Both export_cadence_board and export_cadence_constraints need Cadence
 * installation detection and a shared mutex to avoid license conflicts.
 * ES module caching guarantees the mutex singleton is shared across imports.
 */

import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { createMutex } from "./async-mutex.js";
import type { CadenceInstall, ErrorResult } from "./types.js";

export const CADENCE_BASE = "C:/Cadence";

/**
 * Scan for Cadence SPB installations that contain a specific executable.
 * Returns installs sorted by version descending (newest first).
 */
export const detectCadenceInstalls = async (
  exeName: string,
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
      const exePath = path.join(root, "tools", "bin", exeName);

      try {
        await access(exePath);
        installs.push({ version, root, exePath });
      } catch {
        // exe not found in this install
      }
    }

    installs.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  } catch {
    // Cadence directory doesn't exist or isn't accessible
  }

  return installs;
};

/**
 * Shared mutex to serialize all Cadence tool invocations.
 * Prevents license conflicts when multiple export calls happen concurrently.
 */
export const serializeCadenceCall = createMutex();

/**
 * Platform guard. Returns an ErrorResult on non-Windows, null otherwise.
 */
export const requireWindows = (toolName: string): ErrorResult | null => {
  if (process.platform !== "win32") {
    return {
      error: `${toolName} is only available on Windows. Requires a Windows environment with Cadence SPB installed.`,
    };
  }
  return null;
};
