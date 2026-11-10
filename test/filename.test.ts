import { describe, expect, test } from "bun:test";
import { attachmentDisposition, sanitizeFilename } from "../src/lib/filename";
import { ID_PATTERN, randomId } from "../src/lib/id";

describe("sanitizeFilename", () => {
  test("keeps ordinary names", () => {
    expect(sanitizeFilename("report final (2).pdf")).toBe("report final (2).pdf");
    expect(sanitizeFilename("räksmörgås.txt")).toBe("räksmörgås.txt");
  });

  test("strips directories and traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\notes.txt")).toBe("notes.txt");
    expect(sanitizeFilename("folder/")).toBeNull();
  });

  test("rejects names with nothing usable", () => {
    for (const bad of ["", ".", "..", "...", "   ", "\u0000", "/"]) {
      expect(sanitizeFilename(bad)).toBeNull();
    }
  });

  test("removes leading dots and control characters", () => {
    expect(sanitizeFilename(".env")).toBe("env");
    expect(sanitizeFilename("a\r\nb.txt")).toBe("ab.txt");
  });

  test("caps length at 255 bytes and keeps the extension", () => {
    const name = sanitizeFilename("ö".repeat(400) + ".tar.gz")!;
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith(".gz")).toBe(true);
  });
});

describe("attachmentDisposition", () => {
  test("always forces a download and cannot be broken out of", () => {
    const value = attachmentDisposition('ev"il\\näme.html');
    expect(value.startsWith("attachment; ")).toBe(true);
    expect(value).toContain('filename="ev_il_n_me.html"');
    expect(value).toContain("filename*=UTF-8''ev%22il%5Cn%C3%A4me.html");
  });
});

describe("randomId", () => {
  test("is 22 url-safe characters and unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(ID_PATTERN);
  });
});
