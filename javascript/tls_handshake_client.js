// issue #390
'use strict';

const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

const TLS_VERSION = {
  TLS_1_2: 0x0303,
  TLS_1_3: 0x0304,
};

const HANDSHAKE_TYPE = {
  CLIENT_HELLO: 0x01,
  SERVER_HELLO: 0x02,
  ENCRYPTED_EXTENSIONS: 0x08,
  CERTIFICATE: 0x0b,
  CERTIFICATE_VERIFY: 0x0f,
  FINISHED: 0x14,
};

const EXTENSION_TYPE = {
  SERVER_NAME: 0x0000,
  SUPPORTED_GROUPS: 0x000a,
  SIGNATURE_ALGORITHMS: 0x000d,
  SUPPORTED_VERSIONS: 0x002b,
  KEY_SHARE: 0x0033,
};

const CIPHER_SUITES = {
  TLS_AES_128_GCM_SHA256: 0x1301,
  TLS_AES_256_GCM_SHA384: 0x1302,
  TLS_CHACHA20_POLY1305_SHA256: 0x1303,
};

const CIPHER_SUITE_INFO = {
  [CIPHER_SUITES.TLS_AES_128_GCM_SHA256]: { hash: 'sha256', keyLen: 16 },
  [CIPHER_SUITES.TLS_AES_256_GCM_SHA384]: { hash: 'sha384', keyLen: 32 },
  [CIPHER_SUITES.TLS_CHACHA20_POLY1305_SHA256]: { hash: 'sha256', keyLen: 32 },
};

const NAMED_GROUP = {
  X25519: 0x001d,
  SECP256R1: 0x0017,
};

// ============================================================================
// Custom Error
// ============================================================================

class TLSError extends Error {
  constructor(message, alertCode = 80) {
    super(message);
    this.name = 'TLSError';
    this.alertCode = alertCode;
  }
}

// ============================================================================
// TLSHandshakeClient
// ============================================================================

class TLSHandshakeClient {
  constructor(options = {}) {
    this.hostname = options.hostname || 'localhost';
    this.offeredCipherSuites = options.cipherSuites || [
      CIPHER_SUITES.TLS_AES_128_GCM_SHA256,
      CIPHER_SUITES.TLS_AES_256_GCM_SHA384,
      CIPHER_SUITES.TLS_CHACHA20_POLY1305_SHA256,
    ];
    this.negotiatedCipherSuite = null;
    this.negotiatedHash = null;
    this.ecdh = crypto.createECDH('prime256v1');
    this.ecdh.generateKeys();
    this.clientRandom = crypto.randomBytes(32);
    this.transcript = [];
  }

  // --------------------------------------------------------------------------
  // ClientHello
  // --------------------------------------------------------------------------

  generateClientHello() {
    const sessionId = crypto.randomBytes(32);
    const cipherSuiteBytes = Buffer.alloc(this.offeredCipherSuites.length * 2);
    for (let i = 0; i < this.offeredCipherSuites.length; i++) {
      cipherSuiteBytes.writeUInt16BE(this.offeredCipherSuites[i], i * 2);
    }

    const extensions = Buffer.concat([
      this._buildSNIExtension(this.hostname),
      this._buildSupportedVersionsExtension(),
      this._buildSupportedGroupsExtension(),
      this._buildSignatureAlgorithmsExtension(),
      this._buildKeyShareExtension(),
    ]);

    const body = Buffer.concat([
      this._uint16(TLS_VERSION.TLS_1_2), // legacy version for compatibility
      this.clientRandom,
      Buffer.from([sessionId.length]),
      sessionId,
      this._uint16(cipherSuiteBytes.length),
      cipherSuiteBytes,
      Buffer.from([0x01, 0x00]),          // compression methods: null
      this._uint16(extensions.length),
      extensions,
    ]);

    const handshakeMsg = Buffer.concat([
      Buffer.from([HANDSHAKE_TYPE.CLIENT_HELLO]),
      this._uint24(body.length),
      body,
    ]);

    this.transcript.push(handshakeMsg);
    return handshakeMsg;
  }

  // --------------------------------------------------------------------------
  // ServerHello parsing
  // --------------------------------------------------------------------------

  parseServerHello(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 6) {
      throw new TLSError('ServerHello message too short', 50);
    }

    const handshakeType = buffer.readUInt8(0);
    if (handshakeType !== HANDSHAKE_TYPE.SERVER_HELLO) {
      throw new TLSError(
        `Expected ServerHello (0x02), got 0x${handshakeType.toString(16)}`,
        10,
      );
    }

    let offset = 4; // skip type (1) + length (3)

    const legacyVersion = buffer.readUInt16BE(offset);
    offset += 2;
    if (legacyVersion !== TLS_VERSION.TLS_1_2) {
      throw new TLSError('Unexpected legacy version in ServerHello', 70);
    }

    const serverRandom = buffer.slice(offset, offset + 32);
    offset += 32;

    const sessionIdLen = buffer.readUInt8(offset);
    offset += 1 + sessionIdLen;

    const serverCipherSuite = buffer.readUInt16BE(offset);
    offset += 2;

    // Validate that the server picked a cipher suite we actually offered
    if (!this.offeredCipherSuites.includes(serverCipherSuite)) {
      throw new TLSError(
        `Server selected cipher suite 0x${serverCipherSuite.toString(16)} not in offered list`,
        47,
      );
    }

    this.negotiatedCipherSuite = serverCipherSuite;
    const suiteInfo = CIPHER_SUITE_INFO[serverCipherSuite];
    if (!suiteInfo) {
      throw new TLSError('Unknown cipher suite info', 80);
    }
    this.negotiatedHash = suiteInfo.hash;

    const compressionMethod = buffer.readUInt8(offset);
    offset += 1;
    if (compressionMethod !== 0x00) {
      throw new TLSError('Server selected non-null compression', 47);
    }

    this.transcript.push(buffer);

    return {
      serverRandom,
      cipherSuite: serverCipherSuite,
      hash: this.negotiatedHash,
    };
  }

  // --------------------------------------------------------------------------
  // Key derivation (HKDF-based)
  // --------------------------------------------------------------------------

  deriveHandshakeKeys(sharedSecret) {
    if (!this.negotiatedHash) {
      throw new TLSError('Cipher suite not yet negotiated');
    }

    const hash = this.negotiatedHash; // uses the negotiated hash, not hardcoded
    const hashLen = hash === 'sha384' ? 48 : 32;
    const zeroes = Buffer.alloc(hashLen);

    // Early secret
    const earlySecret = this._hkdfExtract(hash, Buffer.alloc(hashLen), zeroes);

    // Derive secret for handshake
    const derivedSecret = this._deriveSecret(hash, earlySecret, 'derived', Buffer.alloc(0));

    // Handshake secret
    const handshakeSecret = this._hkdfExtract(hash, derivedSecret, sharedSecret);

    // Transcript hash
    const transcriptData = Buffer.concat(this.transcript);
    const transcriptHash = crypto.createHash(hash).update(transcriptData).digest();

    // Client and server handshake traffic secrets
    const clientSecret = this._deriveSecret(
      hash, handshakeSecret, 'c hs traffic', transcriptHash,
    );
    const serverSecret = this._deriveSecret(
      hash, handshakeSecret, 's hs traffic', transcriptHash,
    );

    const keyLen = CIPHER_SUITE_INFO[this.negotiatedCipherSuite].keyLen;

    return {
      clientKey: this._hkdfExpandLabel(hash, clientSecret, 'key', Buffer.alloc(0), keyLen),
      clientIv: this._hkdfExpandLabel(hash, clientSecret, 'iv', Buffer.alloc(0), 12),
      serverKey: this._hkdfExpandLabel(hash, serverSecret, 'key', Buffer.alloc(0), keyLen),
      serverIv: this._hkdfExpandLabel(hash, serverSecret, 'iv', Buffer.alloc(0), 12),
      handshakeSecret,
    };
  }

  // --------------------------------------------------------------------------
  // Certificate verification
  // --------------------------------------------------------------------------

  verifyServerCertificate(certChain) {
    if (!Array.isArray(certChain) || certChain.length === 0) {
      throw new TLSError('Empty certificate chain', 42);
    }

    for (let i = 0; i < certChain.length; i++) {
      const cert = certChain[i];

      if (!cert || !cert.subject || !cert.issuer) {
        throw new TLSError(`Malformed certificate at index ${i}`, 43);
      }

      // Check certificate expiry — both notBefore and notAfter
      const now = new Date();
      if (cert.notBefore && now < new Date(cert.notBefore)) {
        throw new TLSError(`Certificate at index ${i} is not yet valid`, 45);
      }
      if (cert.notAfter && now > new Date(cert.notAfter)) {
        throw new TLSError(`Certificate at index ${i} has expired`, 45);
      }

      // Verify hostname on leaf certificate
      if (i === 0) {
        const validForHost = this._matchHostname(cert, this.hostname);
        if (!validForHost) {
          throw new TLSError(
            `Certificate not valid for hostname "${this.hostname}"`,
            42,
          );
        }
      }

      // Verify chain linkage (issuer of current == subject of next)
      if (i < certChain.length - 1) {
        const issuerCert = certChain[i + 1];
        if (cert.issuer !== issuerCert.subject) {
          throw new TLSError(
            `Certificate chain broken at index ${i}: issuer mismatch`,
            42,
          );
        }
      }
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Finished hash computation
  // --------------------------------------------------------------------------

  computeFinishedHash(baseKey, transcript) {
    if (!this.negotiatedHash) {
      throw new TLSError('Hash algorithm not negotiated');
    }

    // Use the negotiated hash algorithm, not a hardcoded one
    const hash = this.negotiatedHash;
    const hashLen = hash === 'sha384' ? 48 : 32;

    const finishedKey = this._hkdfExpandLabel(
      hash, baseKey, 'finished', Buffer.alloc(0), hashLen,
    );

    const transcriptData = Buffer.isBuffer(transcript)
      ? transcript
      : Buffer.concat(transcript);

    const transcriptHash = crypto.createHash(hash).update(transcriptData).digest();

    const verifyData = crypto.createHmac(hash, finishedKey)
      .update(transcriptHash)
      .digest();

    return verifyData;
  }

  // --------------------------------------------------------------------------
  // ECDH key exchange
  // --------------------------------------------------------------------------

  performKeyExchange(serverPublicKey) {
    if (!Buffer.isBuffer(serverPublicKey) || serverPublicKey.length === 0) {
      throw new TLSError('Invalid server public key', 47);
    }

    try {
      const sharedSecret = this.ecdh.computeSecret(serverPublicKey);
      return sharedSecret;
    } catch (err) {
      throw new TLSError(`Key exchange failed: ${err.message}`, 40);
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  _buildSNIExtension(hostname) {
    const nameBytes = Buffer.from(hostname, 'ascii');
    const nameEntry = Buffer.concat([
      Buffer.from([0x00]),             // host_name type
      this._uint16(nameBytes.length),
      nameBytes,
    ]);
    const nameList = Buffer.concat([this._uint16(nameEntry.length), nameEntry]);
    return this._wrapExtension(EXTENSION_TYPE.SERVER_NAME, nameList);
  }

  _buildSupportedVersionsExtension() {
    const versions = Buffer.alloc(3);
    versions.writeUInt8(2, 0);                         // 2 bytes of version data
    versions.writeUInt16BE(TLS_VERSION.TLS_1_3, 1);    // TLS 1.3
    return this._wrapExtension(EXTENSION_TYPE.SUPPORTED_VERSIONS, versions);
  }

  _buildSupportedGroupsExtension() {
    const groups = Buffer.alloc(6);
    groups.writeUInt16BE(4, 0);                   // 4 bytes follow
    groups.writeUInt16BE(NAMED_GROUP.X25519, 2);
    groups.writeUInt16BE(NAMED_GROUP.SECP256R1, 4);
    return this._wrapExtension(EXTENSION_TYPE.SUPPORTED_GROUPS, groups);
  }

  _buildSignatureAlgorithmsExtension() {
    const algos = Buffer.from([
      0x00, 0x04,       // length: 4 bytes (2 algorithms)
      0x04, 0x03,       // ecdsa_secp256r1_sha256
      0x08, 0x04,       // rsa_pss_rsae_sha256
    ]);
    return this._wrapExtension(EXTENSION_TYPE.SIGNATURE_ALGORITHMS, algos);
  }

  _buildKeyShareExtension() {
    const publicKey = this.ecdh.getPublicKey();
    const entry = Buffer.concat([
      this._uint16(NAMED_GROUP.SECP256R1),
      this._uint16(publicKey.length),
      publicKey,
    ]);
    const payload = Buffer.concat([this._uint16(entry.length), entry]);
    return this._wrapExtension(EXTENSION_TYPE.KEY_SHARE, payload);
  }

  _wrapExtension(type, data) {
    return Buffer.concat([
      this._uint16(type),
      this._uint16(data.length),
      data,
    ]);
  }

  _hkdfExtract(hash, salt, ikm) {
    return crypto.createHmac(hash, salt).update(ikm).digest();
  }

  _hkdfExpandLabel(hash, secret, label, context, length) {
    const tlsLabel = `tls13 ${label}`;
    const info = Buffer.concat([
      this._uint16(length),
      Buffer.from([tlsLabel.length]),
      Buffer.from(tlsLabel, 'ascii'),
      Buffer.from([context.length]),
      context,
    ]);

    // HKDF-Expand using HMAC iteration
    const hashLen = hash === 'sha384' ? 48 : 32;
    const n = Math.ceil(length / hashLen);
    const okm = [];
    let prev = Buffer.alloc(0);

    for (let i = 1; i <= n; i++) {
      prev = crypto.createHmac(hash, secret)
        .update(Buffer.concat([prev, info, Buffer.from([i])]))
        .digest();
      okm.push(prev);
    }

    return Buffer.concat(okm).slice(0, length);
  }

  _deriveSecret(hash, secret, label, messages) {
    const msgHash = Buffer.isBuffer(messages) && messages.length > 0
      ? messages
      : crypto.createHash(hash).update(messages).digest();

    return this._hkdfExpandLabel(hash, secret, label, msgHash, msgHash.length);
  }

  _matchHostname(cert, hostname) {
    if (cert.subjectAltNames && Array.isArray(cert.subjectAltNames)) {
      return cert.subjectAltNames.some((san) => {
        if (san.startsWith('*.')) {
          const wildcard = san.slice(2);
          const domainPart = hostname.slice(hostname.indexOf('.') + 1);
          return domainPart === wildcard;
        }
        return san === hostname;
      });
    }
    return cert.subject === hostname;
  }

  _uint16(value) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value, 0);
    return buf;
  }

  _uint24(value) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8((value >> 16) & 0xff, 0);
    buf.writeUInt8((value >> 8) & 0xff, 1);
    buf.writeUInt8(value & 0xff, 2);
    return buf;
  }
}

module.exports = { TLSHandshakeClient, TLSError, CIPHER_SUITES, TLS_VERSION, HANDSHAKE_TYPE };
