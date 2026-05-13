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
    assert(X509_gmtime_adj(X509_getm_notAfter(cert), (long)days_from_now * 86400L) != NULL);
    return cert;
}

static void test_check_expiry_handles_large_remaining_seconds(void)
{
    X509 *cert = make_cert_with_offset_days(25000);
    int day_diff = 0;
    int sec_diff = 0;
    int64_t remaining_seconds = 0;

    assert(ASN1_TIME_diff(&day_diff, &sec_diff, NULL, X509_get0_notAfter(cert)) == 1);
    remaining_seconds = (int64_t)day_diff * 86400 + sec_diff;

    assert(check_expiry(cert) == CERT_STATUS_OK);
    assert(remaining_seconds >= 2160000000LL);

    X509_free(cert);
}

int main(void)
{
    test_check_expiry_handles_large_remaining_seconds();
    return 0;
}
