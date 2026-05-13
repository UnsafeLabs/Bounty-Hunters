#include <stdio.h>

#include "tls_cert_validator.c"

int main(void)
{
    X509 *cert = X509_new();
    if (!cert)
        return 1;

    if (!X509_gmtime_adj(X509_getm_notBefore(cert), -60)) {
        X509_free(cert);
        return 1;
    }

    if (!X509_gmtime_adj(X509_getm_notAfter(cert), 25000L * 86400L)) {
        X509_free(cert);
        return 1;
    }

    g_log_level = LOG_LEVEL_ERROR;
    int rc = check_expiry(cert);
    X509_free(cert);

    if (rc != CERT_STATUS_OK) {
        fprintf(stderr, "expected long-lived cert to be valid, got %d\n", rc);
        return 1;
    }

    return 0;
}
