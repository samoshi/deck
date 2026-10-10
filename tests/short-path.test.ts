import { describe, expect, it } from "vitest";
import { shortPath } from "../src/renderer/src/lib/useGitSummary.js";

describe("shortPath", () => {
  it("shortens a Mac or Linux home to ~", () => {
    expect(shortPath("/Users/me/www/deck")).toBe("~/www/deck");
    expect(shortPath("/home/me")).toBe("~");
  });

  it("shows a folder inside WSL the way the shell does", () => {
    expect(shortPath("\\\\wsl.localhost\\archlinux\\home\\sam")).toBe("~");
    expect(shortPath("\\\\wsl.localhost\\archlinux\\home\\sam\\src\\x")).toBe("~/src/x");
    expect(shortPath("\\\\wsl$\\archlinux\\etc")).toBe("/etc");
  });

  it("leaves Windows drive paths alone", () => {
    expect(shortPath("E:\\Main\\Programming")).toBe("E:\\Main\\Programming");
    expect(shortPath(undefined)).toBe("~");
  });
});
