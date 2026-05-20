'use strict';

const crypto = require('crypto');
const { KeySchedule } = require('./tls_key_schedule.js');

const MAX_RECORD_PAYLOAD = 16384;
const CONTENT_TYPE_PADDING_SIZE = 256;

class RecordLayer {
  constructor(keySchedule) {
    if (!keySchedule || !(keySchedule instanceof KeySchedule)) {
      throw new Error('RecordLayer requires a KeySchedule instance');
    }
    this.keySchedule = keySchedule;
    this.readSequenceNumber = 0n;
    this.writeSequenceNumber = 0n;
  }

  fragmentRecord(data, contentType) {
    if (!Buffer.isBuffer(data)) {
      throw new Error('data must be a Buffer');
    }

    const fragments = [];

    for (let offset = 0; offset < data.length; offset += MAX_RECORD_PAYLOAD) {
      const chunk = data.slice(offset, offset + MAX_RECORD_PAYLOAD);
      fragments.push({
        type: contentType,
        version: 0x0303,
        length: chunk.length,
        fragment: chunk,
      });
    }

    if (fragments.length === 0) {
      fragments.push({
        type: contentType,
        version: 0x0303,
        length: 0,
        fragment: Buffer.alloc(0),
      });
    }

    return fragments;
  }

  encryptRecord(data, contentType, key, iv) {
    const padded = this._addPadding(data, contentType);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    const authTag = cipher.getAuthTag();

    this.writeSequenceNumber++;

    return {
      type: 0x17,
      version: 0x0303,
      length: encrypted.length + authTag.length,
      fragment: Buffer.concat([encrypted, authTag]),
    };
  }

  decryptRecord(record, key, iv) {
    if (!Buffer.isBuffer(record.fragment) || record.fragment.length < 17) {
      throw new Error('Record too short for decryption');
    }

    const encrypted = record.fragment.slice(0, -16);
    const authTag = record.fragment.slice(-16);

    let plaintext;
    try {
      const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from([]));
      plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (err) {
      throw new Error('BAD_RECORD_MAC');
    }

    this.readSequenceNumber++;

    const result = this._removePadding(plaintext);
    return result;
  }

  _addPadding(data, contentType) {
    const inner = Buffer.concat([data, Buffer.from([contentType])]);
    const padLen = (256 - (inner.length % 256)) % 256;
    return Buffer.concat([inner, Buffer.alloc(padLen)]);
  }

  _removePadding(data) {
    let idx = data.length - 1;
    while (idx >= 0 && data[idx] === 0) {
      idx--;
    }
    if (idx < 0) {
      return { data: Buffer.alloc(0), contentType: 0x17 };
    }
    const contentType = data[idx];
    return { data: data.slice(0, idx), contentType };
  }

  resetSequenceNumbers() {
    this.readSequenceNumber = 0n;
    this.writeSequenceNumber = 0n;
  }
}

module.exports = { RecordLayer, MAX_RECORD_PAYLOAD, CONTENT_TYPE_PADDING_SIZE };
