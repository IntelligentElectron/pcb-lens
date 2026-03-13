import { describe, it, expect } from "vitest";
import { exportCadenceBoard } from "./export-cadence-ipc2581.js";
import { isErrorResult } from "./lib/types.js";

describe("exportCadenceBoard", () => {
  it("returns error on non-Windows platforms", async () => {
    const result = await exportCadenceBoard("C:/designs/test.brd");
    expect(isErrorResult(result)).toBe(true);
    if (isErrorResult(result)) {
      expect(result.error).toContain("only available on Windows");
    }
  });
});
