'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TLSHandshakeClient,
  TLSError,
} = require('./tls_handshake_client');

function makeCertificate(overrides = {}) {
  return {
    subject: 'example.com',
    issuer: 'Example CA',
    subjectAltNames: ['example.com'],
    notBefore: '2020-01-01T00:00:00.000Z',
    notAfter: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function assertBadCertificateTime(certChain, expectedMessage) {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assert.throws(
    () => client.verifyServerCertificate(certChain),
    (err) => err instanceof TLSError
      && err.alertCode === 45
      && err.message.includes(expectedMessage),
  );
}

test('verifyServerCertificate rejects an expired leaf certificate', () => {
  assertBadCertificateTime(
    [makeCertificate({ notAfter: '2000-01-01T00:00:00.000Z' })],
    'has expired',
  );
});

test('verifyServerCertificate rejects a not-yet-valid leaf certificate', () => {
  assertBadCertificateTime(
    [makeCertificate({ notBefore: '2999-01-01T00:00:00.000Z' })],
    'is not yet valid',
  );
});

test('verifyServerCertificate checks validity on every certificate in the chain', () => {
  assertBadCertificateTime(
    [
      makeCertificate({ issuer: 'Example CA' }),
      makeCertificate({
        subject: 'Example CA',
        issuer: 'Root CA',
        subjectAltNames: ['Example CA'],
        notAfter: '2000-01-01T00:00:00.000Z',
      }),
    ],
    'Certificate at index 1 has expired',
  );
});

test('verifyServerCertificate accepts a currently valid certificate chain', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assert.equal(
    client.verifyServerCertificate([
      makeCertificate({ issuer: 'Example CA' }),
      makeCertificate({
        subject: 'Example CA',
        issuer: 'Root CA',
        subjectAltNames: ['Example CA'],
      }),
    ]),
    true,
  );
});
