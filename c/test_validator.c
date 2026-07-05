#include <stdio.h>
#include <openssl/x509.h>
#include <stdio.h>

// Stub for missing log_error
void log_error(const char *module, const char *msg) {
    fprintf(stderr, "[%s] ERROR: %s\n", module, msg);
}

// Include validator code

#include "tls_cert_validator.c"

// Dummy helpers for regression tests
X509* make_dummy_cert(void) {
    return X509_new(); // minimal dummy cert
}

int main(void) {
    chain_context_t ctx = {0};
    cert_store_t *store = init_cert_store(4, LOG_LEVEL_DEBUG);

    // Case 1: Null chain → should return -2
    ctx.trusted_store = store;
    ctx.chain = NULL;
    ctx.chain_len = 0;
    int rc = validate_chain(&ctx);
    fprintf(stderr, "Null chain rc=%d\n", rc);

    // Case 2: Expired cert → simulate expiry failure
    X509 *expired = make_dummy_cert();
    ctx.chain = malloc(sizeof(X509*) * 1);
    ctx.chain[0] = expired;
    ctx.chain_len = 1;
    rc = check_expiry(ctx.chain[0]); // force expiry check
    fprintf(stderr, "Expired cert rc=%d\n", rc);

    // Case 3: Depth failure → simulate too deep chain
    ctx.chain_len = MAX_CHAIN_DEPTH + 1;
    rc = validate_chain(&ctx);
    fprintf(stderr, "Depth failure rc=%d\n", rc);

    // Cleanup
    if (expired) X509_free(expired);
    free(ctx.chain);
    cleanup_cert_store(store);

    return 0;
}
