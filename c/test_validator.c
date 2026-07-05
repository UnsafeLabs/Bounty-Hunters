#include "tls_cert_validator.c"

int main(void) {
    cert_store_t *store = init_cert_store(4, LOG_LEVEL_DEBUG);

    X509 *dummy = X509_new();
    add_trusted_cert(store, dummy);

    // Free the original dummy, since the store has its own copy
    X509_free(dummy);

    chain_context_t ctx = {0};
    ctx.trusted_store = store;
    ctx.chain = NULL;   // invalid chain triggers early return

    int rc = validate_chain(&ctx);
    fprintf(stderr, "validate_chain returned %d\n", rc);

    // Free the store structure itself
    free(store);

    return 0;
}
