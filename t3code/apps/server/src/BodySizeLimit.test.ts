import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_BODY_LIMIT, FILE_UPLOAD_BODY_LIMIT, getBodyLimit, setRouteBodyLimit } from "./BodySizeLimit.ts";

describe("BodySizeLimit", () => {
  it("returns default limit for regular routes", () => {
    expect(getBodyLimit("/api/status")).toBe(DEFAULT_BODY_LIMIT);
  });

  it("returns file upload limit for upload routes", () => {
    expect(getBodyLimit("/api/attachments")).toBe(FILE_UPLOAD_BODY_LIMIT);
    expect(getBodyLimit("/api/files/upload")).toBe(FILE_UPLOAD_BODY_LIMIT);
  });

  it("supports per-route overrides", () => {
    setRouteBodyLimit("/api/custom", 5 * 1024 * 1024);
    expect(getBodyLimit("/api/custom")).toBe(5 * 1024 * 1024);
  });

  it("default limit is 10MB", () => {
    expect(DEFAULT_BODY_LIMIT).toBe(10 * 1024 * 1024);
  });

  it("file upload limit is 50MB", () => {
    expect(FILE_UPLOAD_BODY_LIMIT).toBe(50 * 1024 * 1024);
  });
});
