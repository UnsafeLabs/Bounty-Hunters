C     TLS module fixes for EQUIVALENCE SAN overflow (issue #563)
C     TMPBUF is independent of SIGBLOCK; PARSSAN bounds-checks IPTR.
      SUBROUTINE PARSSAN(DERBLK, NDER, IERR)
      IMPLICIT NONE
      CHARACTER*512 DERBLK
      INTEGER NDER, IERR
      CHARACTER*256 TMPBUF
      CHARACTER*256 CERTBUF
      CHARACTER*128 SIGBLOCK
      INTEGER IPTR, J
      INTEGER E_SANLONG
      PARAMETER (E_SANLONG=901)
      IPTR = 1
      IERR = 0
      DO 200 J = 1, NDER
        IF (IPTR .GT. 256) THEN
          IERR = E_SANLONG
          GO TO 900
        END IF
        TMPBUF(IPTR:IPTR) = DERBLK(J:J)
        IPTR = IPTR + 1
  200 CONTINUE
      RETURN
  900 CONTINUE
      RETURN
      END

      INTEGER FUNCTION SANTYP(TAGBYTE)
      IMPLICIT NONE
      INTEGER TAGBYTE
C     Return SAN type index or -1 if unknown (covers 0x80-0x87)
      IF (TAGBYTE .GE. 128 .AND. TAGBYTE .LE. 135) THEN
        SANTYP = TAGBYTE - 127
      ELSE
        SANTYP = -1
      END IF
      RETURN
      END

      INTEGER FUNCTION CPCHAR(A, B)
C     Code-page neutral compare using ICHAR on both sides
      IMPLICIT NONE
      CHARACTER*1 A, B
      IF (ICHAR(A) .EQ. ICHAR(B)) THEN
        CPCHAR = 1
      ELSE
        CPCHAR = 0
      END IF
      RETURN
      END
