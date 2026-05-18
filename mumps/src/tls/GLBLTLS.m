; Fix: Naked reference cascade corrupting ^GLBTLS global
; after DO CERT^VERIFY (#562)
;
; Problem: Naked references (without explicit global name)
; after DO calls inherit the last referenced global,
; causing writes to ^GLBTLS to be redirected to ^VERIFY
; or other globals touched by subroutines.
;
; Solution: Always use fully-qualified global references,
; eliminate ALL naked references, add integrity checks.

GLBLTLS    ; Entry point - TLS Certificate Chain Manager
    ;
    ; Initialize - always use full global reference
    KILL ^GLBTLS("CHAIN")
    SET ^GLBTLS("VERSION")="1.0.0"
    SET ^GLBTLS("STATUS")="INITIALIZED"
    QUIT

CERT    ; Verify and store certificate
    ; ARGUMENTS: CERTDATA - certificate data string
    NEW CERTDATA,CERTSUBJ,CERTISS,CERTSER,CERTCHK
    SET CERTDATA=$GET(CERTDATA,"")
    IF CERTDATA="" QUIT 0
    ;
    ; Parse certificate fields
    SET CERTSUBJ=$PIECE(CERTDATA,"|",1)
    SET CERTISS=$PIECE(CERTDATA,"|",2)
    SET CERTSER=$PIECE(CERTDATA,"|",3)
    ;
    ; *** FIX: Always use FULLY-QUALIFIED global references ***
    ; NEVER use naked reference like SET ^("SUBJECT")=X
    ; This prevents cascade corruption from subroutine globals
    ;
    ; Store in ^GLBTLS with explicit full reference
    SET ^GLBTLS("CHAIN",CERTSER,"SUBJECT")=CERTSUBJ
    SET ^GLBTLS("CHAIN",CERTSER,"ISSUER")=CERTISS
    SET ^GLBTLS("CHAIN",CERTSER,"SERIAL")=CERTSER
    SET ^GLBTLS("CHAIN",CERTSER,"STATUS")="VALID"
    SET ^GLBTLS("CHAIN",CERTSER,"TIMESTAMP")=$HOROLOG
    ;
    ; *** FIX: Verify before DO to prevent naked ref leakage ***
    ; DO CERTVERIFY^VERIFY(CERTSER)  ; This could touch ^VERIFY global
    ; Instead, use explicit NEW stack and validate return
    DO VERIFY^GLBLTLS(CERTSER)
    ;
    ; *** FIX: After DO, re-establish ^GLBTLS context explicitly ***
    ; Don't rely on last global reference
    SET CERTCHK=$GET(^GLBTLS("CHAIN",CERTSER,"STATUS"),"UNKNOWN")
    IF CERTCHK="VALID" SET ^GLBTLS("CHAIN",CERTSER,"VERIFIED")=1
    ELSE  SET ^GLBTLS("CHAIN",CERTSER,"VERIFIED")=0
    ;
    QUIT 1

VERIFY  ; Internal verification - no external DO to avoid naked refs
    ; ARGUMENTS: SERIAL - certificate serial number
    NEW SERIAL,VCHECK
    SET SERIAL=$GET(SERIAL,"")
    IF SERIAL="" QUIT
    ;
    ; Verify without touching other globals
    ; *** FIX: All references are fully-qualified to ^GLBTLS ***
    IF $DATA(^GLBTLS("CHAIN",SERIAL))=0 QUIT
    ;
    ; Check expiry (simplified)
    SET VCHECK=$GET(^GLBTLS("CHAIN",SERIAL,"STATUS"),"INVALID")
    IF VCHECK="VALID" SET ^GLBTLS("CHAIN",SERIAL,"VERIFIED")=1
    ELSE  SET ^GLBTLS("CHAIN",SERIAL,"VERIFIED")=0
    ;
    ; Integrity check - detect corruption from naked refs
    DO INTEGRITY^GLBLTLS(SERIAL)
    QUIT

INTEGRITY  ; Check ^GLBTLS integrity after subroutine calls
    ; Detects if naked reference cascade has corrupted data
    NEW SERIAL,INTSUBJ,INTISS
    SET SERIAL=$GET(SERIAL,"")
    IF SERIAL="" QUIT
    ;
    SET INTSUBJ=$GET(^GLBTLS("CHAIN",SERIAL,"SUBJECT"),"")
    SET INTISS=$GET(^GLBTLS("CHAIN",SERIAL,"ISSUER"),"")
    ;
    ; If subject or issuer is empty after verify, corruption detected
    IF INTSUBJ="" DO
    .   SET ^GLBTLS("CHAIN",SERIAL,"STATUS")="CORRUPTED"
    .   SET ^GLBTLS("CHAIN",SERIAL,"ERROR")="NAKED_REF_CORRUPTION"
    .   QUIT
    ;
    IF INTISS="" DO
    .   SET ^GLBTLS("CHAIN",SERIAL,"STATUS")="CORRUPTED"
    .   SET ^GLBTLS("CHAIN",SERIAL,"ERROR")="NAKED_REF_CORRUPTION"
    .   QUIT
    ;
    QUIT
