import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryComponents } from "./query-components.js";
import { isErrorResult } from "./lib/types.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../test/fixtures");
const BEAGLEBONE_REVC = path.join(FIXTURE_DIR, "BeagleBone Black_PCB_RevC_No Logo_210401.xml");
const hasBeagleBoneFixture = existsSync(BEAGLEBONE_REVC);

// ---------------------------------------------------------------------------
// Inline fixture for package_pattern tests
// ---------------------------------------------------------------------------
const INLINE_XML = `<IPC-2581>
  <Content></Content>
  <CadHeader units="MILLIMETER"/>
  <Step>
    <Component refDes="U1" packageRef="BGA256_1MM" layerRef="TOP">
      <Location x="10" y="20"/>
    </Component>
    <Component refDes="U2" packageRef="QFP64_0.5MM" layerRef="TOP">
      <Location x="30" y="40"/>
    </Component>
    <Component refDes="U3" packageRef="BGA484_0.8MM" layerRef="BOTTOM">
      <Location x="50" y="60"/>
    </Component>
    <Component refDes="R1" packageRef="RES_0402" layerRef="TOP">
      <Location x="70" y="80"/>
    </Component>
    <PhyNetGroup/>
  </Step>
</IPC-2581>`;

let tempDir: string;
let inlineXml: string;
let minimalXml: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "pcb-lens-test-"));
  inlineXml = path.join(tempDir, "components.xml");
  writeFileSync(inlineXml, INLINE_XML);
  minimalXml = path.join(tempDir, "test.xml");
  writeFileSync(minimalXml, "<IPC-2581/>");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Regex pattern guard
// ---------------------------------------------------------------------------
describe("queryComponents -- regex pattern guard", () => {
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

// ---------------------------------------------------------------------------
// Package pattern filtering
// ---------------------------------------------------------------------------
describe("queryComponents -- package_pattern", () => {
  it("filters components by package pattern", async () => {
    const result = await queryComponents(inlineXml, "^U", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].refdes).toBe("U1");
      expect(result.matches[1].refdes).toBe("U3");
      for (const c of result.matches) {
        expect(c.packageRef).toMatch(/BGA/i);
      }
    }
  });

  it("ANDs refdes and package patterns together", async () => {
    const result = await queryComponents(inlineXml, "^U1$", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].refdes).toBe("U1");
    }
  });

  it("returns empty when package pattern matches none", async () => {
    const result = await queryComponents(inlineXml, "^U", "SOIC");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("returns empty when refdes matches but package does not", async () => {
    const result = await queryComponents(inlineXml, "^R1$", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("rejects invalid package pattern regex", async () => {
    const result = await queryComponents(inlineXml, "^U", "[invalid");
    expect(isErrorResult(result)).toBe(true);
  });

  it("includes packagePattern in result when provided", async () => {
    const result = await queryComponents(inlineXml, "^U", "BGA");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.packagePattern).toBe("BGA");
    }
  });

  it("omits packagePattern from result when not provided", async () => {
    const result = await queryComponents(inlineXml, "^U");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.packagePattern).toBeUndefined();
    }
  });

  it("works with broad refdes pattern and specific package", async () => {
    const result = await queryComponents(inlineXml, ".", "QFP");
    expect(isErrorResult(result)).toBe(false);
    if (!isErrorResult(result)) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].refdes).toBe("U2");
    }
  });
});
