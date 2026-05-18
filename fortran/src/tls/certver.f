C     Fix: EQUIVALENCE overlap causing CERTBUF to overwrite
C     CERTLEN during certificate parsing (#563)
C
C     Problem: EQUIVALENCE(CERTBUF, WORKBUF) causes shared
C     memory that overwrites CERTLEN when WORKBUF is written,
C     corrupting certificate length tracking.
C
C     Solution: Remove EQUIVALENCE, use separate COMMON
C     blocks, explicit memory layout, and bounds checking.

      PROGRAM CERTVER
      IMPLICIT NONE

C     === Separate storage — NO EQUIVALENCE ===
      CHARACTER*512  CERTBUF
      CHARACTER*512  WORKBUF
      INTEGER        CERTLEN
      INTEGER        WORKLEN
      CHARACTER*256  CERTSUBJ
      CHARACTER*256  CERTISS
      CHARACTER*32   CERTSER
      INTEGER        IPOS, ILEN, ISTAT

C     === Separate COMMON blocks — explicit memory layout ===
      COMMON /CERTDATA/ CERTBUF, CERTLEN
      COMMON /WORKDATA/ WORKBUF, WORKLEN

C     Initialize
      CERTBUF = ' '
      WORKBUF = ' '
      CERTLEN = 0
      WORKLEN = 0

C     Read certificate into CERTBUF (separate from WORKBUF)
      CALL READ_CERT(CERTBUF, CERTLEN)

C     Validate CERTLEN before use
      IF (CERTLEN .LE. 0) THEN
         PRINT *, 'ERROR: Invalid certificate length'
         STOP 1
      ENDIF
      IF (CERTLEN .GT. 512) THEN
         PRINT *, 'ERROR: Certificate exceeds buffer size'
         CERTLEN = 512
      ENDIF

C     Copy to WORKBUF for parsing (explicit, no shared memory)
      WORKBUF = CERTBUF(1:CERTLEN)
      WORKLEN = CERTLEN

C     Parse subject
      CALL PARSE_FIELD(WORKBUF, WORKLEN, 'SUBJECT=',
     &                  CERTSUBJ, IPOS, ISTAT)
      IF (ISTAT .NE. 0) THEN
         PRINT *, 'ERROR: Subject parse failed'
         STOP 1
      ENDIF

C     Parse issuer
      CALL PARSE_FIELD(WORKBUF, WORKLEN, 'ISSUER=',
     &                  CERTISS, IPOS, ISTAT)
      IF (ISTAT .NE. 0) THEN
         PRINT *, 'ERROR: Issuer parse failed'
         STOP 1
      ENDIF

C     Parse serial
      CALL PARSE_FIELD(WORKBUF, WORKLEN, 'SERIAL=',
     &                  CERTSER, IPOS, ISTAT)
      IF (ISTAT .NE. 0) THEN
         PRINT *, 'ERROR: Serial parse failed'
         STOP 1
      ENDIF

C     Verify — CERTLEN is now safe from WORKBUF writes
      PRINT *, 'Certificate verified OK'
      PRINT *, 'Length: ', CERTLEN
      STOP 0
      END

C     ========================================================
      SUBROUTINE READ_CERT(BUF, LEN)
      IMPLICIT NONE
      CHARACTER*(*) BUF
      INTEGER LEN
      LEN = 0
      BUF = ' '
C     In production: read from file/socket
      BUF = 'CN=test,OU=dev|ISSUER=CA|SERIAL=ABC123'
      LEN = 34
      RETURN
      END

C     ========================================================
      SUBROUTINE PARSE_FIELD(BUF, BUFLEN, TAG, RESULT, POS, STAT)
      IMPLICIT NONE
      CHARACTER*(*) BUF, TAG, RESULT
      INTEGER BUFLEN, POS, STAT
      INTEGER TAGLEN, ISTART, IEND

      TAGLEN = LEN(TAG)
      POS = INDEX(BUF(1:BUFLEN), TAG(1:TAGLEN))

      IF (POS .LE. 0) THEN
         STAT = 1
         RESULT = ' '
         RETURN
      ENDIF

      ISTART = POS + TAGLEN
      IEND = INDEX(BUF(ISTART:BUFLEN), '|')
      IF (IEND .LE. 0) THEN
         IEND = BUFLEN
      ELSE
         IEND = ISTART + IEND - 2
      ENDIF

      IF (IEND - ISTART + 1 .GT. LEN(RESULT)) THEN
C        Truncate with warning — don't overflow
         RESULT = BUF(ISTART:ISTART+LEN(RESULT)-1)
         STAT = 2
      ELSE
         RESULT = BUF(ISTART:IEND)
         STAT = 0
      ENDIF

      RETURN
      END
