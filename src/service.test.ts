import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDesignOverview, queryComponents, queryNet, exportCadenceBoard } from "./service.js";
import { isErrorResult } from "./types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

describe("service — file validation", () => {
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

describe.skipIf(!hasBeagleBoneFixture)("getDesignOverview — BeagleBone RevC", () => {
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

describe.skipIf(!hasBeagleBoneFixture)("queryComponents — BeagleBone RevC", () => {
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

describe("service — regex pattern guard", () => {
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

  it("queryComponents rejects pattern over 200 characters", async () => {
    const result = await queryComponents(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("queryComponents accepts pattern of exactly 200 characters", async () => {
    const result = await queryComponents(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });

  it("queryNet rejects pattern over 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(201));
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("too long");
    }
  });

  it("queryNet accepts pattern of exactly 200 characters", async () => {
    const result = await queryNet(minimalXml, "A".repeat(200));
    if (isErrorResult(result)) {
      expect(result.error).not.toContain("too long");
    }
  });
});

describe.skipIf(!hasBeagleBoneFixture)("queryNet — BeagleBone RevC", () => {
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

describe("exportCadenceBoard", () => {
  it("returns error on non-Windows platforms", async () => {
    const result = await exportCadenceBoard("C:/designs/test.brd");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("only available on Windows");
    }
  });
});
