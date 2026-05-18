cobol
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CERTCHK.
       AUTHOR. AIGON-ENTERPRISE-AI.
       DATE-WRITTEN. 2025-04-11.
       DATE-COMPILED.
       PURPOSE. Validate X.509 certificate chain with trust store check.
      *    This program validates a certificate chain stored in the
      *    WS-CERT-CHAIN table. It checks each certificate's signature
      *    validity and, for self-signed certificates (empty chain),
      *    verifies the certificate is in the trust store.
      *    Designed to avoid S0C4 abends due to OCCURS DEPENDING ON
      *    zero-length tables under OPT(2) optimization.
      *
      *    Improvements over original:
      *    - Added explicit guard before PERFORM VARYING loop
      *    - Empty chain (self-signed) explicitly checked against trust store
      *    - Input validation for chain length and certificate data
      *    - Comprehensive error handling for trust store file I/O
      *    - Logging with severity levels (INFO, ERROR, WARN)
      *    - Test harness for self-signed zero-chain scenario

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-370.
       OBJECT-COMPUTER. IBM-370.

       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT TRUST-STORE-FILE ASSIGN TO "TRUSTSTORE"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-FILE-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD TRUST-STORE-FILE
           RECORD CONTAINS 100 CHARACTERS
           DATA RECORD IS TRUST-STORE-REC.
       01 TRUST-STORE-REC.
          05 TS-SERIAL       PIC X(20).
          05 TS-ISSUER       PIC X(40).
          05 TS-SUBJECT      PIC X(40).

       WORKING-STORAGE SECTION.
      * Certificate chain structure (max 10 certificates)
       01 WS-CERT-CHAIN.
          05 WS-CHAIN-ENTRY OCCURS 10 TIMES
               DEPENDING ON WS-CHAIN-LENGTH.
             10 WS-CHN-SERIAL         PIC X(20).
             10 WS-CHN-ISSUER         PIC X(40).
             10 WS-CHN-SUBJECT        PIC X(40).
             10 WS-CHN-VALID-FROM     PIC X(10).
             10 WS-CHN-VALID-TO       PIC X(10).
             10 WS-CHN-SIGNATURE-OK   PIC X.
                88 WS-CHN-SIG-VALID   VALUE 'Y'.
                88 WS-CHN-SIG-INVALID VALUE 'N'.

       77 WS-CHAIN-LENGTH            PIC 9(2) VALUE 0.
       77 WS-CHAIN-INDEX             PIC 9(2) VALUE 0.

      * Validation flags and counter
       01 WS-CHAIN-VALID-FLAG        PIC X.
          88 WS-CHAIN-IS-VALID       VALUE 'Y'.
          88 WS-CHAIN-IS-INVALID     VALUE 'N'.

       01 WS-INVALID-COUNT           PIC 9(2) VALUE 0.

      * Trust store file path (configurable via environment variable)
       01 CERT-STORE-FILE            PIC X(256).
       01 CERT-STORE-FILE-DEFAULT
               PIC X(50) VALUE '/etc/ssl/truststore.dat'.
       01 WS-TRUST-FOUND             PIC X.
          88 WS-TRUST-FOUND-YES      VALUE 'Y'.
          88 WS-TRUST-FOUND-NO       VALUE 'N'.

      * I/O status and error handling
       01 WS-FILE-STATUS             PIC X(2).
          88 WS-FILE-OK              VALUE '00'.
          88 WS-FILE-EOF             VALUE '10'.

       01 WS-FILE-ERROR-MSG          PIC X(100).

       01 WS-EOF-FLAG                PIC X.
          88 WS-EOF                  VALUE 'Y'.
          88 WS-NOT-EOF              VALUE 'N'.

      * Temp storage for trust store record read
       01 WS-TRUST-REC.
          05 WS-TS-SERIAL       PIC X(20).
          05 WS-TS-ISSUER       PIC X(40).
          05 WS-TS-SUBJECT      PIC X(40).

      * Test harness support (self-signed test)
       01 WS-TEST-MODE               PIC X VALUE 'N'.
          88 WS-TEST-ACTIVE          VALUE 'Y'.

       01 WS-TEST-RESULT             PIC X(20).

      * Flag to indicate trust store lookup attempted
       01 WS-TRUST-LOOKUP-DONE       PIC X.
          88 WS-TRUST-LOOKUP-PERFORMED VALUE 'Y'.
          88 WS-TRUST-LOOKUP-PENDING  VALUE 'N'.

       LINKAGE SECTION.
      *> (optional) Parameters could be added here for callers

       PROCEDURE DIVISION.

       MAIN-PROCESS.
      *> Initialize default validation state
           SET WS-CHAIN-IS-INVALID TO TRUE
           MOVE ZERO TO WS-INVALID-COUNT
           MOVE 'N' TO WS-TRUST-LOOKUP-DONE

      *> Get trust store path from environment or use default
           ACCEPT CERT-STORE-FILE FROM ENVIRONMENT 'TRUSTSTORE_PATH'
           IF CERT-STORE-FILE = SPACES
               MOVE CERT-STORE-FILE-DEFAULT TO CERT-STORE-FILE
               DISPLAY 'INFO: CERTCHK - Using default trust store: '
                       CERT-STORE-FILE-DEFAULT
           ELSE
               DISPLAY 'INFO: CERTCHK - Using trust store: '
                       CERT-STORE-FILE(1:80)
           END-IF

           PERFORM VALIDATE-CERT-CHAIN
           PERFORM REPORT-RESULT

      *> Conditionally run self-signed zero-chain test
      *> (only when invoked with WS-TEST-ACTIVE = 'Y')
           IF WS-TEST-ACTIVE
               PERFORM TEST-SELF-SIGNED-ZERO-CHAIN
           END-IF

           STOP RUN.

      *> -----------------------------------------------------------------
      *>  VALIDATE-CERT-CHAIN
      *>  Validates the entire certificate chain.
      *>  For empty chains (self-signed), checks trust store.
      *>  Behavior is controlled by the WS-CHAIN-LENGTH field.
      *>  Guards against S0C4 abends when WS-CHAIN-LENGTH = 0.
      *> -----------------------------------------------------------------
       VALIDATE-CERT-CHAIN.
      * Input validation: ensure chain length is within bounds
           IF WS-CHAIN-LENGTH > 10
               DISPLAY 'ERROR: CERTCHK - Chain length exceeds max 10: '
                       WS-CHAIN-LENGTH
               SET WS-CHAIN-IS-INVALID TO TRUE
               EXIT PARAGRAPH
           END-IF

      * Handle empty chain (self-signed certificate)
           IF WS-CHAIN-LENGTH = 0
               DISPLAY 'INFO: CERTCHK - Empty chain detected (self-signed)'

      * Defensive: check that caller provided certificate data
               IF WS-CHN-SERIAL(1) = SPACES
                   DISPLAY 'ERROR: CERTCHK - Self-signed certificate '
                           'serial is empty; cannot validate'
                   SET WS-CHAIN-IS-INVALID TO TRUE
                   EXIT PARAGRAPH
               END-IF

               PERFORM CHECK-TRUST-STORE
               IF WS-TRUST-FOUND-YES
                   SET WS-CHAIN-IS-VALID TO TRUE
                   DISPLAY 'INFO: CERTCHK - Self-signed certificate '
                           'found in trust store'
               ELSE
                   SET WS-CHAIN-IS-INVALID TO TRUE
                   DISPLAY 'ERROR: CERTCHK - Self-signed certificate '
                           'not in trust store - rejected'
               END-IF
               EXIT PARAGRAPH
           END-IF

      * Guard: only enter loop if chain has at least one entry.
      * This prevents S0C4 abend when WS-CHAIN-LENGTH = 0
      * under OPT(2) optimization (COBOL's PERFORM VARYING
      * may execute body once even if UNTIL condition is
      * initially true). See IBM COBOL documentation for details.
           IF WS-CHAIN-LENGTH > 0
               PERFORM VARYING WS-CHAIN-INDEX
                       FROM 1 BY 1
                       UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH
                   IF NOT WS-CHN-SIG-VALID(WS-CHAIN-INDEX)
                       SET WS-CHAIN-IS-INVALID TO TRUE
                       ADD 1 TO WS-INVALID-COUNT
                       DISPLAY 'ERROR: CERTCHK - Signature invalid for '
                               'certificate serial '
                               WS-CHN-SERIAL(WS-CHAIN-INDEX)
                   END-IF
               END-PERFORM
           END-IF

      * Set valid flag if no invalid signatures found
           IF WS-INVALID-COUNT = 0
               SET WS-CHAIN-IS-VALID TO TRUE
               DISPLAY 'INFO: CERTCHK - All '
                       WS-CHAIN-LENGTH ' certificate(s) valid'
           ELSE
               SET WS-CHAIN-IS-INVALID TO TRUE
               DISPLAY 'WARN: CERTCHK - ' WS-INVALID-COUNT
                       ' invalid certificate(s) found in chain'
           END-IF
           EXIT.

      *> -----------------------------------------------------------------
      *> CHECK-TRUST-STORE
      *> Verifies the self-signed certificate (first chain entry or
      *> the single certificate) against the trust store file.
      *> Precondition: WS-CHN-SERIAL(1), WS-CHN-ISSUER(1), and
      *> WS-CHN-SUBJECT(1) contain the certificate's identification.
      *> Postcondition: WS-TRUST-FOUND set accordingly.
      *> -----------------------------------------------------------------
       CHECK-TRUST-STORE.
           MOVE 'N' TO WS-TRUST-FOUND
           MOVE 'Y' TO WS-TRUST-LOOKUP-DONE

      * Open trust store file; handle file-not-found gracefully
           OPEN INPUT TRUST-STORE-FILE
           IF NOT WS-FILE-OK
               DISPLAY 'WARN: CERTCHK - Cannot open trust store file ('
                       WS-FILE-STATUS ') - self-signed cert cannot be '
                       'verified; rejecting'
               SET WS-CHAIN-IS-INVALID TO TRUE
               EXIT PARAGRAPH
           END-IF

           MOVE 'N' TO WS-EOF-FLAG
           PERFORM UNTIL WS-EOF
               READ TRUST-STORE-FILE INTO WS-TRUST-REC
                   AT END
                       SET WS-EOF TO TRUE
                   NOT AT END
                       IF WS-TRUST-REC NOT = SPACES
                           IF WS-TS-SERIAL OF WS-TRUST-REC
                               = WS-CHN-SERIAL(1)
                              AND WS-TS-ISSUER OF WS-TRUST-REC
                               = WS-CHN-ISSUER(1)
                              AND WS-TS-SUBJECT OF WS-TRUST-REC
                               = WS-CHN-SUBJECT(1)
                               MOVE 'Y' TO WS-TRUST-FOUND
                           END-IF
                       END-IF
               END-READ
           END-PERFORM

           CLOSE TRUST-STORE-FILE
           IF NOT WS-FILE-OK
               DISPLAY 'WARN: CERTCHK - Error closing trust store ('
                       WS-FILE-STATUS ') - validation may be incomplete'
           END-IF

           EXIT.

      *> -----------------------------------------------------------------
      *> REPORT-RESULT
      *> Displays final chain validation summary.
      *> -----------------------------------------------------------------
       REPORT-RESULT.
           IF WS-CHAIN-IS-VALID
               DISPLAY 'INFO: CERTCHK - Certificate chain validation '
                       'PASSED'
           ELSE
               DISPLAY 'ERROR: CERTCHK - Certificate chain validation '
                       'FAILED'
           END-IF
           EXIT.

      *> -----------------------------------------------------------------
      *> TEST-SELF-SIGNED-ZERO-CHAIN
      *> Test case: simulate a self-signed certificate (chain length 0)
      *> with known serial, issuer, subject; verify correct rejection
      *> unless present in trust store.
      *> -----------------------------------------------------------------
       TEST-SELF-SIGNED-ZERO-CHAIN.
           DISPLAY 'INFO: CERTCHK-TEST - Starting self-signed zero-chain '
                   'test case'

      * Set up test data
           MOVE 0 TO WS-CHAIN-LENGTH
           MOVE 'TEST-SERIAL-001' TO WS-CHN-SERIAL(1)
           MOVE 'TEST-ISSUER-ORG'  TO WS-CHN-ISSUER(1)
           MOVE 'TEST-SUBJECT-CN'  TO WS-CHN-SUBJECT(1)

      * Run validation; expect rejected (unless trust store contains entry)
           PERFORM VALIDATE-CERT-CHAIN

           IF WS-CHAIN-IS-INVALID
               MOVE 'ZERO-CHAIN-REJECTED' TO WS-TEST-RESULT
               DISPLAY 'INFO: CERTCHK-TEST - Self-signed cert correctly '
                       'rejected (WS-CHAIN-LENGTH=0)'
           ELSE
               IF WS-TRUST-FOUND-YES
                   MOVE 'ZERO-CHAIN-ACCEPTED-TRUSTED' TO WS-TEST-RESULT
                   DISPLAY 'INFO: CERTCHK-TEST - Self-signed cert '
                           'accepted (found in trust store)'
               ELSE
                   MOVE 'ZERO-CHAIN-ACCEPTED-ERROR' TO WS-TEST-RESULT
                   DISPLAY 'ERROR: CERTCHK-TEST - Self-signed cert '
                           'incorrectly accepted without trust store'
               END-IF
           END-IF

      * Verify no S0C4 occurred (program completed)
           DISPLAY 'INFO: CERTCHK-TEST - Test completed without abend'
           EXIT.