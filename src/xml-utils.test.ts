import { describe, it, expect } from "vitest";
import { attr, numAttr } from "./xml-utils.js";

describe("attr", () => {
  it("extracts a simple attribute", () => {
    const line = '<Component refDes="U1" packageRef="BGA-256">';
    expect(attr(line, "refDes")).toBe("U1");
    expect(attr(line, "packageRef")).toBe("BGA-256");
  });

  it("returns undefined for missing attribute", () => {
    const line = '<Component refDes="U1">';
    expect(attr(line, "packageRef")).toBeUndefined();
  });

  it("handles attributes with spaces in value", () => {
    const line = '<Step name="BeagleBone Black RevC">';
    expect(attr(line, "name")).toBe("BeagleBone Black RevC");
  });

  it("handles empty attribute value", () => {
    const line = '<Layer name="">';
    expect(attr(line, "name")).toBe("");
  });

  it("is case-insensitive for attribute names", () => {
    const line = '<IPC-2581 revision="C">';
    expect(attr(line, "Revision")).toBe("C");
    expect(attr(line, "REVISION")).toBe("C");
  });
});

describe("numAttr", () => {
  it("extracts a numeric attribute", () => {
    const line = '<Location x="25.4" y="12.7">';
    expect(numAttr(line, "x")).toBe(25.4);
    expect(numAttr(line, "y")).toBe(12.7);
  });

  it("returns undefined for missing attribute", () => {
    const line = '<Location x="25.4">';
    expect(numAttr(line, "y")).toBeUndefined();
  });

  it("returns undefined for non-numeric value", () => {
    const line = '<Component refDes="U1">';
    expect(numAttr(line, "refDes")).toBeUndefined();
  });

  it("handles negative numbers", () => {
    const line = '<Location x="-5.0" y="-10.2">';
    expect(numAttr(line, "x")).toBe(-5.0);
    expect(numAttr(line, "y")).toBe(-10.2);
  });

  it("handles zero", () => {
    const line = '<Rotation rotation="0">';
    expect(numAttr(line, "rotation")).toBe(0);
  });
});
