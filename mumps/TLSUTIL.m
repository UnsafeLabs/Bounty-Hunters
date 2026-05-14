; TLSUTIL.m - TLS Utility Routines
; Copyright (c) 2024 SecureNet Systems
;
; TLS certificate chain validation and session management
; for GT.M / YottaDB MUMPS runtime.
;
; Entry points:
;   CERT   - Validate certificate chain for a TLS session
;   VERIFY - Verify a single certificate in the chain

CERT    ; Validate certificate chain for session SESSID
        ; Expects: SESSID - session identifier
        ;          CHAINLEN - number of certificates in chain
        N IDX,RESULT,NODEOK
        S RESULT=1  ; assume success
        ;
        ; Initialize session metadata
CERT+2  S ^GLBTLS(SESSID,"meta","protocol")="TLS1.3"
        S ^GLBTLS(SESSID,"meta","started")=$H
        S ^GLBTLS(SESSID,"meta","lastcheck")=$H
        ;
        ; Iterate over chain entries and verify each certificate
CERT+5  F IDX=1:1:CHAINLEN D
        . ;
        . ; Check if chain node exists
CERT+7  . I '$D(^GLBTLS(SESSID,"chain",IDX)) D  Q
        . . S RESULT=0
        . . S ^GLBTLS(SESSID,"chain",IDX,"status")="MISSING"
        . ;
        . ; FIX for #562: Explicitly set the naked reference to the
        . ; correct chain node BEFORE calling VERIFY^TLSCHAIN.
        . ; Without this, when the post-conditional DO at the old
        . ; CERT+14 was FALSE (node didn't exist), the naked reference
        . ; remained from CERT+11's S ^GLBTLS(SESSID,"meta","lastcheck")=$H,
        . ; causing subsequent naked S ^("status")="V" to write to the
        . ; wrong global node (under "meta" instead of "chain",IDX).
CERT+14 . S ^GLBTLS(SESSID,"chain",IDX,"status")=""
        . ;
        . ; Now invoke the chain verification subroutine
CERT+15 . D VERIFY^TLSCHAIN(IDX)
        . ;
        . ; Mark as verified
CERT+17 . S ^("status")="V"
        ;
        ; Record final validation result
CERT+19 S ^GLBTLS(SESSID,"meta","validated")=RESULT
        Q RESULT
        ;
VERIFY  ; Verify a single certificate at chain position IDX
        ; Expects: SESSID - session identifier
        ;          IDX    - chain index (1-based)
        ; Uses naked reference: ^GLBTLS(SESSID,"chain",IDX)
        N FP,ISSUER,SIGOK
        S FP=$G(^("fingerprint"))
        S ISSUER=$G(^("issuer"))
        ;
        ; Check fingerprint is present
VER+5   I FP="" S ^("status")="NOFP" Q 0
        ;
        ; Check issuer is present
VER+7   I ISSUER="" S ^("status")="NOISSUER" Q 0
        ;
        ; Validate signature (simplified check)
VER+10  S SIGOK=$$CHECKSIG(FP,ISSUER)
        I 'SIGOK S ^("status")="BADSIG" Q 0
        ;
        Q 1
        ;
CHECKSIG(FP,ISSUER) ; Placeholder for signature verification
        ; In production this would call crypto library
        I FP'="",ISSUER'="" Q 1
        Q 0
