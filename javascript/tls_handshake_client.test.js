'use strict';

const assert = require('assert');
const crypto = require('crypto');
const test = require('node:test');
const { TLSHandshakeClient } = require('./tls_handshake_client');

function hkdfExpandLabel(hash, secret, label, context, length) {
  const tlsLabel = label.startsWith('tls13 ') ? label : `tls13 ${label}`;
  const info = Buffer.concat([
    uint16(length),
    Buffer.from([tlsLabel.length]),
    Buffer.from(tlsLabel, 'ascii'),
    Buffer.from([context.length]),
    context,
  ]);

  const hashLen = hash === 'sha384' ? 48 : 32;
  const rounds = Math.ceil(length / hashLen);
  const output = [];
  let previous = Buffer.alloc(0);

  for (let i = 1; i <= rounds; i++) {
    previous = crypto.createHmac(hash, secret)
      .update(Buffer.concat([previous, info, Buffer.from([i])]))
      .digest();
    output.push(previous);
  }

  return Buffer.concat(output).slice(0, length);
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

test('_hkdfExpandLabel uses exactly one TLS 1.3 label prefix', () => {
  const client = new TLSHandshakeClient();
  const secret = Buffer.alloc(32, 0x11);
  const context = crypto.createHash('sha256').update('handshake transcript').digest();

  for (const label of ['derived', 'c hs traffic', 's hs traffic']) {
    const expected = hkdfExpandLabel('sha256', secret, `tls13 ${label}`, context, 32);
    const actual = client._hkdfExpandLabel('sha256', secret, `tls13 ${label}`, context, 32);

    assert.deepStrictEqual(actual, expected);
  }
});
