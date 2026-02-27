import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDesignOverview } from "./get-design-overview.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

describe("file validation", () => {
  it("returns error for non-existent file", async () => {
    const result = await getDesignOverview("/nonexistent/file.xml");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("File not found");
    }
  });

  it("returns error for non-XML file", async () => {
    const result = await getDesignOverview(path.join(FIXTURE_DIR, "../..", "package.json"));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("not an XML file");
    }
  });
});

describe.skipIf(!hasBeagleBoneFixture)("getDesignOverview -- BeagleBone RevC", () => {
  it("returns design metadata", async () => {
    const result = await getDesignOverview(BEAGLEBONE_REVC);
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.fileName).toContain("BeagleBone");
      expect(result.totalLines).toBeGreaterThan(100000);
      expect(result.componentCount).toBeGreaterThan(0);
      expect(result.netCount).toBeGreaterThan(0);
      expect(result.layers.length).toBeGreaterThan(0);
    }
  });
});
