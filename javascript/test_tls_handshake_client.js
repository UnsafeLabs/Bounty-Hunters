'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { TLSHandshakeClient, TLSError, CIPHER_SUITES, TLS_VERSION, HANDSHAKE_TYPE } = require('./tls_handshake_client.js');

function makeServerHello(cipherSuite) {
  const body = Buffer.alloc(39);
  let offset = 0;
  body.writeUInt8(HANDSHAKE_TYPE.SERVER_HELLO, offset); offset += 1;
  body.writeUInt8(0, offset); body.writeUInt16BE(38 - 4, offset + 1); offset += 4;
  body.writeUInt16BE(TLS_VERSION.TLS_1_2, offset); offset += 2;
  const random = crypto.randomBytes(32);
  random.copy(body, offset); offset += 32;
  body.writeUInt8(0, offset); offset += 1;
  body.writeUInt16BE(cipherSuite, offset); offset += 2;
  body.writeUInt8(0, offset);
  return body;
}

describe('TLSHandshakeClient', () => {
  describe('constructor', () => {
    it('should set default hostname', () => {
      const client = new TLSHandshakeClient();
      assert.strictEqual(client.hostname, 'localhost');
    });

    it('should use provided hostname', () => {
      const client = new TLSHandshakeClient({ hostname: 'example.com' });
      assert.strictEqual(client.hostname, 'example.com');
    });

    it('should use provided cipher suites', () => {
      const suites = [CIPHER_SUITES.TLS_AES_128_GCM_SHA256];
      const client = new TLSHandshakeClient({ cipherSuites: suites });
      assert.deepStrictEqual(client.offeredCipherSuites, suites);
    });
  });

  describe('generateClientHello', () => {
    it('should return a Buffer', () => {
      const client = new TLSHandshakeClient();
      const msg = client.generateClientHello();
      assert(Buffer.isBuffer(msg));
    });

    it('should start with handshake type ClientHello', () => {
      const client = new TLSHandshakeClient();
      const msg = client.generateClientHello();
      assert.strictEqual(msg.readUInt8(0), HANDSHAKE_TYPE.CLIENT_HELLO);
    });

    it('should add to transcript', () => {
      const client = new TLSHandshakeClient();
      client.generateClientHello();
      assert.strictEqual(client.transcript.length, 1);
    });
  });

  describe('parseServerHello', () => {
    it('should parse valid ServerHello', () => {
      const client = new TLSHandshakeClient();
      const buffer = makeServerHello(CIPHER_SUITES.TLS_AES_128_GCM_SHA256);
      const result = client.parseServerHello(buffer);
      assert.ok(result.serverRandom);
      assert.strictEqual(result.cipherSuite, CIPHER_SUITES.TLS_AES_128_GCM_SHA256);
    });

    it('should throw on too short buffer', () => {
      const client = new TLSHandshakeClient();
      assert.throws(() => client.parseServerHello(Buffer.alloc(3)), TLSError);
    });

    it('should throw on wrong handshake type', () => {
      const client = new TLSHandshakeClient();
      const buffer = Buffer.alloc(10);
      buffer.writeUInt8(0xFF, 0);
      assert.throws(() => client.parseServerHello(buffer), TLSError);
    });

    it('should throw on cipher suite not offered', () => {
      const client = new TLSHandshakeClient({ cipherSuites: [CIPHER_SUITES.TLS_AES_128_GCM_SHA256] });
      const buffer = makeServerHello(CIPHER_SUITES.TLS_CHACHA20_POLY1305_SHA256);
      assert.throws(() => client.parseServerHello(buffer), /not in offered/i);
    });
  });

  describe('verifyServerCertificate', () => {
    it('should accept valid certificate chain', () => {
      const client = new TLSHandshakeClient({ hostname: 'example.com' });
      const chain = [
        { subject: 'example.com', issuer: 'CA Root', notBefore: '2020-01-01', notAfter: '2030-01-01', subjectAltNames: ['example.com'] },
        { subject: 'CA Root', issuer: 'CA Root', notBefore: '2020-01-01', notAfter: '2030-01-01' },
      ];
      assert.strictEqual(client.verifyServerCertificate(chain), true);
    });

    it('should reject empty chain', () => {
      const client = new TLSHandshakeClient();
      assert.throws(() => client.verifyServerCertificate([]), TLSError);
    });

    it('should reject expired certificate', () => {
      const client = new TLSHandshakeClient({ hostname: 'example.com' });
      const chain = [
        { subject: 'example.com', issuer: 'CA Root', notBefore: '2020-01-01', notAfter: '2020-06-01' },
      ];
      assert.throws(() => client.verifyServerCertificate(chain), /expired/i);
    });

    it('should reject hostname mismatch', () => {
      const client = new TLSHandshakeClient({ hostname: 'evil.com' });
      const chain = [
        { subject: 'example.com', issuer: 'CA Root', notBefore: '2020-01-01', notAfter: '2030-01-01', subjectAltNames: ['example.com'] },
      ];
      assert.throws(() => client.verifyServerCertificate(chain), /not valid for hostname/i);
    });

    it('should reject broken chain linkage', () => {
      const client = new TLSHandshakeClient({ hostname: 'example.com' });
      const chain = [
        { subject: 'leaf', issuer: 'CA1', notBefore: '2020-01-01', notAfter: '2030-01-01', subjectAltNames: ['example.com'] },
        { subject: 'CA2', issuer: 'CA2', notBefore: '2020-01-01', notAfter: '2030-01-01' },
      ];
      assert.throws(() => client.verifyServerCertificate(chain), /issuer mismatch/i);
    });
  });

  describe('deriveHandshakeKeys', () => {
    it('should derive keys with known structure', () => {
      const client = new TLSHandshakeClient();
      client.negotiatedHash = 'sha256';
      const sharedSecret = crypto.randomBytes(32);
      const keys = client.deriveHandshakeKeys(sharedSecret);
      assert.ok(keys.clientKey);
      assert.ok(keys.clientIv);
      assert.ok(keys.serverKey);
      assert.ok(keys.serverIv);
      assert.strictEqual(keys.clientKey.length, 16);
      assert.strictEqual(keys.clientIv.length, 12);
    });

    it('should throw without negotiated hash', () => {
      const client = new TLSHandshakeClient();
      assert.throws(() => client.deriveHandshakeKeys(crypto.randomBytes(32)), TLSError);
    });
  });

  describe('performKeyExchange', () => {
    it('should produce shared secret', () => {
      const client = new TLSHandshakeClient();
      const serverKey = client.ecdh.generateKeys();
      const secret = client.performKeyExchange(serverKey);
      assert.ok(Buffer.isBuffer(secret));
      assert.ok(secret.length > 0);
    });

    it('should throw on invalid key', () => {
      const client = new TLSHandshakeClient();
      assert.throws(() => client.performKeyExchange(Buffer.alloc(0)), TLSError);
    });
  });

  describe('computeFinishedHash', () => {
    it('should produce deterministic verify data', () => {
      const client = new TLSHandshakeClient();
      client.negotiatedHash = 'sha256';
      const baseKey = crypto.randomBytes(32);
      const transcript = [Buffer.from('test')];
      const hash1 = client.computeFinishedHash(baseKey, transcript);
      const hash2 = client.computeFinishedHash(baseKey, transcript);
      assert.deepStrictEqual(hash1, hash2);
    });
  });

  describe('_matchHostname', () => {
    it('should match exact hostname', () => {
      const client = new TLSHandshakeClient();
      const cert = { subjectAltNames: ['example.com'] };
      assert.strictEqual(client._matchHostname(cert, 'example.com'), true);
    });

    it('should match wildcard hostname', () => {
      const client = new TLSHandshakeClient();
      const cert = { subjectAltNames: ['*.example.com'] };
      assert.strictEqual(client._matchHostname(cert, 'sub.example.com'), true);
    });

    it('should reject non-matching hostname', () => {
      const client = new TLSHandshakeClient();
      const cert = { subjectAltNames: ['example.com'] };
      assert.strictEqual(client._matchHostname(cert, 'evil.com'), false);
    });
  });
});
