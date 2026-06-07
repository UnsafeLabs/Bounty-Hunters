C     TLSMOD.F - Fortran 77 TLS SubjectAltName parser hardening.
C
C     COMMON /TLSBLK/ byte layout, matching BLOCK DATA TLSDAT below:
C       0000..0255 CERTBUF   CHARACTER*256 certificate buffer
C       0256..0383 SIGBLOCK  CHARACTER*128 signature bytes
C       0384..0639 TMPBUF    CHARACTER*256 independent SAN scratch
C       0640..0643 IERR      INTEGER parser error code
C       0644..0647 IPTR      INTEGER output pointer
C       0648..0903 CPTRANS   INTEGER*4(64) compact char translation
C
C     TMPBUF is a separate COMMON member: it cannot alias CERTBUF
C     or SIGBLOCK, so long SAN writes cannot overwrite signature storage.

      INTEGER FUNCTION UBYTE(B)
      IMPLICIT NONE
      INTEGER B
      UBYTE = B
      IF (UBYTE .LT. 0) UBYTE = UBYTE + 256
      RETURN
      END

      INTEGER FUNCTION SANTYP(TAGBYTE)
      IMPLICIT NONE
      INTEGER TAGBYTE, TAG, UBYTE
      TAG = UBYTE(TAGBYTE)
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

      INTEGER FUNCTION CPCHAR(CHARCODE)
      IMPLICIT NONE
      INTEGER CHARCODE, UBYTE
      CHARACTER*256 CERTBUF
      CHARACTER*128 SIGBLOCK
      CHARACTER*256 TMPBUF
      INTEGER IERR, IPTR, CPTRANS(64)
      COMMON /TLSBLK/ CERTBUF, SIGBLOCK, TMPBUF, IERR, IPTR,
     &                CPTRANS
      CPCHAR = UBYTE(CHARCODE)
C     CPTRANS contains selected EBCDIC alphabetic mappings. Values not
C     listed are treated as ASCII already.
      IF (CPCHAR .GE. 193 .AND. CPCHAR .LE. 201) THEN
         CPCHAR = CPTRANS(CPCHAR - 192)
      ELSEIF (CPCHAR .GE. 209 .AND. CPCHAR .LE. 217) THEN
         CPCHAR = CPTRANS(CPCHAR - 200)
      ELSEIF (CPCHAR .GE. 226 .AND. CPCHAR .LE. 233) THEN
         CPCHAR = CPTRANS(CPCHAR - 208)
      ENDIF
      RETURN
      END

      SUBROUTINE SANCOMP(NXTSAN, NXTDER, MATCH)
      IMPLICIT NONE
      INTEGER NXTSAN, NXTDER, MATCH, CPCHAR
      IF (CPCHAR(NXTSAN) .EQ. CPCHAR(NXTDER)) THEN
         MATCH = 1
      ELSE
         MATCH = 0
      ENDIF
      RETURN
      END

      SUBROUTINE PARSSAN(DERBLK, DERLEN, SANOUT, OUTLEN, IERR)
      IMPLICIT NONE
      INTEGER DERLEN, OUTLEN, IERR
      INTEGER DERBLK(256), SANOUT(256)
      CHARACTER*256 CERTBUF
      CHARACTER*128 SIGBLOCK
      CHARACTER*256 TMPBUF
      INTEGER IPTR, CPTRANS(64)
      COMMON /TLSBLK/ CERTBUF, SIGBLOCK, TMPBUF, IERR, IPTR,
     &                CPTRANS
      INTEGER OFF, I, TAG, LEN, TYP, UBYTE, SANTYP
      INTEGER E_SANLONG, E_BADTAG
      PARAMETER (E_SANLONG = 9001)
      PARAMETER (E_BADTAG = 9002)

      IERR = 0
      IPTR = 1
      OUTLEN = 0
      TMPBUF = ' '

      OFF = 1
  100 IF (OFF .GT. DERLEN - 1) GOTO 800
      TAG = UBYTE(DERBLK(OFF))
      LEN = UBYTE(DERBLK(OFF + 1))
      TYP = SANTYP(TAG)

      IF (TYP .LT. 0) THEN
         IERR = E_BADTAG
         GOTO 800
      ENDIF

C     IF/ELSEIF chain covers all SAN tags from 0x80 through 0x87.
      IF (TYP .EQ. 0) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 1) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 2) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 3) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 4) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 5) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 6) THEN
         GOTO 200
      ELSEIF (TYP .EQ. 7) THEN
         GOTO 200
      ELSE
         IERR = E_BADTAG
         GOTO 800
      ENDIF

  200 CONTINUE
      IF (OFF + LEN .GT. DERLEN) THEN
         IERR = E_BADTAG
         GOTO 800
      ENDIF

      DO 300 I = 1, LEN
         IF (IPTR .GT. 128) GO TO 900
         SANOUT(IPTR) = UBYTE(DERBLK(OFF + 1 + I))
         TMPBUF(IPTR:IPTR) = CHAR(SANOUT(IPTR))
         IPTR = IPTR + 1
  300 CONTINUE

      OFF = OFF + LEN + 2
      GOTO 100

  900 CONTINUE
      IERR = E_SANLONG
      GOTO 800

  800 CONTINUE
      OUTLEN = IPTR - 1
      RETURN
      END

      SUBROUTINE TSTSANP(RESULT)
      IMPLICIT NONE
      INTEGER RESULT, IERR, OUTLEN, I, MATCH, SANTYP
      INTEGER DERBLK(256), SANOUT(256)
      RESULT = 0

C     SAN exactly 128 bytes.
      DO 10 I = 1, 256
         DERBLK(I) = 0
         SANOUT(I) = 0
   10 CONTINUE
      DERBLK(1) = 130
      DERBLK(2) = 128
      DO 20 I = 1, 128
         DERBLK(I + 2) = 65
   20 CONTINUE
      CALL PARSSAN(DERBLK, 130, SANOUT, OUTLEN, IERR)
      IF (IERR .NE. 0 .OR. OUTLEN .NE. 128) RESULT = RESULT + 1

C     SAN 129 bytes must set E_SANLONG.
      DERBLK(1) = 130
      DERBLK(2) = 129
      DO 30 I = 1, 129
         DERBLK(I + 2) = 66
   30 CONTINUE
      CALL PARSSAN(DERBLK, 131, SANOUT, OUTLEN, IERR)
      IF (IERR .NE. 9001) RESULT = RESULT + 2

C     SAN 256 bytes must set E_SANLONG before signature storage changes.
      DERBLK(1) = 130
      DERBLK(2) = 255
      DO 40 I = 1, 254
         DERBLK(I + 2) = 67
   40 CONTINUE
      CALL PARSSAN(DERBLK, 256, SANOUT, OUTLEN, IERR)
      IF (IERR .NE. 9001) RESULT = RESULT + 4

C     iPAddress tag 0x87 is valid and maps to type 7.
      IF (SANTYP(135) .NE. 7) RESULT = RESULT + 8

C     ASCII/EBCDIC alphabetic comparison normalizes through CPCHAR.
      CALL SANCOMP(193, 65, MATCH)
      IF (MATCH .NE. 1) RESULT = RESULT + 16

      RETURN
      END

      BLOCK DATA TLSDAT
      IMPLICIT NONE
      CHARACTER*256 CERTBUF
      CHARACTER*128 SIGBLOCK
      CHARACTER*256 TMPBUF
      INTEGER IERR, IPTR, CPTRANS(64)
      COMMON /TLSBLK/ CERTBUF, SIGBLOCK, TMPBUF, IERR, IPTR,
     &                CPTRANS
      DATA CERTBUF /' '/
      DATA SIGBLOCK /' '/
      DATA TMPBUF /' '/
      DATA IERR /0/
      DATA IPTR /0/
C     Selected EBCDIC uppercase A-Z map values, compacted into 1..26.
      DATA CPTRANS /
     & 65,66,67,68,69,70,71,72,73,
     & 74,75,76,77,78,79,80,81,82,
     & 83,84,85,86,87,88,89,90,
     & 38*0 /
      END
