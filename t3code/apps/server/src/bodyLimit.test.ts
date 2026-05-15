import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
  oversizedRequestBodyInfo,
  parseContentLengthHeader,
  resolveRequestBodySizeLimit,
} from "./bodyLimit.ts";

describe("request body size limits", () => {
  it("uses a 10MB default limit for regular request bodies", () => {
    expect(resolveRequestBodySizeLimit()).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
    expect(
      oversizedRequestBodyInfo({
        "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES),
      }),
    ).toBeNull();
    expect(
      oversizedRequestBodyInfo({
        "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1),
      }),
    ).toEqual({
      limitBytes: DEFAULT_REQUEST_BODY_LIMIT_BYTES,
      receivedBytes: DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1,
    });
  });

  it("supports a 50MB per-route override for file upload routes", () => {
    expect(resolveRequestBodySizeLimit({ limitBytes: FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES })).toBe(
      FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
    );
    expect(
      oversizedRequestBodyInfo(
        {
          "content-length": String(FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES),
        },
        { limitBytes: FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES },
      ),
    ).toBeNull();
    expect(
      oversizedRequestBodyInfo(
        {
          "content-length": String(FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES + 1),
        },
        { limitBytes: FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES },
      ),
    ).toEqual({
      limitBytes: FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
      receivedBytes: FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES + 1,
    });
  });

  it("ignores missing or invalid content length headers", () => {
    expect(parseContentLengthHeader(undefined)).toBeNull();
    expect(parseContentLengthHeader("12.5")).toBeNull();
    expect(parseContentLengthHeader("abc")).toBeNull();
    expect(parseContentLengthHeader("42")).toBe(42);
  });
});
