#include <assert.h>
#include <openssl/x509.h>

#include "../c/tls_cert_validator.c"

int main(void)
{
    X509 *cert = X509_new();
    assert(cert != NULL);

    assert(X509_gmtime_adj(X509_getm_notBefore(cert), -60) != NULL);
    assert(X509_time_adj_ex(X509_getm_notAfter(cert), 25000, 0, NULL) != NULL);

    assert(check_expiry(cert) == CERT_STATUS_OK);

    X509_free(cert);
    return 0;
}
