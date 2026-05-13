'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  TLSHandshakeClient,
  CIPHER_SUITES,
} = require('./tls_handshake_client');

function hkdfExpand(hash, secret, info, length) {
  const hashLen = hash === 'sha384' ? 48 : 32;
  const chunks = [];
  let previous = Buffer.alloc(0);

  for (let i = 1; i <= Math.ceil(length / hashLen); i += 1) {
    previous = crypto.createHmac(hash, secret)
      .update(Buffer.concat([previous, info, Buffer.from([i])]))
      .digest();
    chunks.push(previous);
  }

  return Buffer.concat(chunks).slice(0, length);
}

function hkdfLabelInfo(label, context, length) {
  const tlsLabel = `tls13 ${label}`;
  const info = Buffer.alloc(2 + 1 + tlsLabel.length + 1 + context.length);
  let offset = 0;
  info.writeUInt16BE(length, offset);
  offset += 2;
  info.writeUInt8(tlsLabel.length, offset);
  offset += 1;
  info.write(tlsLabel, offset, 'ascii');
  offset += tlsLabel.length;
  info.writeUInt8(context.length, offset);
  offset += 1;
  context.copy(info, offset);
  return info;
}

function testHkdfExpandLabelPrefixesTls13ExactlyOnce() {
  const client = new TLSHandshakeClient();
  const secret = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const context = crypto.createHash('sha256').update('transcript').digest();

  for (const label of ['derived', 'c hs traffic', 's hs traffic']) {
    const actual = client._hkdfExpandLabel('sha256', secret, label, context, 32);
    const expected = hkdfExpand('sha256', secret, hkdfLabelInfo(label, context, 32), 32);
    const doublePrefixed = hkdfExpand(
      'sha256',
      secret,
      hkdfLabelInfo(`tls13 ${label}`, context, 32),
      32,
    );

    assert.deepStrictEqual(
      actual,
      expected,
      `${label} should expand with the RFC 8446 label "tls13 ${label}"`,
    );
    assert.notDeepStrictEqual(
      actual,
      doublePrefixed,
      `${label} must not expand as the double-prefixed label "tls13 tls13 ${label}"`,
    );
  }
}

function testDeriveHandshakeKeysPassesUnprefixedTrafficLabels() {
  const client = new TLSHandshakeClient();
  client.negotiatedCipherSuite = CIPHER_SUITES.TLS_AES_128_GCM_SHA256;
  client.negotiatedHash = 'sha256';
  client.transcript = [Buffer.from('client hello'), Buffer.from('server hello')];

  const labels = [];
  client._hkdfExpandLabel = function captureLabel(hash, secret, label, context, length) {
    labels.push(label);
    return Buffer.alloc(length, 0x42);
  };

  client.deriveHandshakeKeys(Buffer.alloc(32, 0x7f));

  assert(labels.includes('derived'), 'derived secret label should be unprefixed');
  assert(labels.includes('c hs traffic'), 'client handshake traffic label should be unprefixed');
  assert(labels.includes('s hs traffic'), 'server handshake traffic label should be unprefixed');
  assert(!labels.some((label) => label.startsWith('tls13 ')), 'callers must not pass pre-prefixed HKDF labels');
}

function run() {
  testHkdfExpandLabelPrefixesTls13ExactlyOnce();
  testDeriveHandshakeKeysPassesUnprefixedTrafficLabels();
  console.log('tls_handshake_client tests passed');
}

run();
