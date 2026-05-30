```typescript
// Add gzip and brotli response compression to HTTP layer

import { Request, Response } from 'express';
import * as zlib from 'zlib';

const httpCompression = require('compression');
const brotliCompress = require('brotli-js');

function addGzipBrotliCompression(req: Request, res: Response) {
    // Check if client supports gzip and brotli
    const acceptEncoding = req.headers['accept-encoding'];
    if (acceptEncoding && (acceptEncoding.includes('gzip') || acceptEncoding.includes('br'))) {
        const encoding = acceptEncoding.includes('br')
            ? 'br'
            : acceptEncoding.includes('gzip')
                ? 'gzip'
                : null;
        
        // Compress responses larger than 1KB
        if (req.url.includes('/chat_history') && res.getHeader('Content-Length') > 1024) {
            let compressedBuffer: Buffer;
            switch (encoding) {
                case 'br':
                    compressedBuffer = brotliCompress(res.getStream(), null, true);
                    break;
                case 'gzip':
                    const gzipStream = httpCompression.res respond(res, { threshold: 100 });
                    compressedBuffer = gzipStream.write(res.getStream());
                    break;
                default:
                    throw new Error(`Unsupported encoding: ${encoding}`);
            }
            res.setHeader('Content-Encoding', encoding);
            res.write(compressedBuffer);
        } else {
            res.set("Cache-Control", `max-age=0`);
            res.end();
        }
    }
}

function decompressIncomingRequestBody(req: Request, res: Response) {
    const contentEncoding = req.headers['content-encoding'];
    if (contentEncoding && contentEncoding === 'br') {
        let compressedStream;
        switch (process.env.NODE_ENV) {
            case 'production':
                compressedStream = require('brotli-js').stream({
                    encodingType: 0,
                    streamId: 1
                });
                break;
            default:
                throw new Error(`Unsupported environment: ${process.env.NODE_ENV}`);
        }
        
        // Decompress incoming request bodies when Content-Encoding is set
        if (req.body && req.headers['content-encoding'] === 'br') {
            const decompressedBody = compressedStream.write(req.getStream());
            req.set("Content-Length", String(decompressedBody.length));
            res.end(decompressedBody);
        } else {
            throw new Error('Decompression required but not available.');
        }
    } else if (contentEncoding && contentEncoding === 'gzip') {
        const gzipStream = require('compression').createGzip();
        let decompressedStream;
        switch (process.env.NODE_ENV) {
            case 'production':
                decompressedStream = require('zlib').createGunzip(gzipStream);
                break;
            default:
                throw new Error(`Unsupported environment: ${process.env.NODE_ENV}`);
        }
        
        // Decompress incoming request bodies when Content-Encoding is set
        if (req.body && req.headers['content-encoding'] === 'gzip') {
            const decompressedBody = gzipStream.write(req.getStream());
            req.set("Content-Length", String(decompressedBody.length));
            res.end(decompressedBody);
        } else {
            throw new Error('Decompression required but not available.');
        }
    } else {
        // Skip compression for already-compressed content types like images and archives
        if (req.headers['content-type'] === 'image/*' || req.url.includes('/archive/')) {
            res.end();
        } else {
            throw new Error('Decompression required but not available.');
        }
    }
}

// Example usage:
app.get('/chat_history', addGzipBrotliCompression, (req: Request, res: Response) => {
    // Generate chat history
});
```