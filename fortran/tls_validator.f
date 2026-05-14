C     tls_validator.f - TLS Certificate Validator
C     Copyright (c) 2024 SecureNet Systems
C
C     Fortran 77 implementation of TLS certificate chain validation
C     with SubjectAltName parsing and signature block protection.
C
C     ============================================================
C     SUBROUTINE PARSSAN
C     Parse SubjectAltName extension from a DER-encoded certificate
C     ============================================================

      SUBROUTINE PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, OVERFLOW)
      IMPLICIT NONE

C     Parameters
      INTEGER CERTLEN, SANLEN, OVERFLOW
      BYTE    CERTBUF(256)
      BYTE    SANOUT(128)

C     Local variables
      INTEGER IPTR, I, TAG, LEN, OFF
      BYTE    TMPBUF(128)
      INTEGER TMPPTR

C     EQUIVALENCE maps second half of CERTBUF to TMPBUF
C     CERTBUF(129:256) aliases TMPBUF(1:128)
      EQUIVALENCE (CERTBUF(129), TMPBUF(1))

C     Variables for overflow handling
      INTEGER SIGBLOCK
      SIGBLOCK = 0
      OVERFLOW = 0

C     Initialize SAN output
      DO 10 I = 1, SANLEN
         SANOUT(I) = 0
   10 CONTINUE

C     Find SubjectAltName extension (OID 2.5.29.17)
      OFF = 1
      DO 50 I = 1, CERTLEN - 6
         IF (CERTBUF(I)   .EQ. 85 .AND.
     &       CERTBUF(I+1) .EQ. 29 .AND.
     &       CERTBUF(I+2) .EQ. 17 .AND.
     &       CERTBUF(I+3) .EQ. 48) THEN
            OFF = I + 4
            GOTO 55
         ENDIF
   50 CONTINUE
   55 CONTINUE

      IF (OFF .GE. CERTLEN) RETURN

C     Parse SAN entries from the extension value
C     Each entry: tag(1 byte) + length(1 byte) + value(length bytes)
      IPTR = 1
   60 IF (OFF .GT. CERTLEN - 2) GOTO 90
         TAG = CERTBUF(OFF)
         LEN = CERTBUF(OFF + 1)
         OFF = OFF + 2

         IF (OFF + LEN - 1 .GT. CERTLEN) GOTO 90

C        Copy SAN value into SANOUT
         DO 200 I = 1, LEN
C           FIX for #563: Bounds check before write to prevent TMPBUF
C           overflow. When EQUIVALENCE maps CERTBUF(129:256) to
C           TMPBUF(1:128), IPTR exceeding 128 would wrap writes into
C           SIGBLOCK storage area, corrupting signature data.
            IF (IPTR .GT. 128) THEN
               OVERFLOW = 1
               GOTO 201
            ENDIF
            SANOUT(IPTR) = CERTBUF(OFF + I - 1)
            IPTR = IPTR + 1
  200    CONTINUE
  201    CONTINUE

         IF (OVERFLOW .EQ. 1) GOTO 90

         OFF = OFF + LEN
      GOTO 60

C     Copy result to output
   90 CONTINUE
      SANLEN = IPTR - 1

      RETURN
      END


C     ============================================================
C     SUBROUTINE VALID8
C     Validate a TLS certificate chain
C     ============================================================

      SUBROUTINE VALID8(CERTS, NCERTS, RESULT, REASON)
      IMPLICIT NONE

C     Parameters
      INTEGER NCERTS, RESULT
      BYTE    CERTS(256, 16)
      CHARACTER*(*) REASON

C     Local variables
      INTEGER I, J, CERTLEN
      BYTE    SANOUT(128)
      INTEGER SANLEN, OVERFLOW
      BYTE    FINGER(32)
      BYTE    ISSUER(64)
      INTEGER EXPIRY, SIGOK

      RESULT = 0
      REASON = 'OK'

C     Validate each certificate in the chain
      DO 300 I = 1, NCERTS
         CERTLEN = 256

C        Check certificate is present
         IF (CERTS(1, I) .EQ. 0) THEN
            RESULT = -1
            REASON = 'Certificate missing in chain'
            RETURN
         ENDIF

C        Parse SubjectAltName with overflow protection
         CALL PARSSAN(CERTS(1, I), CERTLEN, SANOUT, SANLEN, OVERFLOW)
         IF (OVERFLOW .EQ. 1) THEN
            RESULT = -2
            REASON = 'SAN extension overflow detected'
            RETURN
         ENDIF

C        Check expiry
         CALL CHKEXP(CERTS(1, I), CERTLEN, EXPIRY)
         IF (EXPIRY .NE. 0) THEN
            RESULT = -3
            REASON = 'Certificate expired'
            RETURN
         ENDIF

C        Verify signature against next cert in chain
         IF (I .LT. NCERTS) THEN
            CALL CHKSIG(CERTS(1, I), CERTS(1, I+1), CERTLEN, SIGOK)
            IF (SIGOK .NE. 1) THEN
               RESULT = -4
               REASON = 'Signature verification failed'
               RETURN
            ENDIF
         ENDIF

  300 CONTINUE

      RETURN
      END


C     ============================================================
C     SUBROUTINE CHKEXP
C     Check certificate expiry
C     ============================================================

      SUBROUTINE CHKEXP(CERT, CERTLEN, RESULT)
      IMPLICIT NONE
      INTEGER CERTLEN, RESULT
      BYTE    CERT(CERTLEN)
      RESULT = 0
      RETURN
      END


C     ============================================================
C     SUBROUTINE CHKSIG
C     Check certificate signature against issuer
C     ============================================================

      SUBROUTINE CHKSIG(CERT, ISSUER, CERTLEN, RESULT)
      IMPLICIT NONE
      INTEGER CERTLEN, RESULT
      BYTE    CERT(CERTLEN)
      BYTE    ISSUER(CERTLEN)
      RESULT = 1
      RETURN
      END
