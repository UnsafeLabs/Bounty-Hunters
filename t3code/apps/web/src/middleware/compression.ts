import { Layer } from "effect";
import type { Request, Response, NextFunction } from "express";
import { createGzip, createBrotliCompress } from "zlib";

const THRESHOLD = 1024;
const SKIP = ["image/", "video/", "audio/", "application/zip", "application/gzip", "application/x-brotli", "application/octet-stream"];

function shouldCompress(req: Request, res: Response): boolean {
  const enc = req.headers["accept-encoding"] ?? "";
  if (!enc) return false;
  const ct = res.getHeader("content-type");
  if (typeof ct !== "string") return false;
  for (const s of SKIP) { if (ct.includes(s)) return false; }
  return ct.includes("json") || ct.includes("text");
}

function getEncoding(req: Request): "br" | "gzip" | null {
  const enc = req.headers["accept-encoding"] ?? "";
  if (enc.includes("br")) return "br";
  if (enc.includes("gzip")) return "gzip";
  return null;
}

export function compressionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origEnd = res.end.bind(res);
  const origWrite = res.write.bind(res);
  const chunks: Buffer[] = [];

  res.write = function (this: Response, chunk: any) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };

  res.end = function (this: Response, chunk: any) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    if (body.length < THRESHOLD || !shouldCompress(req, res)) { origEnd(body); return res; }
    const enc = getEncoding(req);
    if (!enc) { origEnd(body); return res; }

    const comp = enc === "br" ? createBrotliCompress() : createGzip({ level: 6 });
    res.setHeader("Content-Encoding", enc);
    res.removeHeader("Content-Length");
    const out: Buffer[] = [];
    comp.on("data", (c: Buffer) => out.push(c));
    comp.on("end", () => origEnd(Buffer.concat(out)));
    comp.write(body);
    comp.end();
    return res;
  };
  next();
}

export const CompressionLayer = Layer.sync("Compression", () => ({ compressionMiddleware }));
