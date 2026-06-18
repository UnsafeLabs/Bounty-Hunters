       IDENTIFICATION DIVISION.
       PROGRAM-ID. TLS-CERT-VALIDATOR-AUDIT-TEST.
       AUTHOR. MAINFRAME-SECURITY-TEAM.
      *================================================================
      * UNIT TEST FOR 8000-WRITE-AUDIT-ENTRY (TLS-CERT-VALIDATOR, #519)
      *
      * The audit-record construction run by the program under test
      * lives in copybook AUDIT-BUILD. This test COPYs that same
      * copybook into 5000-BUILD-AUDIT-RECORD, so it exercises the EXACT
      * STRING the program runs - not a hand-copied reimplementation.
      * Reverting the fix in the copybook makes these assertions fail.
      *
      * REAL REGRESSION (#519): the original audit STRING wrote only
      * TIMESTAMP|SERIAL|RESULT|MSG - the Issuer and Subject DN were
      * ABSENT, so a validated certificate could not be identified from
      * the trail. The fix adds both DNs. (Standard COBOL STRING never
      * writes past its receiving field, so the old record did NOT
      * corrupt adjacent storage; it simply omitted the DNs.) Because a
      * long DN can fill the 512-byte record, the STRING also uses WITH
      * POINTER + ON OVERFLOW so an over-length DN is marked truncated
      * instead of being dropped silently.
      *
      *   SCENARIO A - a Subject DN that fits: the record must contain
      *     the Issuer and Subject DN and carry all six pipe-delimited
      *     fields, with no truncation. This is what fails on the
      *     unfixed program, where both DNs are absent.
      *
      *   SCENARIO B - an over-length Subject DN: the build must fire
      *     ON OVERFLOW, stamp '[TRUNCATED]' at the record tail and keep
      *     the write pointer within the 512-byte record.
      *================================================================
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-CERT-SERIAL-NUM         PIC X(40).
       01  WS-ISSUER-COMMON-NAME      PIC X(64).
      *    Widened past the program's X(64) so SCENARIO B can drive the
      *    defensive overflow guard; SCENARIO A uses a value that fits.
       01  WS-SUBJECT-COMMON-NAME     PIC X(600).
       01  WS-VALIDATION-RESULT       PIC X(1).
       01  WS-VALIDATION-MSG          PIC X(128).
       01  WS-AUDIT-TIMESTAMP         PIC X(26).
       01  WS-AUDIT-RECORD            PIC X(512).
       01  WS-AUDIT-MAX-LEN           PIC 9(4)  VALUE 512.
       01  WS-AUDIT-PTR               PIC 9(4)  VALUE 1.
       01  WS-AUDIT-TRUNC-FLAG        PIC X(1)  VALUE 'N'.
           88  WS-AUDIT-IS-TRUNCATED  VALUE 'Y'.
           88  WS-AUDIT-NOT-TRUNCATED VALUE 'N'.
       01  WS-TRUNCATION-MARKER       PIC X(11) VALUE '[TRUNCATED]'.
       01  WS-PIPE-COUNT              PIC 9(4)  VALUE 0.
       01  WS-ISSUER-HITS             PIC 9(4)  VALUE 0.
       01  WS-SUBJECT-HITS            PIC 9(4)  VALUE 0.
       01  WS-FAIL-COUNT              PIC 9(2)  VALUE 0.
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-COMMON-FIXTURE
           PERFORM 2000-SCENARIO-A-DN-FITS
           PERFORM 3000-SCENARIO-B-OVERSIZED-DN
           PERFORM 9000-REPORT
           STOP RUN.
       1000-COMMON-FIXTURE.
      *    Space-free DN tokens so DELIMITED SPACES captures them whole.
           MOVE 'CERT-SERIAL-0001'      TO WS-CERT-SERIAL-NUM
           MOVE 'CN=Enterprise-Root-CA' TO WS-ISSUER-COMMON-NAME
           MOVE 'V'                     TO WS-VALIDATION-RESULT
           MOVE 'VALIDATION SUCCESSFUL' TO WS-VALIDATION-MSG
           MOVE '2026-06-19-12.00.00.000000' TO WS-AUDIT-TIMESTAMP
           .
       2000-SCENARIO-A-DN-FITS.
           MOVE SPACES TO WS-SUBJECT-COMMON-NAME
           MOVE 'CN=app.node-01,OU=Payments,O=Bank,C=US'
               TO WS-SUBJECT-COMMON-NAME
           PERFORM 5000-BUILD-AUDIT-RECORD
           IF WS-AUDIT-NOT-TRUNCATED
               DISPLAY 'PASS A: DN that fits captured, no truncation'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL A: DN that fits was truncated'
           END-IF
           MOVE 0 TO WS-SUBJECT-HITS
           INSPECT WS-AUDIT-RECORD TALLYING WS-SUBJECT-HITS
               FOR ALL 'CN=app.node-01'
           IF WS-SUBJECT-HITS > 0
               DISPLAY 'PASS A: Subject DN present in audit record'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL A: Subject DN missing from audit record'
           END-IF
           MOVE 0 TO WS-ISSUER-HITS
           INSPECT WS-AUDIT-RECORD TALLYING WS-ISSUER-HITS
               FOR ALL 'CN=Enterprise-Root-CA'
           IF WS-ISSUER-HITS > 0
               DISPLAY 'PASS A: Issuer DN present in audit record'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL A: Issuer DN missing from audit record'
           END-IF
           MOVE 0 TO WS-PIPE-COUNT
           INSPECT WS-AUDIT-RECORD TALLYING WS-PIPE-COUNT
               FOR ALL '|'
           IF WS-PIPE-COUNT = 5
               DISPLAY 'PASS A: all six audit fields present'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL A: expected 5 field separators, found '
                   WS-PIPE-COUNT
           END-IF
           .
       3000-SCENARIO-B-OVERSIZED-DN.
      *    A 600-byte DN that overflows the 512-byte record. The program
      *    logs only X(64) of the subject and never overflows; this wide
      *    field exists only to drive the defensive ON OVERFLOW guard.
           MOVE ALL 'Y' TO WS-SUBJECT-COMMON-NAME
           MOVE 'CN=very-long-subject,OU=Dept,O=Org,C=US'
               TO WS-SUBJECT-COMMON-NAME(1:39)
           PERFORM 5000-BUILD-AUDIT-RECORD
           IF WS-AUDIT-IS-TRUNCATED
               DISPLAY 'PASS B: oversized DN triggered overflow'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL B: overflow not detected'
           END-IF
           IF WS-AUDIT-RECORD(WS-AUDIT-MAX-LEN - 10:11)
               = WS-TRUNCATION-MARKER
               DISPLAY 'PASS B: record ends with [TRUNCATED]'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL B: missing [TRUNCATED] marker'
           END-IF
           IF WS-AUDIT-PTR <= WS-AUDIT-MAX-LEN + 1
               DISPLAY 'PASS B: write pointer within record bounds'
           ELSE
               ADD 1 TO WS-FAIL-COUNT
               DISPLAY 'FAIL B: write pointer past record end'
           END-IF
           .
       5000-BUILD-AUDIT-RECORD.
      *    Runs the exact program-under-test build via the copybook.
           COPY AUDIT-BUILD.
           .
       9000-REPORT.
           IF WS-FAIL-COUNT = 0
               DISPLAY 'TEST RESULT: ALL ASSERTIONS PASSED'
               MOVE 0 TO RETURN-CODE
           ELSE
               DISPLAY 'TEST RESULT: ' WS-FAIL-COUNT ' ASSERTION(S) '
                   'FAILED'
               MOVE 8 TO RETURN-CODE
           END-IF
           .
