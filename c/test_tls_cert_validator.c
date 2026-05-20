#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <stdarg.h>
#include <time.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/bio.h>
#include <openssl/err.h>

#include "tls_cert_validator.c"

static int tests_passed = 0;
static int tests_failed = 0;
static jmp_buf abort_buf;
static int test_aborted = 0;

#define TEST(name) do { \
    printf("  TEST: %s ... ", name); \
    fflush(stdout); \
    test_aborted = 0; \
    if (setjmp(abort_buf) == 0) {

#define END_TEST \
        printf("PASS\n"); \
        tests_passed++; \
    } else { \
        tests_failed++; \
    } \
} while(0)

#define FAIL(msg) do { \
    printf("FAIL: %s\n", msg); \
    longjmp(abort_buf, 1); \
} while(0)

#define ASSERT_EQ(a, b) do { \
    if ((a) != (b)) { \
        printf("FAIL: expected %d, got %d\n", (int)(a), (int)(b)); \
        longjmp(abort_buf, 1); \
    } \
} while(0)

#define ASSERT_NE(a, b) do { \
    if ((a) == (b)) { \
        printf("FAIL: expected not %d\n", (int)(a)); \
        longjmp(abort_buf, 1); \
    } \
} while(0)

#define ASSERT_TRUE(cond) do { \
    if (!(cond)) { \
        printf("FAIL: condition false\n"); \
        longjmp(abort_buf, 1); \
    } \
} while(0)

/* Helper: create a self-signed cert for testing */
static X509 *create_test_cert(const char *cn, int days_valid) {
    X509 *cert = X509_new();
    EVP_PKEY *pkey = EVP_PKEY_new();
    RSA *rsa = RSA_new();
    BIGNUM *bn = BN_new();
    time_t now = time(NULL);

    if (!cert || !pkey || !rsa || !bn) {
        X509_free(cert);
        EVP_PKEY_free(pkey);
        RSA_free(rsa);
        BN_free(bn);
        return NULL;
    }

    BN_set_word(bn, RSA_F4);
    RSA_generate_key_ex(rsa, 2048, bn, NULL);
    EVP_PKEY_assign_RSA(pkey, rsa);

    X509_set_version(cert, 2);
    ASN1_INTEGER_set(X509_get_serialNumber(cert), rand());

    X509_NAME *name = X509_get_subject_name(cert);
    X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC,
                               (const unsigned char *)cn, -1, -1, 0);
    X509_set_issuer_name(cert, name);

    X509_gmtime_adj(X509_getm_notBefore(cert), 0);
    X509_gmtime_adj(X509_getm_notAfter(cert), days_valid * 86400L);

    X509_set_pubkey(cert, pkey);
    X509_sign(cert, pkey, EVP_sha256());

    EVP_PKEY_free(pkey);
    BN_free(bn);
    return cert;
}

static void test_init_cert_store(void) {
    TEST("init_cert_store creates valid store") {
        cert_store_t *store = init_cert_store(10, LOG_LEVEL_ERROR);
        ASSERT_NE(store, NULL);
        ASSERT_EQ(store->count, 0);
        ASSERT_EQ(store->max_depth, 10);
        cleanup_cert_store(store);
    } END_TEST;
}

static void test_add_trusted_cert(void) {
    TEST("add_trusted_cert works") {
        cert_store_t *store = init_cert_store(10, LOG_LEVEL_ERROR);
        X509 *cert = create_test_cert("Test CA", 365);
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(add_trusted_cert(store, cert), 0);
        ASSERT_EQ(store->count, 1);
        X509_free(cert);
        cleanup_cert_store(store);
    } END_TEST;

    TEST("add_trusted_cert rejects NULL") {
        cert_store_t *store = init_cert_store(10, LOG_LEVEL_ERROR);
        ASSERT_EQ(add_trusted_cert(store, NULL), -1);
        ASSERT_EQ(add_trusted_cert(NULL, NULL), -1);
        cleanup_cert_store(store);
    } END_TEST;
}

static void test_check_expiry(void) {
    TEST("check_expiry on valid cert") {
        X509 *cert = create_test_cert("test", 365);
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(check_expiry(cert), CERT_STATUS_OK);
        X509_free(cert);
    } END_TEST;

    TEST("check_expiry on expired cert") {
        X509 *cert = create_test_cert("test", -1);
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(check_expiry(cert), CERT_STATUS_EXPIRED);
        X509_free(cert);
    } END_TEST;
}

static void test_compute_fingerprint(void) {
    TEST("compute_fingerprint returns correct length") {
        X509 *cert = create_test_cert("test", 365);
        unsigned char fp[FINGERPRINT_LEN];
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(compute_fingerprint(cert, fp, sizeof(fp)), 0);
        X509_free(cert);
    } END_TEST;

    TEST("compute_fingerprint deterministic") {
        X509 *cert = create_test_cert("test", 365);
        unsigned char fp1[FINGERPRINT_LEN], fp2[FINGERPRINT_LEN];
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(compute_fingerprint(cert, fp1, sizeof(fp1)), 0);
        ASSERT_EQ(compute_fingerprint(cert, fp2, sizeof(fp2)), 0);
        ASSERT_EQ(memcmp(fp1, fp2, FINGERPRINT_LEN), 0);
        X509_free(cert);
    } END_TEST;
}

static void test_match_fingerprint(void) {
    TEST("match_fingerprint matches identical") {
        unsigned char fp1[FINGERPRINT_LEN], fp2[FINGERPRINT_LEN];
        memset(fp1, 0xAB, FINGERPRINT_LEN);
        memset(fp2, 0xAB, FINGERPRINT_LEN);
        ASSERT_TRUE(match_fingerprint(fp1, fp2));
    } END_TEST;

    TEST("match_fingerprint rejects different") {
        unsigned char fp1[FINGERPRINT_LEN], fp2[FINGERPRINT_LEN];
        memset(fp1, 0xAB, FINGERPRINT_LEN);
        memset(fp2, 0xCD, FINGERPRINT_LEN);
        ASSERT_TRUE(!match_fingerprint(fp1, fp2));
    } END_TEST;
}

static void test_verify_signature(void) {
    TEST("verify_signature self-signed passes") {
        X509 *cert = create_test_cert("test", 365);
        ASSERT_NE(cert, NULL);
        ASSERT_EQ(verify_signature(cert, cert), CERT_STATUS_OK);
        X509_free(cert);
    } END_TEST;
}

int main(void) {
    srand((unsigned int)time(NULL));

    printf("=== tls_cert_validator test suite ===\n\n");

    test_init_cert_store();
    test_add_trusted_cert();
    test_check_expiry();
    test_compute_fingerprint();
    test_match_fingerprint();
    test_verify_signature();

    printf("\n=== Results: %d passed, %d failed ===\n",
           tests_passed, tests_failed);

    return tests_failed > 0 ? 1 : 0;
}
