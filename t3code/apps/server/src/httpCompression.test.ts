import { brotliCompressSync, gzipSync } from "node:zlib";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  decompressBytes,
  isCompressibleContentType,
  selectCompressionEncoding,
} from "./http.ts";

it("prefers brotli over gzip when both encodings are accepted", () => {
  assert.equal(selectCompressionEncoding("gzip, br"), "br");
  assert.equal(selectCompressionEncoding("gzip"), "gzip");
  assert.equal(selectCompressionEncoding("br;q=0, gzip;q=1"), "gzip");
  assert.equal(selectCompressionEncoding("identity"), undefined);
});

it("skips already-compressed response content types", () => {
  assert.equal(isCompressibleContentType("application/json"), true);
  assert.equal(isCompressibleContentType("text/html; charset=utf-8"), true);
  assert.equal(isCompressibleContentType("image/png"), false);
  assert.equal(isCompressibleContentType("application/zip"), false);
  assert.equal(isCompressibleContentType("application/octet-stream"), false);
});

it.effect("decompresses gzip and brotli request bodies", () =>
  Effect.gen(function* () {
    const payload = new TextEncoder().encode(JSON.stringify({ ok: true, value: "payload" }));

    const gzipPayload = gzipSync(payload);
    const brotliPayload = brotliCompressSync(payload);

    const gunzipped = yield* decompressBytes("gzip", gzipPayload);
    const unbrotlied = yield* decompressBytes("br", brotliPayload);

    assert.equal(new TextDecoder().decode(gunzipped), new TextDecoder().decode(payload));
    assert.equal(new TextDecoder().decode(unbrotlied), new TextDecoder().decode(payload));
  }),
);
