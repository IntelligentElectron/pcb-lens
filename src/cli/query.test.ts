/**
 * The query command line through the real entry point, in a child process,
 * as an agent in a sandbox runs it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseQueryArgs } from "./query.js";
import { findTool } from "../tools/index.js";

const ENTRY = path.resolve(__dirname, "../index.ts");
const FIXTURE = path.resolve(__dirname, "../../test/fixtures/ipc2581/testcase3-RevC.xml");

const cli = (args: string[]) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", ENTRY, ...args], {
    encoding: "utf-8",
    input: "",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("query arguments", () => {
  const net = findTool("get_pcb_net")!;

  it("takes the file first, flags by name, and a dash value after =", () => {
    expect(parseQueryArgs(net, ["b.xml", "--pattern=-12V", "--detail", "full"])).toEqual({
      kind: "run",
      args: { file: "b.xml", pattern: "-12V", detail: "full" },
    });
  });

  it("refuses a dash value without =, a second positional, and a repeated flag", () => {
    expect(parseQueryArgs(net, ["b.xml", "--pattern", "-12V"]).kind).toBe("usage");
    expect(parseQueryArgs(net, ["b.xml", "c.xml"]).kind).toBe("usage");
    expect(parseQueryArgs(net, ["b.xml", "--file", "c.xml"]).kind).toBe("usage");
  });

  it("takes the board first on the export tools", () => {
    const tool = findTool("export_cadence_constraints")!;
    expect(parseQueryArgs(tool, ["x.brd"])).toEqual({ kind: "run", args: { board: "x.brd" } });
  });
});

describe("query command line", () => {
  it("lists every tool in --help", () => {
    const { code, stdout } = cli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("get_constraints");
    expect(stdout).toContain("<tool> --help");
  });

  it("refuses a word that is no command or tool, instead of starting the server", () => {
    const { code, stderr } = cli(["get_pcb_nets", "board.xml"]);
    expect(code).toBe(2);
    expect(stderr).toContain("'get_pcb_nets' is not a command or a tool");
    expect(stderr).toContain("get_pcb_net");
  });

  it("prints a tool's help from the registry", () => {
    const { code, stdout } = cli(["get_pcb_net", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: pcb-lens get_pcb_net <file> --pattern <text>");
  });

  it("names a missing required flag on stderr, with the usage line, and exits 2", () => {
    const { code, stdout, stderr } = cli(["get_pcb_component", "board.xml"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--refdes: required");
    expect(stderr).toContain("usage: pcb-lens get_pcb_component");
  });

  it("refuses a value outside an enum", () => {
    const { code, stderr } = cli(["get_pcb_net", "b.xml", "--pattern", "X", "--detail", "all"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--detail:");
  });

  it("exits 1 on a result with an error field", () => {
    const { code, stdout } = cli(["get_pcb_metadata", "/no/such/board.xml"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error).toContain("File not found");
  });

  it.skipIf(!existsSync(FIXTURE))("prints compact JSON for a pipe and exits 0", () => {
    const { code, stdout } = cli(["get_pcb_metadata", FIXTURE]);
    expect(code).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout).fileName).toBe("testcase3-RevC.xml");
  });
});
