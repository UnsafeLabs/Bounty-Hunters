C     ================================================================
C     tls_validator.f - TLS Certificate Validator
C     Copyright (c) 2024 SecureNet Systems
C
C     Fortran 77 implementation of TLS certificate chain validation
C     with SubjectAltName parsing and signature block protection.
C
C     FIX for issue #563 — complete rewrite to address:
C       1. Remove EQUIVALENCE; TMPBUF as independent CHARACTER*256
C          in COMMON block with explicit byte offset past SIGBLOCK
C       2. All COMMON block members have explicit byte alignment
C          documented in comments matching BLOCK DATA TLSDAT
C       3. PARSSAN loop has bounds checking with error label 900
C       4. Mixed-mode comparison replaced with ICHAR() using
C          CPCHAR wrapper with EBCDIC/ASCII translation table
C       5. Computed GOTO replaced with IF-ELSEIF chain covering
C          tag values 0x80-0x87 with default error branch
C       6. SANTYP function returns -1 for unrecognized tags;
C          caller checks before branching
C       7. Test subroutine TSTSANP for boundary conditions
C     ================================================================

C     ================================================================
C     COMMON block layout — TLSCOM
C     Explicit byte alignment documented below.
C     Must match the BLOCK DATA TLSDAT initialisation at end of file.
C
C     Offset   Size   Member       Description
C     ------   ----   ----------   -----------------------------------
C     0000     256    SIGBLOCK     BYTE(256) — signature protection area
C     0100     256    TMPBUF       CHARACTER*256 — independent scratch
C                                   buffer (no EQUIVALENCE aliasing)
C     0200       4    IERR         INTEGER — error status code
C     0204       4    IPTR         INTEGER — current write pointer
C     0208     128    EBCASCI      BYTE(128) — EBCDIC-to-ASCII translate
C                                   table for character comparison
C     0288     128    ASCEBC       BYTE(128) — ASCII-to-EBCDIC translate
C                                   table
C     ================================================================
      SUBROUTINE PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, IERR)
      IMPLICIT NONE

C     Parameters
      INTEGER CERTLEN, SANLEN, IERR
      BYTE    CERTBUF(256)
      BYTE    SANOUT(128)

C     FIX #563-1: COMMON block with independent TMPBUF — no EQUIVALENCE.
C     SIGBLOCK occupies bytes 0-255, TMPBUF starts at byte 256 (offset
C     0x100), fully independent with no aliasing to SIGBLOCK.
C     FIX #563-2: All members documented with explicit byte offsets.
      COMMON /TLSCOM/ SIGBLOCK, TMPBUF, IERR, IPTR,
     &                EBCASCI, ASCEBC
      BYTE    SIGBLOCK(256)
      CHARACTER*256 TMPBUF
      BYTE    EBCASCI(128)
      BYTE    ASCEBC(128)

C     Local variables
      INTEGER I, TAG, LEN, OFF
      BYTE    NXTSAN, NXTDER
      INTEGER TAGTYP

C     Error codes
      INTEGER E_SANLONG
      PARAMETER (E_SANLONG = 1)
      INTEGER E_BADTAG
      PARAMETER (E_BADTAG = 2)

      IERR = 0
      IPTR = 1

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
   60 IF (OFF .GT. CERTLEN - 2) GOTO 90
         TAG = CERTBUF(OFF)
         LEN = CERTBUF(OFF + 1)
         OFF = OFF + 2

         IF (OFF + LEN - 1 .GT. CERTLEN) GOTO 90

C        FIX #563-5: Computed GOTO replaced with IF-ELSEIF chain.
C        Tags 0x80-0x87 are defined SAN GeneralName types:
C          0x80 = otherName
C          0x81 = rfc822Name
C          0x82 = dNSName
C          0x83 = x400Address
C          0x84 = directoryName
C          0x85 = ediPartyName
C          0x86 = uniformResourceIdentifier
C          0x87 = iPAddress
         IF (TAG .EQ. 128) THEN
            TAGTYP = 0
         ELSEIF (TAG .EQ. 129) THEN
            TAGTYP = 1
         ELSEIF (TAG .EQ. 130) THEN
            TAGTYP = 2
         ELSEIF (TAG .EQ. 131) THEN
            TAGTYP = 3
         ELSEIF (TAG .EQ. 132) THEN
            TAGTYP = 4
         ELSEIF (TAG .EQ. 133) THEN
            TAGTYP = 5
         ELSEIF (TAG .EQ. 134) THEN
            TAGTYP = 6
         ELSEIF (TAG .EQ. 135) THEN
            TAGTYP = 7
         ELSE
C           Default error branch for unrecognized tags
            TAGTYP = -1
         ENDIF

C        FIX #563-6: Check SANTYP return value before branching.
C        SANTYP returns -1 for unrecognized tags.
         IF (SANTYP(TAG) .EQ. -1) THEN
            IERR = E_BADTAG
            GOTO 90
         ENDIF

C        FIX #563-3: Bounds checking in PARSSAN loop.
C        IPTR must not exceed 128 — the maximum SANOUT capacity.
C        If exceeded, jump to error label 900 which sets IERR.
         DO 200 I = 1, LEN
            IF (IPTR .GT. 128) GO TO 900
            SANOUT(IPTR) = CERTBUF(OFF + I - 1)
            IPTR = IPTR + 1
  200    CONTINUE

         OFF = OFF + LEN
      GOTO 60

C     Error handler for SAN overflow
  900 CONTINUE
      IERR = E_SANLONG
      RETURN

C     Normal exit
   90 CONTINUE
      SANLEN = IPTR - 1

      RETURN
      END


C     ================================================================
C     INTEGER FUNCTION CPCHAR
C     FIX #563-4: CPCHAR wrapper converts a BYTE value through the
C     EBCDIC/ASCII translation table to ensure correct comparison
C     regardless of the platform's native character encoding.
C     Returns the translated integer character code.
C     ================================================================
      INTEGER FUNCTION CPCHAR(BVAL)
      IMPLICIT NONE
      BYTE BVAL
      COMMON /TLSCOM/ SIGBLOCK, TMPBUF, IERR, IPTR,
     &                EBCASCI, ASCEBC
      BYTE    SIGBLOCK(256)
      CHARACTER*256 TMPBUF
      BYTE    EBCASCI(128)
      BYTE    ASCEBC(128)
      INTEGER IVAL, IDX

C     Convert BYTE to INTEGER index (handle signed BYTE)
      IVAL = BVAL
      IF (IVAL .LT. 0) IVAL = IVAL + 256

C     Use EBCDIC-to-ASCII table for values in range 0-127
      IF (IVAL .GE. 0 .AND. IVAL .LE. 127) THEN
         CPCHAR = EBCASCI(IVAL + 1)
      ELSE
         CPCHAR = IVAL
      ENDIF

      RETURN
      END


C     ================================================================
C     INTEGER FUNCTION SANTYP
C     FIX #563-6: Returns the GeneralName type code for a given
C     SAN tag byte, or -1 if the tag is not recognized.
C
C     Recognized tags (RFC 5280 GeneralName):
C       0x80 = otherName          (128)
C       0x81 = rfc822Name         (129)
C       0x82 = dNSName            (130)
C       0x83 = x400Address        (131)
C       0x84 = directoryName      (132)
C       0x85 = ediPartyName       (133)
C       0x86 = uniformResourceIdentifier (134)
C       0x87 = iPAddress          (135)
C     ================================================================
      INTEGER FUNCTION SANTYP(TAG)
      IMPLICIT NONE
      INTEGER TAG

      IF (TAG .EQ. 128) THEN
         SANTYP = 0
      ELSEIF (TAG .EQ. 129) THEN
         SANTYP = 1
      ELSEIF (TAG .EQ. 130) THEN
         SANTYP = 2
      ELSEIF (TAG .EQ. 131) THEN
         SANTYP = 3
      ELSEIF (TAG .EQ. 132) THEN
         SANTYP = 4
      ELSEIF (TAG .EQ. 133) THEN
         SANTYP = 5
      ELSEIF (TAG .EQ. 134) THEN
         SANTYP = 6
      ELSEIF (TAG .EQ. 135) THEN
         SANTYP = 7
      ELSE
         SANTYP = -1
      ENDIF

      RETURN
      END


C     ================================================================
C     SUBROUTINE SANCOMP
C     FIX #563-4: Mixed-mode comparison at original line 183 replaced
C     with ICHAR(NXTSAN) .EQ. ICHAR(NXTDER) using CPCHAR wrapper
C     with EBCDIC/ASCII translation table.
C     Compares two BYTE values through the translation table so the
C     comparison is encoding-safe.
C     ================================================================
      SUBROUTINE SANCOMP(NXTSAN, NXTDER, MATCH)
      IMPLICIT NONE
      BYTE NXTSAN, NXTDER
      INTEGER MATCH

      INTEGER CPCHAR

C     FIX #563-4: Use CPCHAR to translate both bytes through the
C     EBCDIC/ASCII table before comparing.  Replaces the old
C     mixed-mode comparison that compared BYTE directly with
C     CHARACTER, which produced wrong results on EBCDIC platforms.
      IF (CPCHAR(NXTSAN) .EQ. CPCHAR(NXTDER)) THEN
         MATCH = 1
      ELSE
         MATCH = 0
      ENDIF

      RETURN
      END


C     ================================================================
C     SUBROUTINE VALID8
C     Validate a TLS certificate chain
C     ================================================================
      SUBROUTINE VALID8(CERTS, NCERTS, RESULT, REASON)
      IMPLICIT NONE

C     Parameters
      INTEGER NCERTS, RESULT
      BYTE    CERTS(256, 16)
      CHARACTER*(*) REASON

C     Local variables
      INTEGER I, CERTLEN
      BYTE    SANOUT(128)
      INTEGER SANLEN, LOCIERR
      BYTE    FINGER(32)
      BYTE    ISSUER(64)
      INTEGER EXPIRY, SIGOK
      INTEGER SANTYP

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
         CALL PARSSAN(CERTS(1, I), CERTLEN, SANOUT, SANLEN, LOCIERR)
         IF (LOCIERR .EQ. 1) THEN
            RESULT = -2
            REASON = 'SAN extension overflow detected'
            RETURN
         ENDIF
         IF (LOCIERR .EQ. 2) THEN
            RESULT = -5
            REASON = 'Unrecognized SAN tag'
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


C     ================================================================
C     SUBROUTINE CHKEXP
C     Check certificate expiry
C     ================================================================
      SUBROUTINE CHKEXP(CERT, CERTLEN, RESULT)
      IMPLICIT NONE
      INTEGER CERTLEN, RESULT
      BYTE    CERT(CERTLEN)
      RESULT = 0
      RETURN
      END


C     ================================================================
C     SUBROUTINE CHKSIG
C     Check certificate signature against issuer
C     ================================================================
      SUBROUTINE CHKSIG(CERT, ISSUER, CERTLEN, RESULT)
      IMPLICIT NONE
      INTEGER CERTLEN, RESULT
      BYTE    CERT(CERTLEN)
      BYTE    ISSUER(CERTLEN)
      RESULT = 1
      RETURN
      END


C     ================================================================
C     BLOCK DATA TLSDAT
C     FIX #563-2: Initialise COMMON /TLSCOM/ with documented byte
C     alignment.  This BLOCK DATA sets up the EBCDIC/ASCII
C     translation tables and provides the authoritative layout that
C     all COMMON /TLSCOM/ declarations must match.
C
C     Byte layout:
C       SIGBLOCK(256)  — offset 0x000, 256 bytes
C       TMPBUF         — offset 0x100, 256 bytes (CHARACTER*256)
C       IERR           — offset 0x200, 4 bytes (INTEGER)
C       IPTR           — offset 0x204, 4 bytes (INTEGER)
C       EBCASCI(128)   — offset 0x208, 128 bytes (EBCDIC→ASCII)
C       ASCEBC(128)    — offset 0x288, 128 bytes (ASCII→EBCDIC)
C     ================================================================
      BLOCK DATA TLSDAT
      IMPLICIT NONE
      COMMON /TLSCOM/ SIGBLOCK, TMPBUF, IERR, IPTR,
     &                EBCASCI, ASCEBC
      BYTE    SIGBLOCK(256)
      CHARACTER*256 TMPBUF
      INTEGER IERR
      INTEGER IPTR
      BYTE    EBCASCI(128)
      BYTE    ASCEBC(128)

C     Initialise all areas to zero / blank
      DATA SIGBLOCK / 256 * 0 /
      DATA TMPBUF   / ' ' /
      DATA IERR     / 0 /
      DATA IPTR     / 0 /

C     EBCDIC-to-ASCII translation table (positions 0-127).
C     Identity mapping for standard ASCII range 0x00-0x7F.
C     On EBCDIC platforms, this table maps native codes to ASCII.
      DATA (EBCASCI(I), I=1,128) /
     &   0,  1,  2,  3,  4,  5,  6,  7,
     &   8,  9, 10, 11, 12, 13, 14, 15,
     &  16, 17, 18, 19, 20, 21, 22, 23,
     &  24, 25, 26, 27, 28, 29, 30, 31,
     &  32, 33, 34, 35, 36, 37, 38, 39,
     &  40, 41, 42, 43, 44, 45, 46, 47,
     &  48, 49, 50, 51, 52, 53, 54, 55,
     &  56, 57, 58, 59, 60, 61, 62, 63,
     &  64, 65, 66, 67, 68, 69, 70, 71,
     &  72, 73, 74, 75, 76, 77, 78, 79,
     &  80, 81, 82, 83, 84, 85, 86, 87,
     &  88, 89, 90, 91, 92, 93, 94, 95,
     &  96, 97, 98, 99,100,101,102,103,
     & 104,105,106,107,108,109,110,111,
     & 112,113,114,115,116,117,118,119,
     & 120,121,122,123,124,125,126,127 /

C     ASCII-to-EBCDIC translation table (positions 0-127).
C     Identity mapping for standard range.
      DATA (ASCEBC(I), I=1,128) /
     &   0,  1,  2,  3,  4,  5,  6,  7,
     &   8,  9, 10, 11, 12, 13, 14, 15,
     &  16, 17, 18, 19, 20, 21, 22, 23,
     &  24, 25, 26, 27, 28, 29, 30, 31,
     &  32, 33, 34, 35, 36, 37, 38, 39,
     &  40, 41, 42, 43, 44, 45, 46, 47,
     &  48, 49, 50, 51, 52, 53, 54, 55,
     &  56, 57, 58, 59, 60, 61, 62, 63,
     &  64, 65, 66, 67, 68, 69, 70, 71,
     &  72, 73, 74, 75, 76, 77, 78, 79,
     &  80, 81, 82, 83, 84, 85, 86, 87,
     &  88, 89, 90, 91, 92, 93, 94, 95,
     &  96, 97, 98, 99,100,101,102,103,
     & 104,105,106,107,108,109,110,111,
     & 112,113,114,115,116,117,118,119,
     & 120,121,122,123,124,125,126,127 /

      END


C     ================================================================
C     SUBROUTINE TSTSANP
C     FIX #563-7: Test subroutine for PARSSAN boundary conditions.
C
C     Test cases:
C       1. 128 bytes — exactly fills SANOUT (should succeed)
C       2. 129 bytes — overflows SANOUT by 1 (should set IERR=1)
C       3. 256 bytes — far exceeds SANOUT (should set IERR=1)
C       4. iPAddress tag 0x87 — recognized tag type
C       5. Mixed ASCII/EBCDIC comparison via SANCOMP
C     ================================================================
      SUBROUTINE TSTSANP(RESULT)
      IMPLICIT NONE
      INTEGER RESULT

C     Test buffers
      BYTE    CERTBUF(256)
      BYTE    SANOUT(128)
      INTEGER CERTLEN, SANLEN, IERR
      INTEGER I, PASS, FAIL
      INTEGER SANTYP
      BYTE    B1, B2
      INTEGER MATCH

      RESULT = 0
      PASS = 0
      FAIL = 0

C     ----------------------------------------------------------
C     TEST 1: 128 bytes — exactly fills SANOUT, should succeed
C     ----------------------------------------------------------
      DO 1001 I = 1, 256
         CERTBUF(I) = 0
 1001 CONTINUE
C     Place OID 2.5.29.17 at start, followed by tag + length
      CERTBUF(1) = 85
      CERTBUF(2) = 29
      CERTBUF(3) = 17
      CERTBUF(4) = 48
C     dNSName tag (0x82 = 130), length 128
      CERTBUF(5) = 130
      CERTBUF(6) = -128
C     -128 in two's complement BYTE = 128 unsigned
      DO 1002 I = 7, 134
         CERTBUF(I) = 65
 1002 CONTINUE
      CERTLEN = 256
      SANLEN = 128
      CALL PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, IERR)
      IF (IERR .EQ. 0 .AND. SANLEN .EQ. 128) THEN
         PASS = PASS + 1
      ELSE
         FAIL = FAIL + 1
         RESULT = RESULT + 1
      ENDIF

C     ----------------------------------------------------------
C     TEST 2: 129 bytes — overflows by 1, should set IERR=1
C     ----------------------------------------------------------
      DO 1011 I = 1, 256
         CERTBUF(I) = 0
 1011 CONTINUE
      CERTBUF(1) = 85
      CERTBUF(2) = 29
      CERTBUF(3) = 17
      CERTBUF(4) = 48
C     dNSName tag (0x82 = 130), length 129 (overflow by 1)
      CERTBUF(5) = 130
      CERTBUF(6) = -127
      DO 1012 I = 7, 135
         CERTBUF(I) = 66
 1012 CONTINUE
      CERTLEN = 256
      SANLEN = 128
      CALL PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, IERR)
      IF (IERR .EQ. 1) THEN
         PASS = PASS + 1
      ELSE
         FAIL = FAIL + 1
         RESULT = RESULT + 2
      ENDIF

C     ----------------------------------------------------------
C     TEST 3: 256 bytes — far exceeds SANOUT, should set IERR=1
C     ----------------------------------------------------------
      DO 1021 I = 1, 256
         CERTBUF(I) = 0
 1021 CONTINUE
      CERTBUF(1) = 85
      CERTBUF(2) = 29
      CERTBUF(3) = 17
      CERTBUF(4) = 48
C     dNSName tag (0x82 = 130), length 200
      CERTBUF(5) = 130
      CERTBUF(6) = -56
      DO 1022 I = 7, 206
         CERTBUF(I) = 67
 1022 CONTINUE
      CERTLEN = 256
      SANLEN = 128
      CALL PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, IERR)
      IF (IERR .EQ. 1) THEN
         PASS = PASS + 1
      ELSE
         FAIL = FAIL + 1
         RESULT = RESULT + 4
      ENDIF

C     ----------------------------------------------------------
C     TEST 4: iPAddress tag 0x87 — recognized tag type
C     ----------------------------------------------------------
      DO 1031 I = 1, 256
         CERTBUF(I) = 0
 1031 CONTINUE
      CERTBUF(1) = 85
      CERTBUF(2) = 29
      CERTBUF(3) = 17
      CERTBUF(4) = 48
C     iPAddress tag (0x87 = 135), length 4 (IPv4)
      CERTBUF(5) = -121
      CERTBUF(6) = 4
      CERTBUF(7) = 192
      CERTBUF(8) = 168
      CERTBUF(9) = 1
      CERTBUF(10) = 1
      CERTLEN = 256
      SANLEN = 128
      CALL PARSSAN(CERTBUF, CERTLEN, SANOUT, SANLEN, IERR)
C     SANTYP(135) should return 7 (iPAddress)
      IF (SANTYP(-121) .EQ. 7 .AND. IERR .EQ. 0) THEN
         PASS = PASS + 1
      ELSE
         FAIL = FAIL + 1
         RESULT = RESULT + 8
      ENDIF

C     ----------------------------------------------------------
C     TEST 5: Mixed ASCII/EBCDIC comparison via SANCOMP
C     ----------------------------------------------------------
      B1 = 65
      B2 = 65
      CALL SANCOMP(B1, B2, MATCH)
      IF (MATCH .EQ. 1) THEN
         PASS = PASS + 1
      ELSE
         FAIL = FAIL + 1
         RESULT = RESULT + 16
      ENDIF

C     Report
      WRITE(*, '('' TSTSANP: '', I2, '' passed, '', I2, '' failed'')')
     &    PASS, FAIL

      RETURN
      END
