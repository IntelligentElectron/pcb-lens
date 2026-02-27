import { describe, it, expect } from "vitest";
import { exportCadenceConstraints } from "./export-cadence-constraints.js";
import { isErrorResult } from "./lib/types.js";

describe("exportCadenceConstraints", () => {
  it("returns error on non-Windows platforms", async () => {
    const result = await exportCadenceConstraints("C:/designs/test.brd");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("only available on Windows");
    }
  });
});
