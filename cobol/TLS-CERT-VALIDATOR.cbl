       IDENTIFICATION DIVISION.
       PROGRAM-ID. TLS-CERT-VALIDATOR.
       AUTHOR. MAINFRAME-SECURITY-TEAM.
       DATE-WRITTEN. 2019-03-14.
      *================================================================
      * TLS CERTIFICATE VALIDATOR - BANKING TRANSACTION SYSTEM
      * VALIDATES X.509 CERTS AGAINST INTERNAL TRUST STORE
      *================================================================
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CERT-STORE-FILE ASSIGN TO 'CERTSTOR'
               ORGANIZATION IS INDEXED ACCESS MODE IS DYNAMIC
               RECORD KEY IS CS-CERT-SERIAL
               FILE STATUS IS WS-FILE-STATUS.
           SELECT CRL-FILE ASSIGN TO 'CRLDATA'
               ORGANIZATION IS SEQUENTIAL
               FILE STATUS IS WS-CRL-FILE-STATUS.
           SELECT AUDIT-LOG-FILE ASSIGN TO 'AUDITLOG'
               ORGANIZATION IS SEQUENTIAL
               FILE STATUS IS WS-AUDIT-FILE-STATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  CERT-STORE-FILE.
       01  CERT-STORE-RECORD.
           05  CS-CERT-SERIAL          PIC X(40).
           05  CS-ISSUER-DN            PIC X(256).
           05  CS-SUBJECT-DN           PIC X(256).
           05  CS-NOT-BEFORE           PIC X(14).
           05  CS-NOT-AFTER            PIC X(14).
           05  CS-KEY-LENGTH           PIC 9(5).
           05  CS-SIG-ALGORITHM        PIC X(20).
           05  CS-FINGERPRINT          PIC X(64).
           05  CS-TRUST-ANCHOR-FLAG    PIC X(1).
               88  CS-IS-TRUST-ANCHOR  VALUE 'Y'.
               88  CS-NOT-TRUST-ANCHOR VALUE 'N'.
           05  CS-LAST-VALIDATED       PIC X(26).
       FD  CRL-FILE.
       01  CRL-RECORD.
           05  CRL-ISSUER-DN           PIC X(256).
           05  CRL-REVOKED-SERIAL      PIC X(40).
           05  CRL-REVOCATION-DATE     PIC X(14).
           05  CRL-REASON-CODE         PIC 9(2).
       FD  AUDIT-LOG-FILE.
       01  AUDIT-LOG-RECORD            PIC X(512).
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS              PIC XX.
           88  WS-FILE-OK              VALUE '00'.
           88  WS-FILE-NOT-FOUND       VALUE '23'.
           88  WS-FILE-LOGIC-ERROR     VALUE '92'.
           88  WS-FILE-RESOURCE-BUSY   VALUE '93'.
           88  WS-FILE-LOCKED          VALUE '95'.
       01  WS-CRL-FILE-STATUS          PIC XX.
           88  WS-CRL-OK               VALUE '00'.
           88  WS-CRL-EOF              VALUE '10'.
       01  WS-AUDIT-FILE-STATUS        PIC XX.
       01  WS-CURRENT-CERT.
           05  WS-CERT-SERIAL-NUM      PIC X(40).
           05  WS-ISSUER-COMMON-NAME   PIC X(64).
           05  WS-SUBJECT-COMMON-NAME  PIC X(64).
           05  WS-CERT-NOT-BEFORE      PIC X(14).
           05  WS-CERT-NOT-AFTER       PIC X(14).
           05  WS-CERT-KEY-LENGTH      PIC 9(5).
           05  WS-CERT-SIG-ALGO        PIC X(20).
           05  WS-CERT-FINGERPRINT     PIC X(64).
       01  WS-CERT-CHAIN.
           05  WS-CHAIN-LENGTH         PIC 9(2)  VALUE 0.
           05  WS-CHAIN-ENTRY OCCURS 10 TIMES.
               10  WS-CHN-SERIAL       PIC X(40).
               10  WS-CHN-ISSUER       PIC X(64).
               10  WS-CHN-SUBJECT      PIC X(64).
               10  WS-CHN-NOT-AFTER    PIC X(14).
               10  WS-CHN-FINGERPRINT  PIC X(64).
               10  WS-CHN-VERIFIED     PIC X(1).
                   88  WS-CHN-IS-VERIFIED    VALUE 'Y'.
                   88  WS-CHN-NOT-VERIFIED   VALUE 'N'.
       01  WS-CHAIN-INDEX              PIC 9(2).
       01  WS-CHAIN-VALID              PIC X(1).
           88  WS-CHAIN-IS-VALID       VALUE 'Y'.
           88  WS-CHAIN-IS-INVALID     VALUE 'N'.
       01  WS-CURRENT-DATE-TIME.
           05  WS-CURR-YEAR            PIC 9(4).
           05  WS-CURR-MONTH           PIC 9(2).
           05  WS-CURR-DAY             PIC 9(2).
       01  WS-CERT-EXPIRY-PARSED.
           05  WS-EXP-YEAR-2D          PIC 9(2).
           05  WS-EXP-MONTH            PIC 9(2).
           05  WS-EXP-DAY              PIC 9(2).
       01  WS-CURR-YEAR-2D             PIC 9(2).
       01  WS-DATE-CALC-FIELDS.
           05  WS-DAYS-UNTIL-EXPIRY    PIC S9(7).
           05  WS-YEAR-DIFF            PIC S9(4).
           05  WS-MONTH-DIFF           PIC S9(4).
           05  WS-TOTAL-DAYS-DIFF      PIC S9(9)V9(4).
           05  WS-EXPIRY-WARNING-DAYS  PIC 9(3)  VALUE 030.
           05  WS-CERT-EXPIRED-FLAG    PIC X(1).
               88  WS-CERT-IS-EXPIRED  VALUE 'Y'.
               88  WS-CERT-NOT-EXPIRED VALUE 'N'.
       01  WS-EXPECTED-HOSTNAME        PIC X(255).
       01  WS-HOSTNAME-TALLY           PIC 9(5)  VALUE 0.
       01  WS-WILDCARD-POS             PIC 9(3)  VALUE 0.
       01  WS-HOSTNAME-MATCH-FLAG      PIC X(1).
           88  WS-HOSTNAME-MATCHES     VALUE 'Y'.
           88  WS-HOSTNAME-NO-MATCH    VALUE 'N'.
       01  WS-DOT-COUNT                PIC 9(3)  VALUE 0.
       01  WS-CERT-REVOKED             PIC X(1).
           88  WS-CERT-IS-REVOKED      VALUE 'Y'.
           88  WS-CERT-NOT-REVOKED     VALUE 'N'.
       01  WS-CRL-LOADED               PIC X(1)  VALUE 'N'.
           88  WS-CRL-IS-LOADED        VALUE 'Y'.
           88  WS-CRL-NOT-LOADED       VALUE 'N'.
       01  WS-SIG-VERIFY-RESULT        PIC X(1).
           88  WS-SIG-VALID            VALUE 'V'.
           88  WS-SIG-INVALID          VALUE 'I'.
       01  WS-MIN-KEY-LENGTH           PIC 9(5)  VALUE 02048.
       01  WS-ALLOWED-ALGORITHMS.
           05  FILLER  PIC X(20) VALUE 'SHA256WITHRSA       '.
           05  FILLER  PIC X(20) VALUE 'SHA384WITHRSA       '.
           05  FILLER  PIC X(20) VALUE 'SHA512WITHRSA       '.
           05  FILLER  PIC X(20) VALUE 'SHA256WITHECDSA     '.
       01  WS-ALGO-TABLE REDEFINES WS-ALLOWED-ALGORITHMS.
           05  WS-ALGO-ENTRY           PIC X(20) OCCURS 4 TIMES.
       01  WS-ALGO-INDEX               PIC 9(1).
       01  WS-ALGO-FOUND               PIC X(1).
       01  WS-VALIDATION-RESULT        PIC X(1).
           88  WS-CERT-VALID           VALUE 'V'.
           88  WS-CERT-INVALID         VALUE 'I'.
       01  WS-VALIDATION-MSG           PIC X(128).
       01  WS-AUDIT-TIMESTAMP          PIC X(26).
       01  WS-RETURN-CODE              PIC S9(4) COMP VALUE 0.
       01  WS-CERTSTORE-RETRY-COUNT    PIC 9     VALUE 0.
       01  WS-CERTSTORE-MAX-RETRIES    PIC 9     VALUE 3.
       01  WS-CERTSTORE-DELAY-MS       PIC S9(8) COMP VALUE 100.
       01  WS-CERTSTORE-LOCK-FLAG      PIC X(1)  VALUE 'N'.
           88  WS-CERTSTORE-LOCK-HELD  VALUE 'Y'.
           88  WS-CERTSTORE-LOCK-FREE  VALUE 'N'.
       01  WS-CERTSTORE-OP-FLAG        PIC X(1)  VALUE 'N'.
           88  WS-CERTSTORE-FAILED     VALUE 'Y'.
           88  WS-CERTSTORE-OK         VALUE 'N'.
       01  WS-CICS-RESP                PIC S9(8) COMP VALUE 0.
       PROCEDURE DIVISION.
       0000-MAIN-CONTROL.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-VALIDATE-CERT-CHAIN
           PERFORM 3000-CHECK-EXPIRY-DATE
           PERFORM 4000-VERIFY-SIGNATURE
           PERFORM 5000-MATCH-HOSTNAME
           PERFORM 6000-CHECK-REVOCATION-STATUS
           PERFORM 7000-DETERMINE-FINAL-RESULT
           PERFORM 9000-CLEANUP
           STOP RUN.
       1000-INITIALIZE.
           MOVE SPACES TO WS-VALIDATION-MSG
           SET WS-CERT-NOT-EXPIRED TO TRUE
           SET WS-CERT-NOT-REVOKED TO TRUE
           SET WS-HOSTNAME-NO-MATCH TO TRUE
           SET WS-CHAIN-IS-INVALID TO TRUE
           SET WS-CERTSTORE-LOCK-FREE TO TRUE
           SET WS-CERTSTORE-OK TO TRUE
           EXEC CICS HANDLE CONDITION
                DSIDERR(1010-CERTSTORE-DSIDERR)
           END-EXEC
           MOVE FUNCTION CURRENT-DATE TO WS-CURRENT-DATE-TIME
           OPEN I-O CERT-STORE-FILE
           IF WS-FILE-LOGIC-ERROR OR WS-FILE-RESOURCE-BUSY
               OR WS-FILE-LOCKED
               PERFORM 2140-CERTSTORE-FAILURE
               MOVE 12 TO WS-RETURN-CODE
               PERFORM 9000-CLEANUP
               STOP RUN
           END-IF
           IF NOT WS-FILE-OK
               DISPLAY 'TLSVAL-E001: CERT STORE FAILED '
                   WS-FILE-STATUS
               MOVE 12 TO WS-RETURN-CODE
               PERFORM 9000-CLEANUP
               STOP RUN
           END-IF
           OPEN INPUT CRL-FILE
           IF WS-CRL-OK
               SET WS-CRL-IS-LOADED TO TRUE
           ELSE
               SET WS-CRL-NOT-LOADED TO TRUE
           END-IF
           OPEN EXTEND AUDIT-LOG-FILE
           DISPLAY 'TLSVAL-I001: VALIDATION STARTED'
           .
       1010-CERTSTORE-DSIDERR.
           DISPLAY 'TLSVAL-E010: CERT STORE DATASET MISSING'
           MOVE 'CERT STORE DATASET MISSING'
               TO WS-VALIDATION-MSG
           SET WS-CHAIN-IS-INVALID TO TRUE
           MOVE 12 TO WS-RETURN-CODE
           PERFORM 9000-CLEANUP
           STOP RUN
           .
       2000-VALIDATE-CERT-CHAIN.
           SET WS-CHAIN-IS-INVALID TO TRUE
           IF WS-CHAIN-LENGTH = 0
               SET WS-CHAIN-IS-INVALID TO TRUE
               GO TO 2000-EXIT
           END-IF
           PERFORM VARYING WS-CHAIN-INDEX FROM 1 BY 1
               UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH + 1
               MOVE WS-CHN-SERIAL(WS-CHAIN-INDEX)
                   TO CS-CERT-SERIAL
               PERFORM 2100-READ-UPDATE-CERT-STORE
               IF WS-CERTSTORE-FAILED
                   SET WS-CHAIN-IS-INVALID TO TRUE
                   GO TO 2000-EXIT
               END-IF
               IF WS-CHAIN-INDEX = WS-CHAIN-LENGTH
                   IF NOT CS-IS-TRUST-ANCHOR
                       SET WS-CHAIN-IS-INVALID TO TRUE
                       GO TO 2000-EXIT
                   END-IF
               END-IF
               IF WS-CHAIN-INDEX > 1
                   IF WS-CHN-ISSUER(WS-CHAIN-INDEX - 1)
                       NOT = WS-CHN-SUBJECT(WS-CHAIN-INDEX)
                       SET WS-CHAIN-IS-INVALID TO TRUE
                       GO TO 2000-EXIT
                   END-IF
               END-IF
               SET WS-CHN-IS-VERIFIED(WS-CHAIN-INDEX) TO TRUE
           END-PERFORM
           SET WS-CHAIN-IS-VALID TO TRUE
           .
       2000-EXIT.
           EXIT.
       2100-READ-UPDATE-CERT-STORE.
           SET WS-CERTSTORE-OK TO TRUE
           SET WS-CERTSTORE-LOCK-FREE TO TRUE
           MOVE SPACES TO WS-FILE-STATUS
           MOVE 0 TO WS-CERTSTORE-RETRY-COUNT
           PERFORM UNTIL WS-CERTSTORE-RETRY-COUNT =
                   WS-CERTSTORE-MAX-RETRIES
                   OR WS-FILE-OK
                   OR WS-CERTSTORE-FAILED
               ADD 1 TO WS-CERTSTORE-RETRY-COUNT
               PERFORM 2110-CERTSTORE-ENQ
               IF WS-CERTSTORE-LOCK-HELD
                   READ CERT-STORE-FILE
                       INVALID KEY
                           DISPLAY 'TLSVAL-E011: UNKNOWN CERT '
                               WS-CHN-SERIAL(WS-CHAIN-INDEX)
                           SET WS-CERTSTORE-FAILED TO TRUE
                   END-READ
                   IF WS-FILE-OK
                       MOVE FUNCTION CURRENT-DATE
                           TO CS-LAST-VALIDATED
                       REWRITE CERT-STORE-RECORD
                       END-REWRITE
                   END-IF
                   PERFORM 2120-CERTSTORE-DEQ
               END-IF
               IF WS-FILE-LOGIC-ERROR OR WS-FILE-RESOURCE-BUSY
                   OR WS-FILE-LOCKED
                   IF WS-CERTSTORE-RETRY-COUNT <
                       WS-CERTSTORE-MAX-RETRIES
                       PERFORM 2130-CERTSTORE-RETRY-DELAY
                   ELSE
                       PERFORM 2140-CERTSTORE-FAILURE
                   END-IF
               END-IF
           END-PERFORM
           IF NOT WS-FILE-OK AND NOT WS-CERTSTORE-FAILED
               PERFORM 2140-CERTSTORE-FAILURE
           END-IF
           .
       2110-CERTSTORE-ENQ.
           EXEC CICS ENQ
                RESOURCE('CERTSTOR')
                LENGTH(8)
                RESP(WS-CICS-RESP)
           END-EXEC
           IF WS-CICS-RESP = 0
               SET WS-CERTSTORE-LOCK-HELD TO TRUE
           ELSE
               MOVE '93' TO WS-FILE-STATUS
           END-IF
           .
       2120-CERTSTORE-DEQ.
           IF WS-CERTSTORE-LOCK-HELD
               EXEC CICS DEQ
                    RESOURCE('CERTSTOR')
                    LENGTH(8)
                    RESP(WS-CICS-RESP)
               END-EXEC
               SET WS-CERTSTORE-LOCK-FREE TO TRUE
               IF WS-CICS-RESP NOT = 0
                   DISPLAY 'TLSVAL-W013: CERT STORE DEQ RESP '
                       WS-CICS-RESP
               END-IF
           END-IF
           .
       2130-CERTSTORE-RETRY-DELAY.
           DISPLAY 'TLSVAL-W012: CERT STORE RETRY '
               WS-CERTSTORE-RETRY-COUNT
               ' STATUS ' WS-FILE-STATUS
           EXEC CICS DELAY
                FOR MILLISECS(WS-CERTSTORE-DELAY-MS)
                RESP(WS-CICS-RESP)
           END-EXEC
           .
       2140-CERTSTORE-FAILURE.
           PERFORM 2120-CERTSTORE-DEQ
           SET WS-CERTSTORE-FAILED TO TRUE
           SET WS-CHAIN-IS-INVALID TO TRUE
           STRING 'CERT STORE ACCESS FAILED STATUS '
               DELIMITED SIZE
               WS-FILE-STATUS DELIMITED SIZE
               ' AFTER RETRIES' DELIMITED SIZE
               INTO WS-VALIDATION-MSG
           END-STRING
           DISPLAY 'TLSVAL-E012: CERT STORE STATUS '
               WS-FILE-STATUS
               ' RETRIES ' WS-CERTSTORE-RETRY-COUNT
           .
       3000-CHECK-EXPIRY-DATE.
           MOVE WS-CERT-NOT-AFTER(1:2)  TO WS-EXP-YEAR-2D
           MOVE WS-CERT-NOT-AFTER(3:2)  TO WS-EXP-MONTH
           MOVE WS-CERT-NOT-AFTER(5:2)  TO WS-EXP-DAY
           MOVE WS-CURR-YEAR(3:2)       TO WS-CURR-YEAR-2D
           IF WS-EXP-YEAR-2D < WS-CURR-YEAR-2D
               SET WS-CERT-IS-EXPIRED TO TRUE
               MOVE 'CERTIFICATE EXPIRED (YEAR)'
                   TO WS-VALIDATION-MSG
               GO TO 3000-EXIT
           END-IF
           IF WS-EXP-YEAR-2D = WS-CURR-YEAR-2D
               IF WS-EXP-MONTH < WS-CURR-MONTH
                   SET WS-CERT-IS-EXPIRED TO TRUE
                   GO TO 3000-EXIT
               END-IF
               IF WS-EXP-MONTH = WS-CURR-MONTH
                   IF WS-EXP-DAY < WS-CURR-DAY
                       SET WS-CERT-IS-EXPIRED TO TRUE
                       GO TO 3000-EXIT
                   END-IF
               END-IF
           END-IF
           COMPUTE WS-YEAR-DIFF =
               WS-EXP-YEAR-2D - WS-CURR-YEAR-2D
           COMPUTE WS-MONTH-DIFF =
               WS-EXP-MONTH - WS-CURR-MONTH
           COMPUTE WS-TOTAL-DAYS-DIFF =
               (WS-YEAR-DIFF * 365.25) +
               (WS-MONTH-DIFF * 30.44) +
               (WS-EXP-DAY - WS-CURR-DAY)
           COMPUTE WS-DAYS-UNTIL-EXPIRY =
               WS-TOTAL-DAYS-DIFF
           IF WS-DAYS-UNTIL-EXPIRY < WS-EXPIRY-WARNING-DAYS
               DISPLAY 'TLSVAL-W020: EXPIRES IN '
                   WS-DAYS-UNTIL-EXPIRY ' DAYS'
           END-IF
           .
       3000-EXIT.
           EXIT.
       4000-VERIFY-SIGNATURE.
           IF WS-CERT-KEY-LENGTH < WS-MIN-KEY-LENGTH
               SET WS-SIG-INVALID TO TRUE
               GO TO 4000-EXIT
           END-IF
           MOVE 'N' TO WS-ALGO-FOUND
           PERFORM VARYING WS-ALGO-INDEX FROM 1 BY 1
               UNTIL WS-ALGO-INDEX > 4
               IF WS-CERT-SIG-ALGO =
                   WS-ALGO-ENTRY(WS-ALGO-INDEX)
                   MOVE 'Y' TO WS-ALGO-FOUND
               END-IF
           END-PERFORM
           IF WS-ALGO-FOUND = 'N'
               SET WS-SIG-INVALID TO TRUE
               GO TO 4000-EXIT
           END-IF
           SET WS-SIG-VALID TO TRUE
           .
       4000-EXIT.
           EXIT.
       5000-MATCH-HOSTNAME.
           INSPECT WS-SUBJECT-COMMON-NAME
               TALLYING WS-HOSTNAME-TALLY FOR ALL '*'
           IF WS-HOSTNAME-TALLY > 0
               PERFORM 5100-WILDCARD-MATCH
           ELSE
               IF WS-SUBJECT-COMMON-NAME =
                   WS-EXPECTED-HOSTNAME
                   SET WS-HOSTNAME-MATCHES TO TRUE
               ELSE
                   SET WS-HOSTNAME-NO-MATCH TO TRUE
                   MOVE 'HOSTNAME MISMATCH'
                       TO WS-VALIDATION-MSG
               END-IF
           END-IF
           INSPECT WS-EXPECTED-HOSTNAME
               TALLYING WS-DOT-COUNT FOR ALL '.'
           IF WS-DOT-COUNT < 1
               SET WS-HOSTNAME-NO-MATCH TO TRUE
               MOVE 'HOSTNAME NOT FQDN'
                   TO WS-VALIDATION-MSG
           END-IF
           .
       5100-WILDCARD-MATCH.
           INSPECT WS-SUBJECT-COMMON-NAME
               TALLYING WS-WILDCARD-POS
               FOR CHARACTERS BEFORE INITIAL '*'
           IF WS-WILDCARD-POS > 0
               SET WS-HOSTNAME-NO-MATCH TO TRUE
               MOVE 'WILDCARD NOT AT LABEL START'
                   TO WS-VALIDATION-MSG
           ELSE
               IF WS-EXPECTED-HOSTNAME(2:) =
                   WS-SUBJECT-COMMON-NAME(3:)
                   SET WS-HOSTNAME-MATCHES TO TRUE
               ELSE
                   SET WS-HOSTNAME-NO-MATCH TO TRUE
                   MOVE 'WILDCARD SUFFIX MISMATCH'
                       TO WS-VALIDATION-MSG
               END-IF
           END-IF
           .
       6000-CHECK-REVOCATION-STATUS.
           IF WS-CRL-NOT-LOADED
               SET WS-CERT-NOT-REVOKED TO TRUE
               GO TO 6000-EXIT
           END-IF
           SET WS-CERT-NOT-REVOKED TO TRUE
           PERFORM UNTIL WS-CRL-EOF
               READ CRL-FILE
                   AT END
                       SET WS-CRL-EOF TO TRUE
                   NOT AT END
                       IF CRL-REVOKED-SERIAL =
                           WS-CERT-SERIAL-NUM
                           IF WS-CRL-NOT-LOADED
                               SET WS-CERT-IS-REVOKED TO TRUE
                               MOVE 'CERTIFICATE ON CRL'
                                   TO WS-VALIDATION-MSG
                           END-IF
                       END-IF
               END-READ
           END-PERFORM
           .
       6000-EXIT.
           EXIT.
       7000-DETERMINE-FINAL-RESULT.
           IF WS-CHAIN-IS-INVALID OR WS-CERT-IS-EXPIRED
               OR WS-SIG-INVALID OR WS-HOSTNAME-NO-MATCH
               OR WS-CERT-IS-REVOKED
               SET WS-CERT-INVALID TO TRUE
               MOVE 8 TO WS-RETURN-CODE
           ELSE
               SET WS-CERT-VALID TO TRUE
               MOVE 0 TO WS-RETURN-CODE
               MOVE 'VALIDATION SUCCESSFUL'
                   TO WS-VALIDATION-MSG
           END-IF
           PERFORM 8000-WRITE-AUDIT-ENTRY
           .
       8000-WRITE-AUDIT-ENTRY.
           MOVE FUNCTION CURRENT-DATE TO WS-AUDIT-TIMESTAMP
           STRING WS-AUDIT-TIMESTAMP DELIMITED SIZE
               '|' DELIMITED SIZE
               WS-CERT-SERIAL-NUM DELIMITED SPACES
               '|' DELIMITED SIZE
               WS-VALIDATION-RESULT DELIMITED SIZE
               '|' DELIMITED SIZE
               WS-VALIDATION-MSG DELIMITED SPACES
               INTO AUDIT-LOG-RECORD
           END-STRING
           WRITE AUDIT-LOG-RECORD
           .
       9000-CLEANUP.
           IF WS-CERTSTORE-LOCK-HELD
               PERFORM 2120-CERTSTORE-DEQ
           END-IF
           CLOSE CERT-STORE-FILE
           CLOSE CRL-FILE
           CLOSE AUDIT-LOG-FILE
           DISPLAY 'TLSVAL-I099: RC=' WS-RETURN-CODE
           .
