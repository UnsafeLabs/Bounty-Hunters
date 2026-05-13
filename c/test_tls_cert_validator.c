#include <assert.h>
#include <openssl/evp.h>
#include <openssl/rsa.h>

#include "tls_cert_validator.c"

static EVP_PKEY *make_test_key(void)
{
    EVP_PKEY *pkey = NULL;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);

    assert(ctx != NULL);
    assert(EVP_PKEY_keygen_init(ctx) == 1);
    assert(EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, 2048) == 1);
    assert(EVP_PKEY_keygen(ctx, &pkey) == 1);
    assert(pkey != NULL);

    EVP_PKEY_CTX_free(ctx);
    return pkey;
}

static X509 *make_test_cert(int not_before_offset, int not_after_offset)
{
    EVP_PKEY *pkey = make_test_key();
    X509 *cert = X509_new();
    X509_NAME *name;

    assert(cert != NULL);
    assert(X509_set_version(cert, 2) == 1);
    assert(ASN1_INTEGER_set(X509_get_serialNumber(cert), 1) == 1);
    assert(X509_gmtime_adj(X509_getm_notBefore(cert), not_before_offset) != NULL);
    assert(X509_gmtime_adj(X509_getm_notAfter(cert), not_after_offset) != NULL);
    assert(X509_set_pubkey(cert, pkey) == 1);

    name = X509_get_subject_name(cert);
    assert(name != NULL);
    assert(X509_NAME_add_entry_by_txt(
        name, "CN", MBSTRING_ASC,
        (const unsigned char *)"Bounty Hunters Test CA", -1, -1, 0) == 1);
    assert(X509_set_issuer_name(cert, name) == 1);
    assert(X509_sign(cert, pkey, EVP_sha256()) > 0);

    EVP_PKEY_free(pkey);
    return cert;
}

static void test_init_cert_store_uses_requested_depth(void)
{
    cert_store_t *store = init_cert_store(8, LOG_LEVEL_ERROR);

    assert(store != NULL);
    assert(store->max_depth == 8);
    assert(store->count == 0);

    cleanup_cert_store(store);
    free(store);
}

static void test_init_cert_store_caps_invalid_depth(void)
{
    cert_store_t *store = init_cert_store(999, LOG_LEVEL_ERROR);

    assert(store != NULL);
    assert(store->max_depth == MAX_CHAIN_DEPTH);

    cleanup_cert_store(store);
    free(store);
}

static void test_compute_fingerprint_returns_sha256_length(void)
{
    X509 *cert = make_test_cert(-60, 3600);
    unsigned char fingerprint[FINGERPRINT_LEN];

    assert(compute_fingerprint(cert, fingerprint, sizeof(fingerprint)) == 0);

    X509_free(cert);
}

static void test_compute_fingerprint_rejects_short_output_buffer(void)
{
    X509 *cert = make_test_cert(-60, 3600);
    unsigned char fingerprint[FINGERPRINT_LEN - 1];

    assert(compute_fingerprint(cert, fingerprint, sizeof(fingerprint)) == -1);

    X509_free(cert);
}

static void test_match_fingerprint_accepts_equal_values(void)
{
    unsigned char left[FINGERPRINT_LEN] = {0};
    unsigned char right[FINGERPRINT_LEN] = {0};

    assert(match_fingerprint(left, right) == 1);
}

static void test_match_fingerprint_rejects_different_values(void)
{
    unsigned char left[FINGERPRINT_LEN] = {0};
    unsigned char right[FINGERPRINT_LEN] = {0};
    right[0] = 1;

    assert(match_fingerprint(left, right) == 0);
}

static void test_check_expiry_accepts_current_certificate(void)
{
    X509 *cert = make_test_cert(-60, 3600);

    assert(check_expiry(cert) == CERT_STATUS_OK);

    X509_free(cert);
}

static void test_check_expiry_rejects_expired_certificate(void)
{
    X509 *cert = make_test_cert(-7200, -3600);

    assert(check_expiry(cert) == CERT_STATUS_EXPIRED);

    X509_free(cert);
}

static void test_add_trusted_cert_inserts_store_entry(void)
{
    cert_store_t *store = init_cert_store(MAX_CHAIN_DEPTH, LOG_LEVEL_ERROR);
    X509 *cert = make_test_cert(-60, 3600);

    assert(add_trusted_cert(store, cert) == 0);
    assert(store->count == 1);
    assert(store->head != NULL);

    X509_free(cert);
    cleanup_cert_store(store);
    free(store);
}

static void test_validate_chain_rejects_invalid_context(void)
{
    assert(validate_chain(NULL) == CERT_STATUS_INVALID);
}

int main(void)
{
    test_init_cert_store_uses_requested_depth();
    test_init_cert_store_caps_invalid_depth();
    test_compute_fingerprint_returns_sha256_length();
    test_compute_fingerprint_rejects_short_output_buffer();
    test_match_fingerprint_accepts_equal_values();
    test_match_fingerprint_rejects_different_values();
    test_check_expiry_accepts_current_certificate();
    test_check_expiry_rejects_expired_certificate();
    test_add_trusted_cert_inserts_store_entry();
    test_validate_chain_rejects_invalid_context();
    return 0;
}
