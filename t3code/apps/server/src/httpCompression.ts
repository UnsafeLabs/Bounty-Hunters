import * as zlib from "node:zlib";
import type * as http from "node:http";

const COMPRESSION_THRESHOLD = 1024;

function getEncoding(acceptEncoding: string): string | null {
  const lowered = acceptEncoding.toLowerCase();
  if (lowered.includes("br")) return "br";
  if (lowered.includes("gzip")) return "gzip";
  return null;
}

function compressGzip(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, { level: zlib.constants.Z_BEST_SPEED }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function compressBrotli(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(
      data,
      { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}

export function wrapCreateServer(
  createServer: typeof http.createServer,
): typeof http.createServer {
  return ((...args: Parameters<typeof http.createServer>) => {
    const server = createServer(...args);
    const originalEmit = server.emit.bind(server);
    (server as any).emit = function (event: string, ...eventArgs: any[]) {
      if (event === "request") {
        const req = eventArgs[0] as http.IncomingMessage;
        const res = eventArgs[1] as http.ServerResponse;
        let bodyChunks: Buffer[] = [];
        let contentEncoding: string | undefined;

        const originalWriteHead = res.writeHead.bind(res);
        res.writeHead = function (statusCode: number, ...headArgs: any[]) {
          if (headArgs.length > 0 && typeof headArgs[0] === "object" && !Array.isArray(headArgs[0])) {
            const headers = headArgs[0] as Record<string, string | number | string[]>;
            contentEncoding = headers["content-encoding"] as string | undefined;
          }
          return originalWriteHead(statusCode, ...headArgs);
        };

        const originalWrite = res.write.bind(res);
        res.write = function (data: any, ...writeArgs: any[]) {
          if (data) {
            bodyChunks.push(Buffer.from(data));
          }
          return originalWrite(data, ...writeArgs);
        };

        const originalEnd = res.end.bind(res);
        res.end = function (data?: any, encoding?: any, cb?: any) {
          if (data) {
            bodyChunks.push(Buffer.from(data));
          }
          if (contentEncoding) {
            return originalEnd(Buffer.concat(bodyChunks), cb);
          }

          const acceptEncoding = req.headers["accept-encoding"];
          if (!acceptEncoding) {
            return originalEnd(Buffer.concat(bodyChunks), cb);
          }

          const compEncoding = getEncoding(acceptEncoding as string);
          if (!compEncoding) {
            return originalEnd(Buffer.concat(bodyChunks), cb);
          }

          const allData = Buffer.concat(bodyChunks);
          if (allData.length < COMPRESSION_THRESHOLD) {
            return originalEnd(allData, cb);
          }

          const compressor = compEncoding === "br" ? compressBrotli : compressGzip;
          compressor(allData).then((compressed) => {
            if (res.headersSent) {
              res.write(compressed);
              return originalEnd(cb);
            }
            if (res.getHeader("content-length")) {
              res.removeHeader("content-length");
            }
            res.setHeader("content-encoding", compEncoding);
            const vary = res.getHeader("vary");
            res.setHeader("vary", (vary ? (vary as string) + ", " : "") + "Accept-Encoding");
            res.writeHead(res.statusCode);
            res.write(compressed);
            return originalEnd(cb);
          }).catch(() => {
            originalEnd(allData, cb);
          });
          return res;
        };
      }
      return originalEmit(event, ...eventArgs);
    };
    return server;
  }) as typeof http.createServer;
}
