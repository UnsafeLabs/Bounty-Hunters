'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TLSHandshakeClient, TLSError } = require('./tls_handshake_client.js');

function makeCert(overrides) {
  const now = Date.now();
  const oneDayMs = 86_400_000;
  return {
    subject: 'test.example.com',
    issuer: 'Test Intermediate',
    notBefore: new Date(now - oneDayMs).toISOString(),
    notAfter: new Date(now + 10 * 365 * oneDayMs).toISOString(),
    subjectAltNames: ['test.example.com'],
    ...overrides,
  };
}

describe('TLSHandshakeClient.verifyServerCertificate()', () => {
  it('throws TLSError with alertCode 45 when leaf certificate is expired', () => {
    const client = new TLSHandshakeClient({ hostname: 'test.example.com' });
    const chain = [
      makeCert({
        subject: 'test.example.com',
        issuer: 'Intermediate CA',
        notAfter: '2020-01-01T00:00:00Z',
      }),
      makeCert({ subject: 'Intermediate CA', issuer: 'Root CA' }),
      makeCert({ subject: 'Root CA', issuer: 'Root CA' }),
    ];
    assert.throws(
      () => client.verifyServerCertificate(chain),
      (err) => err instanceof TLSError && err.alertCode === 45,
    );
  });

  it('throws TLSError with alertCode 45 when leaf certificate is not yet valid', () => {
    const client = new TLSHandshakeClient({ hostname: 'test.example.com' });
    const chain = [
      makeCert({
        subject: 'test.example.com',
        issuer: 'Intermediate CA',
        notBefore: '2099-01-01T00:00:00Z',
      }),
      makeCert({ subject: 'Intermediate CA', issuer: 'Root CA' }),
      makeCert({ subject: 'Root CA', issuer: 'Root CA' }),
    ];
    assert.throws(
      () => client.verifyServerCertificate(chain),
      (err) => err instanceof TLSError && err.alertCode === 45,
    );
  });

  it('returns true for a valid certificate chain with matching hostname', () => {
    const client = new TLSHandshakeClient({ hostname: 'test.example.com' });
    const chain = [
      makeCert({ subject: 'test.example.com', issuer: 'Intermediate CA' }),
      makeCert({ subject: 'Intermediate CA', issuer: 'Root CA' }),
      makeCert({ subject: 'Root CA', issuer: 'Root CA' }),
    ];
    const result = client.verifyServerCertificate(chain);
    assert.strictEqual(result, true);
  });

  it('throws TLSError with alertCode 45 when intermediate certificate is expired', () => {
    const client = new TLSHandshakeClient({ hostname: 'test.example.com' });
    const chain = [
      makeCert({ subject: 'test.example.com', issuer: 'Intermediate CA' }),
      makeCert({
        subject: 'Intermediate CA',
        issuer: 'Root CA',
        notAfter: '2020-01-01T00:00:00Z',
      }),
      makeCert({ subject: 'Root CA', issuer: 'Root CA' }),
    ];
    assert.throws(
      () => client.verifyServerCertificate(chain),
      (err) => err instanceof TLSError && err.alertCode === 45,
    );
  });
});
