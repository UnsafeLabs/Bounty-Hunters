'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CIPHER_SUITES,
  HANDSHAKE_TYPE,
  TLSError,
  TLSHandshakeClient,
  TLS_VERSION,
} = require('./tls_handshake_client.js');

function uint24(value) {
  const buffer = Buffer.alloc(3);
  buffer.writeUInt8((value >> 16) & 0xff, 0);
  buffer.writeUInt8((value >> 8) & 0xff, 1);
  buffer.writeUInt8(value & 0xff, 2);
  return buffer;
}

function buildServerHello(cipherSuite) {
  const body = Buffer.alloc(2 + 32 + 1 + 2 + 1);
  let offset = 0;

  body.writeUInt16BE(TLS_VERSION.TLS_1_2, offset);
  offset += 2;

  body.fill(0xa5, offset, offset + 32);
  offset += 32;

  body.writeUInt8(0, offset);
  offset += 1;

  body.writeUInt16BE(cipherSuite, offset);
  offset += 2;

  body.writeUInt8(0, offset);

  return Buffer.concat([
    Buffer.from([HANDSHAKE_TYPE.SERVER_HELLO]),
    uint24(body.length),
    body,
  ]);
}

test('computeFinishedHash uses SHA-384 length for TLS_AES_256_GCM_SHA384', () => {
  const client = new TLSHandshakeClient({
    cipherSuites: [CIPHER_SUITES.TLS_AES_256_GCM_SHA384],
  });

  const parsed = client.parseServerHello(
    buildServerHello(CIPHER_SUITES.TLS_AES_256_GCM_SHA384),
  );

  assert.equal(parsed.hash, 'sha384');
  assert.equal(client.negotiatedHash, 'sha384');
  assert.equal(typeof client.negotiatedHash, 'string');

  const verifyData = client.computeFinishedHash(
    Buffer.alloc(48, 0x11),
    Buffer.from('finished transcript'),
  );

  assert.equal(verifyData.length, 48);
});

test('computeFinishedHash uses SHA-256 length for TLS_AES_128_GCM_SHA256', () => {
  const client = new TLSHandshakeClient({
    cipherSuites: [CIPHER_SUITES.TLS_AES_128_GCM_SHA256],
  });

  const parsed = client.parseServerHello(
    buildServerHello(CIPHER_SUITES.TLS_AES_128_GCM_SHA256),
  );

  assert.equal(parsed.hash, 'sha256');
  assert.equal(client.negotiatedHash, 'sha256');
  assert.equal(typeof client.negotiatedHash, 'string');

  const verifyData = client.computeFinishedHash(
    Buffer.alloc(32, 0x22),
    Buffer.from('finished transcript'),
  );

  assert.equal(verifyData.length, 32);
});

test('computeFinishedHash uses SHA-256 length for TLS_CHACHA20_POLY1305_SHA256', () => {
  const client = new TLSHandshakeClient({
    cipherSuites: [CIPHER_SUITES.TLS_CHACHA20_POLY1305_SHA256],
  });

  const parsed = client.parseServerHello(
    buildServerHello(CIPHER_SUITES.TLS_CHACHA20_POLY1305_SHA256),
  );

  assert.equal(parsed.hash, 'sha256');
  assert.equal(client.negotiatedHash, 'sha256');
  assert.equal(typeof client.negotiatedHash, 'string');

  const verifyData = client.computeFinishedHash(
    Buffer.alloc(32, 0x33),
    Buffer.from('finished transcript'),
  );

  assert.equal(verifyData.length, 32);
});

test('computeFinishedHash rejects numeric negotiated hash values', () => {
  const client = new TLSHandshakeClient();
  client.negotiatedHash = CIPHER_SUITES.TLS_AES_256_GCM_SHA384;

  assert.throws(
    () => client.computeFinishedHash(Buffer.alloc(32), Buffer.from('transcript')),
    TLSError,
  );
});
