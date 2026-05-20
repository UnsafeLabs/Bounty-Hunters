'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { KeySchedule } = require('./tls_key_schedule.js');
const { RecordLayer, MAX_RECORD_PAYLOAD, CONTENT_TYPE_PADDING_SIZE } = require('./tls_record_layer.js');
const { TLSHandshakeClient, TLSError } = require('./tls_handshake_client.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL: ${name} - ${err.message}`);
  }
}

console.log('=== Circular Dependency Test ===');

test('all three modules load without undefined references', () => {
  assert.ok(KeySchedule, 'KeySchedule is defined');
  assert.ok(RecordLayer, 'RecordLayer is defined');
  assert.ok(TLSHandshakeClient, 'TLSHandshakeClient is defined');
});

test('KeySchedule can be instantiated independently', () => {
  const ks = new KeySchedule(0x1301);
  assert.ok(ks instanceof KeySchedule);
  assert.strictEqual(ks.hash, 'sha256');
});

test('RecordLayer can be instantiated independently', () => {
  const ks = new KeySchedule(0x1301);
  const rl = new RecordLayer(ks);
  assert.ok(rl instanceof RecordLayer);
});

test('TLSHandshakeClient creates RecordLayer via factory', () => {
  const client = new TLSHandshakeClient();
  client.negotiatedCipherSuite = 0x1301;
  const rl = client.createRecordLayer();
  assert.ok(rl instanceof RecordLayer);
});

test('RecordLayer.fragmentRecord respects max size before padding', () => {
  const ks = new KeySchedule(0x1301);
  const rl = new RecordLayer(ks);
  const data = crypto.randomBytes(MAX_RECORD_PAYLOAD);
  const fragments = rl.fragmentRecord(data, 0x17);
  assert.strictEqual(fragments.length, 1);
  assert.ok(fragments[0].length <= MAX_RECORD_PAYLOAD);
});

test('RecordLayer.fragmentRecord splits oversized data correctly', () => {
  const ks = new KeySchedule(0x1301);
  const rl = new RecordLayer(ks);
  const data = crypto.randomBytes(MAX_RECORD_PAYLOAD + 100);
  const fragments = rl.fragmentRecord(data, 0x17);
  assert.strictEqual(fragments.length, 2);
  assert.strictEqual(fragments[0].length, MAX_RECORD_PAYLOAD);
});

test('RecordLayer.decryptRecord only increments readSequenceNumber after success', () => {
  const ks = new KeySchedule(0x1301);
  const rl = new RecordLayer(ks);
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const data = Buffer.from('hello tls');
  const seqBefore = rl.readSequenceNumber;
  const record = rl.encryptRecord(data, 0x17, key, iv);
  const result = rl.decryptRecord(record, key, iv);
  assert.ok(result.data.equals(data));
  assert.strictEqual(rl.readSequenceNumber, seqBefore + 1n);
});

test('RecordLayer.decryptRecord does not increment sequence number on failure', () => {
  const ks = new KeySchedule(0x1301);
  const rl = new RecordLayer(ks);
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const wrongKey = crypto.randomBytes(16);
  const data = Buffer.from('test data');
  const record = rl.encryptRecord(data, 0x17, key, iv);
  const seqBefore = rl.readSequenceNumber;
  try {
    rl.decryptRecord(record, wrongKey, iv);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('BAD_RECORD_MAC'));
  }
  assert.strictEqual(rl.readSequenceNumber, seqBefore);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
