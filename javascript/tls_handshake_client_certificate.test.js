'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { TLSError, TLSHandshakeClient } = require('./tls_handshake_client.js');

const VALID_FROM = '2020-01-01T00:00:00Z';
const VALID_TO = '2099-01-01T00:00:00Z';

function certificate(overrides = {}) {
  return {
    subject: 'example.com',
    issuer: 'Example Root CA',
    subjectAltNames: ['example.com'],
    notBefore: VALID_FROM,
    notAfter: VALID_TO,
    ...overrides,
  };
}

function rootCertificate(overrides = {}) {
  return certificate({
    subject: 'Example Root CA',
    issuer: 'Example Root CA',
    subjectAltNames: [],
    ...overrides,
  });
}

function assertValidityError(fn, pattern) {
  assert.throws(
    fn,
    (error) => (
      error instanceof TLSError
      && error.alertCode === 45
      && pattern.test(error.message)
    ),
  );
}

test('verifyServerCertificate accepts certificates inside their validity period', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assert.equal(
    client.verifyServerCertificate([certificate(), rootCertificate()]),
    true,
  );
});

test('verifyServerCertificate rejects expired leaf certificates', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assertValidityError(
    () => client.verifyServerCertificate([
      certificate({ notAfter: '2001-01-01T00:00:00Z' }),
      rootCertificate(),
    ]),
    /expired/,
  );
});

test('verifyServerCertificate rejects not-yet-valid leaf certificates', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assertValidityError(
    () => client.verifyServerCertificate([
      certificate({ notBefore: '2999-01-01T00:00:00Z' }),
      rootCertificate(),
    ]),
    /not yet valid/,
  );
});

test('verifyServerCertificate checks intermediate certificate validity', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assertValidityError(
    () => client.verifyServerCertificate([
      certificate(),
      rootCertificate({ notAfter: '2001-01-01T00:00:00Z' }),
    ]),
    /expired/,
  );
});

test('verifyServerCertificate rejects not-yet-valid intermediate certificates', () => {
  const client = new TLSHandshakeClient({ hostname: 'example.com' });

  assertValidityError(
    () => client.verifyServerCertificate([
      certificate(),
      rootCertificate({ notBefore: '2999-01-01T00:00:00Z' }),
    ]),
    /not yet valid/,
  );
});
