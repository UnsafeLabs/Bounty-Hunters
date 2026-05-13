#include <assert.h>
#include <stdint.h>
#include <time.h>
#include <openssl/x509.h>

#include "tls_cert_validator.c"

static X509 *make_cert_with_offset_days(int days_from_now)
{
    X509 *cert = X509_new();
    assert(cert != NULL);

    assert(X509_gmtime_adj(X509_getm_notBefore(cert), -60) != NULL);
    assert(X509_time_adj_ex(X509_getm_notAfter(cert), days_from_now, 0, NULL) != NULL);
    return cert;
}

static void test_check_expiry_handles_large_remaining_seconds(void)
{
    X509 *cert = make_cert_with_offset_days(25000);
    int64_t remaining_seconds = 0;

    assert(get_remaining_seconds(X509_get0_notAfter(cert), &remaining_seconds) == 1);
    assert(check_expiry(cert) == CERT_STATUS_OK);
    assert(remaining_seconds > INT32_MAX);
    assert(remaining_seconds > (int64_t)86400 * 30);

    X509_free(cert);
}

int main(void)
{
    test_check_expiry_handles_large_remaining_seconds();
    return 0;
}
