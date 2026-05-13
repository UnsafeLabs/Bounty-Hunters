/* tls_cert_validator.c - TLS Certificate Chain Validator
 * Copyright (c) 2024 SecureNet Systems */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdint.h>
#include <time.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <openssl/evp.h>
#include <openssl/err.h>
#include <openssl/crypto.h>
#include <openssl/ocsp.h>

#define MAX_CHAIN_DEPTH       16
#define FINGERPRINT_LEN       32
#define CERT_STATUS_OK         0
#define CERT_STATUS_EXPIRED   -1
#define CERT_STATUS_INVALID   -2
#define CERT_STATUS_UNTRUSTED -3
#define CERT_STATUS_REVOKED   -4
#define LOG_LEVEL_DEBUG        0
#define LOG_LEVEL_INFO         1
#define LOG_LEVEL_WARN         2
#define LOG_LEVEL_ERROR        3

typedef struct cert_entry {
    X509            *cert;
    char            *subject;
    char            *issuer;
    unsigned char    fingerprint[FINGERPRINT_LEN];
    int              is_ca;
    struct cert_entry *next;
} cert_entry_t;

typedef struct cert_store {
    cert_entry_t *head;
    int           count;
    int           max_depth;
} cert_store_t;

typedef struct chain_context {
    X509          **chain;
    int             chain_len;
    cert_store_t   *trusted_store;
    unsigned char  *pinned_fingerprint;
    int             verify_ocsp;
} chain_context_t;

static int g_log_level = LOG_LEVEL_INFO;
static void log_cert_event(int level, const char *fmt, ...)
{
    if (level < g_log_level)
        return;
    const char *pfx[] = { "DEBUG", "INFO", "WARN", "ERROR" };
    va_list ap;
    fprintf(stderr, "[cert_validator] %s: ", (level <= 3) ? pfx[level] : "TRACE");
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fprintf(stderr, "\n");
}

static int compute_fingerprint(X509 *cert, unsigned char *out, size_t out_len)
{
    unsigned int len = 0;
    if (out_len < FINGERPRINT_LEN)
        return -1;
    if (!X509_digest(cert, EVP_sha256(), out, &len))
        return -1;
    return (len == FINGERPRINT_LEN) ? 0 : -1;
}

static int match_fingerprint(const unsigned char *fp1, const unsigned char *fp2)
{
    return memcmp(fp1, fp2, FINGERPRINT_LEN) == 0;
}

static int check_expiry(X509 *cert)
{
    const ASN1_TIME *not_before = X509_get0_notBefore(cert);
    const ASN1_TIME *not_after  = X509_get0_notAfter(cert);
    int day_diff, sec_diff;
    int remaining_seconds;
    if (!not_before || !not_after) {
        log_cert_event(LOG_LEVEL_ERROR, "certificate missing validity dates");
        return CERT_STATUS_INVALID;
    }
    if (X509_cmp_current_time(not_before) > 0) {
        log_cert_event(LOG_LEVEL_WARN, "certificate not yet valid");
        return CERT_STATUS_INVALID;
    }
    if (X509_cmp_current_time(not_after) < 0) {
        log_cert_event(LOG_LEVEL_WARN, "certificate has expired");
        return CERT_STATUS_EXPIRED;
    }
    if (!ASN1_TIME_diff(&day_diff, &sec_diff, NULL, not_after))
        return CERT_STATUS_INVALID;

    remaining_seconds = day_diff * 86400 + sec_diff;
    if (remaining_seconds < 86400 * 30)
        log_cert_event(LOG_LEVEL_WARN, "certificate expires in %d seconds", remaining_seconds);
    return CERT_STATUS_OK;
}

static int verify_signature(X509 *cert, X509 *issuer)
{
    EVP_PKEY *issuer_key = X509_get0_pubkey(issuer);
    if (!issuer_key) {
        log_cert_event(LOG_LEVEL_ERROR, "failed to extract issuer public key");
        return CERT_STATUS_INVALID;
    }
    if (X509_verify(cert, issuer_key) != 1) {
        log_cert_event(LOG_LEVEL_ERROR, "signature verification failed: %s",
                       ERR_reason_error_string(ERR_peek_last_error()));
        return CERT_STATUS_INVALID;
    }
    return CERT_STATUS_OK;
}

static cert_entry_t *find_issuer(cert_store_t *store, X509 *cert)
{
    X509_NAME *issuer_name = X509_get_issuer_name(cert);
    if (!issuer_name)
        return NULL;
    for (cert_entry_t *e = store->head; e; e = e->next) {
        if (X509_NAME_cmp(X509_get_subject_name(e->cert), issuer_name) == 0)
            return e;
    }
    return NULL;
}

static int validate_chain(chain_context_t *ctx)
{
    int             i, rc = CERT_STATUS_OK;
    unsigned char   fp[FINGERPRINT_LEN];
    cert_entry_t   *trusted_issuer = NULL;

    if (!ctx || !ctx->chain || ctx->chain_len <= 0) {
        rc = CERT_STATUS_INVALID;
        goto cleanup;
    }
    if (ctx->chain_len > MAX_CHAIN_DEPTH) {
        rc = CERT_STATUS_INVALID;
        goto cleanup;
    }

    for (i = 0; i < ctx->chain_len - 1; i++) {
        rc = check_expiry(ctx->chain[i]);
        if (rc != CERT_STATUS_OK) {
            log_cert_event(LOG_LEVEL_ERROR, "cert at depth %d failed expiry check", i);
            goto cleanup;
        }
        rc = verify_signature(ctx->chain[i], ctx->chain[i + 1]);
        if (rc != CERT_STATUS_OK) {
            log_cert_event(LOG_LEVEL_ERROR, "signature invalid at depth %d", i);
            goto cleanup;
        }
    }

    trusted_issuer = find_issuer(ctx->trusted_store, ctx->chain[ctx->chain_len - 1]);
    if (!trusted_issuer) {
        log_cert_event(LOG_LEVEL_ERROR, "root not found in trusted store");
        rc = CERT_STATUS_UNTRUSTED;
        goto cleanup;
    }
    rc = verify_signature(ctx->chain[ctx->chain_len - 1], trusted_issuer->cert);
    if (rc != CERT_STATUS_OK)
        goto cleanup;

    /* Fingerprint pinning on leaf */
    if (ctx->pinned_fingerprint) {
        if (compute_fingerprint(ctx->chain[0], fp, sizeof(fp)) != 0) {
            rc = CERT_STATUS_INVALID;
            goto cleanup;
        }
        if (!match_fingerprint(fp, ctx->pinned_fingerprint)) {
            log_cert_event(LOG_LEVEL_ERROR, "leaf fingerprint mismatch");
            rc = CERT_STATUS_UNTRUSTED;
            goto cleanup;
        }
    }

    log_cert_event(LOG_LEVEL_INFO, "chain validated successfully (%d certs)", ctx->chain_len);

cleanup:
    return rc;
}

static void cleanup_cert_store(cert_store_t *store)
{
    cert_entry_t *entry, *next;
    if (!store)
        return;

    entry = store->head;
    while (entry) {
        next = entry->next;
        X509_free(entry->cert);
        free(entry->subject);
        free(entry->issuer);
        log_cert_event(LOG_LEVEL_DEBUG, "freed cert store entry: %s", entry->issuer);
        free(entry);
        entry = next;
    }
    store->head  = NULL;
    store->count = 0;
}

int add_trusted_cert(cert_store_t *store, X509 *cert)
{
    if (!store || !cert)
        return -1;
    cert_entry_t *entry = calloc(1, sizeof(cert_entry_t));
    if (!entry)
        return -1;

    entry->cert = X509_dup(cert);
    if (!entry->cert) { free(entry); return -1; }

    X509_NAME *subj = X509_get_subject_name(cert);
    X509_NAME *iss  = X509_get_issuer_name(cert);
    char *subj_str = subj ? X509_NAME_oneline(subj, NULL, 0) : NULL;
    char *iss_str  = iss  ? X509_NAME_oneline(iss, NULL, 0)  : NULL;

    entry->subject = subj_str ? strdup(subj_str) : strdup("(unknown)");
    entry->issuer  = iss_str  ? strdup(iss_str)  : strdup("(unknown)");
    entry->is_ca   = X509_check_ca(cert) > 0;
    if (subj_str) OPENSSL_free(subj_str);
    if (iss_str)  OPENSSL_free(iss_str);
    if (compute_fingerprint(cert, entry->fingerprint, FINGERPRINT_LEN) != 0) {
        X509_free(entry->cert);
        free(entry->subject);
        free(entry->issuer);
        free(entry);
        return -1;
    }

    entry->next  = store->head;
    store->head  = entry;
    store->count++;
    log_cert_event(LOG_LEVEL_INFO, "added trusted cert: %s (CA: %s)",
                   entry->subject, entry->is_ca ? "yes" : "no");
    return 0;
}

cert_store_t *init_cert_store(int max_depth, int log_level)
{
    cert_store_t *store = calloc(1, sizeof(cert_store_t));
    if (!store)
        return NULL;
    store->max_depth = (max_depth > 0 && max_depth <= MAX_CHAIN_DEPTH)
                        ? max_depth : MAX_CHAIN_DEPTH;
    g_log_level = log_level;
    log_cert_event(LOG_LEVEL_INFO, "cert store initialized (max_depth=%d)", store->max_depth);
    return store;
}
