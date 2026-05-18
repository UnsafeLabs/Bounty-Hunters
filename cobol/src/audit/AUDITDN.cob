       IDENTIFICATION DIVISION.
       PROGRAM-ID. AUDITDN.
      * Fix: STRING overflow silently truncating Subject DN
      * in audit log entries (#519)
      *
      * Problem: STRING INTO target truncates when Subject DN
      * exceeds receiving field length, silently losing data.
      *
      * Solution: Use POINTER clause to track position,
      * check OVERFLOW condition, and log warning when
      * truncation would occur. Split long DNs across
      * multiple log entries.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT AUDIT-FILE ASSIGN TO "AUDIT.LOG"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS AUDIT-FILE-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  AUDIT-FILE.
       01  AUDIT-RECORD             PIC X(500).

       WORKING-STORAGE SECTION.
       01  AUDIT-FILE-STATUS        PIC XX VALUE SPACES.
       01  SUBJECT-DN               PIC X(500) VALUE SPACES.
       01  DN-POINTER               PIC 9(4) VALUE 1.
       01  DN-LENGTH                PIC 9(4) VALUE 0.
       01  MAX-DN-LENGTH            PIC 9(4) VALUE 500.
       01  TRUNCATION-WARNING       PIC X(80) VALUE SPACES.
       01  OVERFLOW-FLAG            PIC X VALUE "N".
           88  OVERFLOW-OCCURRED    VALUE "Y".
           88  NO-OVERFLOW         VALUE "N".
       01  REMAINING-DN             PIC X(500) VALUE SPACES.
       01  REMAINING-LENGTH         PIC 9(4) VALUE 0.
       01  AUDIT-ENTRY-COUNT        PIC 9(4) VALUE 1.

       LINKAGE SECTION.
       01  LS-CN-SUBJECT            PIC X(500).
       01  LS-RETURN-CODE           PIC 9 VALUE 0.
           88  RC-SUCCESS           VALUE 0.
           88  RC-TRUNCATED         VALUE 1.
           88  RC-ERROR             VALUE 9.

       PROCEDURE DIVISION USING LS-CN-SUBJECT
                                 LS-RETURN-CODE.
       MAIN-LOGIC.
           MOVE "N" TO OVERFLOW-FLAG
           MOVE 0 TO LS-RETURN-CODE
           MOVE 1 TO DN-POINTER
           MOVE 1 TO AUDIT-ENTRY-COUNT

           INSPECT LS-CN-SUBJECT
               TALLYING DN-LENGTH
               FOR CHARACTERS BEFORE INITIAL SPACES

           IF DN-LENGTH <= MAX-DN-LENGTH
               PERFORM WRITE-FULL-DN
           ELSE
               PERFORM WRITE-SPLIT-DN
               SET RC-TRUNCATED TO TRUE
           END-IF

           GOBACK.

       WRITE-FULL-DN.
           OPEN EXTEND AUDIT-FILE
           IF AUDIT-FILE-STATUS NOT = "00"
               OPEN OUTPUT AUDIT-FILE
           END-IF

           INITIALIZE AUDIT-RECORD
           STRING "AUDIT_DN_SUBJECT="
               DELIMITED BY SIZE
               LS-CN-SUBJECT
               DELIMITED BY SPACES
               INTO AUDIT-RECORD
               WITH POINTER DN-POINTER
               ON OVERFLOW
                   SET OVERFLOW-OCCURRED TO TRUE
                   PERFORM HANDLE-OVERFLOW
               NOT ON OVERFLOW
                   CONTINUE
               END-STRING

           WRITE AUDIT-RECORD
           CLOSE AUDIT-FILE.

       WRITE-SPLIT-DN.
      *    Split long DN across multiple log entries
      *    to prevent silent truncation
           OPEN EXTEND AUDIT-FILE
           IF AUDIT-FILE-STATUS NOT = "00"
               OPEN OUTPUT AUDIT-FILE
           END-IF

           MOVE 1 TO DN-POINTER
           PERFORM UNTIL DN-POINTER > DN-LENGTH
               INITIALIZE AUDIT-RECORD
               STRING "AUDIT_DN_PART="
                   AUDIT-ENTRY-COUNT
                   DELIMITED BY SIZE
                   "/"
                   DELIMITED BY SIZE
                   LS-CN-SUBJECT(DN-POINTER:MAX-DN-LENGTH)
                   DELIMITED BY SPACES
                   INTO AUDIT-RECORD
               END-STRING

               WRITE AUDIT-RECORD
               ADD MAX-DN-LENGTH TO DN-POINTER
               ADD 1 TO AUDIT-ENTRY-COUNT
           END-PERFORM

           CLOSE AUDIT-FILE.

       HANDLE-OVERFLOW.
           STRING "WARNING:DN_TRUNCATED_AT="
               DELIMITED BY SIZE
               DN-POINTER
               DELIMITED BY SIZE
               INTO TRUNCATION-WARNING
           END-STRING
           MOVE TRUNCATION-WARNING TO AUDIT-RECORD
           WRITE AUDIT-RECORD.

       END PROGRAM AUDITDN.
