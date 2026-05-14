'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HANDSHAKE_TYPE,
  TLSHandshakeClient,
  TLS_VERSION,
} = require('./tls_handshake_client.js');

const EXTENSION_TYPE = {
  SUPPORTED_VERSIONS: 0x002b,
  KEY_SHARE: 0x0033,
};

function readClientHelloExtensions(clientHello) {
  let offset = 4; // handshake type + uint24 length

  offset += 2; // legacy version
  offset += 32; // client random

  const sessionIdLength = clientHello.readUInt8(offset);
  offset += 1 + sessionIdLength;

  const cipherSuitesLength = clientHello.readUInt16BE(offset);
  offset += 2 + cipherSuitesLength;

  const compressionMethodsLength = clientHello.readUInt8(offset);
  offset += 1 + compressionMethodsLength;

  const extensionsLength = clientHello.readUInt16BE(offset);
  offset += 2;

  const extensionsEnd = offset + extensionsLength;
  const extensions = [];

  while (offset < extensionsEnd) {
    const type = clientHello.readUInt16BE(offset);
    const length = clientHello.readUInt16BE(offset + 2);
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;

    extensions.push({
      type,
      data: clientHello.subarray(dataStart, dataEnd),
    });

    offset = dataEnd;
  }

  assert.equal(offset, extensionsEnd);
  return extensions;
}

test('ClientHello advertises TLS 1.3 in supported_versions after key_share', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });
  const clientHello = client.generateClientHello();

  assert.equal(clientHello.readUInt8(0), HANDSHAKE_TYPE.CLIENT_HELLO);

  const extensions = readClientHelloExtensions(clientHello);
  const extensionTypes = extensions.map((extension) => extension.type);
  const keyShareIndex = extensionTypes.indexOf(EXTENSION_TYPE.KEY_SHARE);
  const supportedVersionsIndex = extensionTypes.indexOf(EXTENSION_TYPE.SUPPORTED_VERSIONS);
  const supportedVersionsCount = extensionTypes.filter(
    (type) => type === EXTENSION_TYPE.SUPPORTED_VERSIONS,
  ).length;

  assert.notEqual(keyShareIndex, -1);
  assert.notEqual(supportedVersionsIndex, -1);
  assert.equal(supportedVersionsCount, 1);
  assert.ok(supportedVersionsIndex > keyShareIndex);

  const supportedVersions = extensions[supportedVersionsIndex].data;
  assert.equal(supportedVersions.readUInt8(0), 2);
  assert.equal(supportedVersions.readUInt16BE(1), TLS_VERSION.TLS_1_3);
});
