import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryComponents } from "./query-components.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

describe.skipIf(!hasBeagleBoneFixture)("queryComponents -- BeagleBone RevC", () => {
  it("finds a specific component by exact refdes", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^U1$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches.length).toBeGreaterThanOrEqual(1);
      expect(result.matches[0].refdes).toBe("U1");
    }
  });

  it("finds multiple components by prefix pattern", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^C\\d+$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches.length).toBeGreaterThan(1);
      for (const c of result.matches) {
        expect(c.refdes).toMatch(/^C\d+$/);
      }
    }
  });

  it("returns empty matches for non-existent refdes", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "^ZZZZZ$");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("rejects invalid regex", async () => {
    const result = await queryComponents(BEAGLEBONE_REVC, "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });
});

describe("queryComponents -- regex pattern guard", () => {
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
    const result = await queryComponents(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("accepts pattern of exactly 200 characters", async () => {
    const result = await queryComponents(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });
});
