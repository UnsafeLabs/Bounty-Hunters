#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tls_cert_validator.c"

static cert_entry_t *make_entry(const char *issuer)
{
    cert_entry_t *entry = calloc(1, sizeof(cert_entry_t));
    if (!entry)
        return NULL;

    entry->subject = strdup("subject");
    entry->issuer = strdup(issuer);
    if (!entry->subject || !entry->issuer) {
        free(entry->subject);
        free(entry->issuer);
        free(entry);
        return NULL;
    }

    return entry;
}

int main(void)
{
    cert_store_t store = {0};
    const char *issuers[] = {"issuer-a", "issuer-b", "issuer-c"};

    g_log_level = LOG_LEVEL_DEBUG;
    for (size_t i = 0; i < 3; i++) {
        cert_entry_t *entry = make_entry(issuers[i]);
        if (!entry)
            return 1;

        entry->next = store.head;
        store.head = entry;
        store.count++;
    }

    cleanup_cert_store(&store);
    if (store.head != NULL || store.count != 0) {
        fprintf(stderr, "store was not fully cleaned up\n");
        return 1;
    }

    return 0;
}
