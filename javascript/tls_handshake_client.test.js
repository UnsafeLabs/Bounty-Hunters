'use strict';

const assert = require('assert');

const {
  TLSHandshakeClient,
  TLSError,
  CIPHER_SUITES,
  TLS_VERSION,
  HANDSHAKE_TYPE,
} = require('./tls_handshake_client');

function uint24(value) {
  const buf = Buffer.alloc(3);
  buf.writeUInt8((value >> 16) & 0xff, 0);
  buf.writeUInt8((value >> 8) & 0xff, 1);
  buf.writeUInt8(value & 0xff, 2);
  return buf;
}

function buildServerHello(cipherSuite) {
  const sessionId = Buffer.alloc(0);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]),
    Buffer.alloc(32, 0x11),
    Buffer.from([sessionId.length]),
    sessionId,
    Buffer.from([(cipherSuite >> 8) & 0xff, cipherSuite & 0xff]),
    Buffer.from([0x00]),
    Buffer.from([0x00, 0x00]),
  ]);

  return Buffer.concat([
    Buffer.from([HANDSHAKE_TYPE.SERVER_HELLO]),
    uint24(body.length),
    body,
  ]);
}

function testRejectsUnofferedCipherSuite() {
  const client = new TLSHandshakeClient({
    cipherSuites: [CIPHER_SUITES.TLS_AES_256_GCM_SHA384],
  });
  const serverHello = buildServerHello(CIPHER_SUITES.TLS_AES_128_GCM_SHA256);

  assert.throws(
    () => client.parseServerHello(serverHello),
    (err) => (
      err instanceof TLSError
      && err.alertCode === 47
      && err.message.includes('not in offered list')
    ),
  );
  assert.strictEqual(client.negotiatedCipherSuite, null);
}

function testAcceptsOfferedCipherSuite() {
  const client = new TLSHandshakeClient({
    cipherSuites: [CIPHER_SUITES.TLS_AES_256_GCM_SHA384],
  });
  const serverHello = buildServerHello(CIPHER_SUITES.TLS_AES_256_GCM_SHA384);

  const result = client.parseServerHello(serverHello);

  assert.strictEqual(result.cipherSuite, CIPHER_SUITES.TLS_AES_256_GCM_SHA384);
  assert.strictEqual(result.hash, 'sha384');
  assert.strictEqual(client.negotiatedCipherSuite, CIPHER_SUITES.TLS_AES_256_GCM_SHA384);
}

assert.strictEqual(TLS_VERSION.TLS_1_2, 0x0303);
testRejectsUnofferedCipherSuite();
testAcceptsOfferedCipherSuite();

console.log('tls_handshake_client tests passed');
