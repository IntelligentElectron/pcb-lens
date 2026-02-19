import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getDesignOverview } from "../../src/service.js";
import { isErrorResult } from "../../src/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures");

const xmlFiles = (() => {
  try {
    return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".xml"));
  } catch {
    return [];
  }
})();

const hasFixtures = xmlFiles.length > 0;

describe.skipIf(!hasFixtures)("integration — all fixtures parse", () => {
  for (const xmlFile of xmlFiles) {
    it(`parses ${xmlFile}`, async () => {
      const filePath = path.join(FIXTURE_DIR, xmlFile);
      expect(existsSync(filePath)).toBe(true);

      const result = await getDesignOverview(filePath);
      expect(isErrorResult(result)).toBe(false);
      if (!isErrorResult(result)) {
        expect(result.totalLines).toBeGreaterThan(0);
        expect(result.componentCount).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
