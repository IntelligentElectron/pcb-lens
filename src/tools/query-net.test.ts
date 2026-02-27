import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryNet } from "./query-net.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

describe("queryNet -- regex pattern guard", () => {
  let minimalXml: string;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
    minimalXml = path.join(tempDir, "test.xml");
    writeFileSync(minimalXml, "<IPC-2581/>");
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects pattern over 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("accepts pattern of exactly 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });
});

describe.skipIf(!hasBeagleBoneFixture)("queryNet -- BeagleBone RevC", () => {
  it("returns error for non-existent net", async () => {
    const result = await queryNet(BEAGLEBONE_REVC, "^NONEXISTENT_NET_12345$");
    expect(isErrorResult(result)).toBe(true);
  });

  it("rejects invalid regex", async () => {
    const result = await queryNet(BEAGLEBONE_REVC, "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });

  it("returns net data for a known net", async () => {
    const result = await queryNet(BEAGLEBONE_REVC, "^VDD_3V3B$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.netName).toBe("VDD_3V3B");
      expect(result.units).toBe("MICRON");
      expect(result.pins.length).toBeGreaterThan(0);
      expect(result.routing.length).toBeGreaterThan(0);
    }
  });
});
