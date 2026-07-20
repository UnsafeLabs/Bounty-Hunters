import { describe, expect, it } from "vitest";
import { parseDeepLink, sanitizeProjectPath } from "./parseDeepLink.ts";

describe("sanitizeProjectPath", () => {
  it("accepts absolute posix paths", () => {
    expect(sanitizeProjectPath("/Users/me/repo")).toBe("/Users/me/repo");
  });
  it("accepts windows paths", () => {
    expect(sanitizeProjectPath("C:\\Users\\me\\repo")).toBe("C:\\Users\\me\\repo");
  });
  it("rejects traversal", () => {
    expect(sanitizeProjectPath("/tmp/../etc/passwd")).toBeNull();
    expect(sanitizeProjectPath("%2e%2e/secret")).toBeNull();
  });
  it("rejects relative paths", () => {
    expect(sanitizeProjectPath("relative/path")).toBeNull();
  });
});

describe("parseDeepLink", () => {
  it("parses open project", () => {
    const r = parseDeepLink("t3code://open/project?path=%2Ftmp%2Fdemo");
    expect(r).toEqual({ ok: true, action: { kind: "open_project", path: "/tmp/demo" } });
  });
  it("parses chat thread", () => {
    const r = parseDeepLink("t3code://chat/thread?id=abc-123");
    expect(r).toEqual({ ok: true, action: { kind: "chat_thread", id: "abc-123" } });
  });
  it("parses settings", () => {
    expect(parseDeepLink("t3code://settings").ok).toBe(true);
    if (parseDeepLink("t3code://settings").ok) {
      expect(parseDeepLink("t3code://settings").action).toEqual({ kind: "settings" });
    }
  });
  it("accepts t3 scheme alias", () => {
    const r = parseDeepLink("t3://open/project?path=/home/a/b");
    expect(r.ok).toBe(true);
  });
  it("rejects path traversal in project path", () => {
    const r = parseDeepLink("t3code://open/project?path=/tmp/../etc");
    expect(r).toEqual({ ok: false, error: "invalid_project_path" });
  });
  it("rejects bad thread id", () => {
    const r = parseDeepLink("t3code://chat/thread?id=../../x");
    expect(r.ok).toBe(false);
  });
});
