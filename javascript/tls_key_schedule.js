'use strict';

const crypto = require('crypto');

const CIPHER_SUITE_INFO = {
  0x1301: { hash: 'sha256', keyLen: 16 },
  0x1302: { hash: 'sha384', keyLen: 32 },
  0x1303: { hash: 'sha256', keyLen: 32 },
};

class KeySchedule {
  constructor(cipherSuite) {
    const info = CIPHER_SUITE_INFO[cipherSuite];
    if (!info) {
      throw new Error(`Unknown cipher suite: 0x${cipherSuite.toString(16)}`);
    }
    this.hash = info.hash;
    this.keyLen = info.keyLen;
  }

  hkdfExtract(salt, ikm) {
    return crypto.createHmac(this.hash, salt).update(ikm).digest();
  }

  hkdfExpandLabel(secret, label, context, length) {
    const tlsLabel = `tls13 ${label}`;
    const info = Buffer.concat([
      this._uint16(length),
      Buffer.from([tlsLabel.length]),
      Buffer.from(tlsLabel, 'ascii'),
      Buffer.from([context.length]),
      context,
    ]);

    const hashLen = this.hash === 'sha384' ? 48 : 32;
    const n = Math.ceil(length / hashLen);
    const okm = [];
    let prev = Buffer.alloc(0);

    for (let i = 1; i <= n; i++) {
      prev = crypto.createHmac(this.hash, secret)
        .update(Buffer.concat([prev, info, Buffer.from([i])]))
        .digest();
      okm.push(prev);
    }

    return Buffer.concat(okm).slice(0, length);
  }

  deriveSecret(secret, label, messages) {
    const msgHash = Buffer.isBuffer(messages) && messages.length > 0
      ? messages
      : crypto.createHash(this.hash).update(messages).digest();

    return this.hkdfExpandLabel(secret, label, msgHash, msgHash.length);
  }

  deriveEarlySecret() {
    const hashLen = this.hash === 'sha384' ? 48 : 32;
    const zeroes = Buffer.alloc(hashLen);
    const earlySecret = this.hkdfExtract(Buffer.alloc(hashLen), zeroes);
    return this.deriveSecret(earlySecret, 'derived', Buffer.alloc(0));
  }

  deriveHandshakeSecret(earlySecret, sharedSecret, transcriptHash) {
    const handshakeSecret = this.hkdfExtract(earlySecret, sharedSecret);
    const clientSecret = this.deriveSecret(
      handshakeSecret, 'c hs traffic', transcriptHash,
    );
    const serverSecret = this.deriveSecret(
      handshakeSecret, 's hs traffic', transcriptHash,
    );

    return {
      clientKey: this.hkdfExpandLabel(clientSecret, 'key', Buffer.alloc(0), this.keyLen),
      clientIv: this.hkdfExpandLabel(clientSecret, 'iv', Buffer.alloc(0), 12),
      serverKey: this.hkdfExpandLabel(serverSecret, 'key', Buffer.alloc(0), this.keyLen),
      serverIv: this.hkdfExpandLabel(serverSecret, 'iv', Buffer.alloc(0), 12),
      handshakeSecret,
    };
  }

  computeFinishedHash(baseKey, transcript) {
    const hashLen = this.hash === 'sha384' ? 48 : 32;
    const finishedKey = this.hkdfExpandLabel(
      baseKey, 'finished', Buffer.alloc(0), hashLen,
    );

    const transcriptData = Buffer.isBuffer(transcript)
      ? transcript
      : Buffer.concat(transcript);

    const transcriptHash = crypto.createHash(this.hash).update(transcriptData).digest();

    return crypto.createHmac(this.hash, finishedKey)
      .update(transcriptHash)
      .digest();
  }

  _uint16(value) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value, 0);
    return buf;
  }
}

module.exports = { KeySchedule, CIPHER_SUITE_INFO };
