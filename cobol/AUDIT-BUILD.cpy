      *================================================================
      * AUDIT-BUILD - shared audit-record construction (issue #519)
      *
      * Single source of truth for the pipe-delimited audit record,
      * COPYed by TLS-CERT-VALIDATOR (8000-WRITE-AUDIT-ENTRY) and by the
      * unit test TLS-CERT-VALIDATOR-AUDIT-TEST. The real fix for #519:
      * that the Issuer and Subject DN are emitted here - they were
      * absent from the original record. WITH POINTER + ON OVERFLOW make
      * an over-length DN flag truncation instead of being dropped
      * silently by standard STRING.
      *
      * Requires these data items in the including program: WS-AUDIT-
      * RECORD, WS-AUDIT-PTR, WS-AUDIT-MAX-LEN, WS-TRUNCATION-MARKER,
      * WS-AUDIT-TRUNC-FLAG (88 WS-AUDIT-IS-TRUNCATED / -NOT-TRUNCATED),
      * and the source fields WS-AUDIT-TIMESTAMP, WS-CERT-SERIAL-NUM,
      * WS-ISSUER-COMMON-NAME, WS-SUBJECT-COMMON-NAME,
      * WS-VALIDATION-RESULT, WS-VALIDATION-MSG.
      *================================================================
           MOVE SPACES TO WS-AUDIT-RECORD
           MOVE 1 TO WS-AUDIT-PTR
           SET WS-AUDIT-NOT-TRUNCATED TO TRUE
           STRING WS-AUDIT-TIMESTAMP DELIMITED SIZE
               '|' DELIMITED SIZE
               WS-CERT-SERIAL-NUM DELIMITED SPACES
               '|' DELIMITED SIZE
               WS-ISSUER-COMMON-NAME DELIMITED SPACES
               '|' DELIMITED SIZE
               WS-SUBJECT-COMMON-NAME DELIMITED SPACES
               '|' DELIMITED SIZE
               WS-VALIDATION-RESULT DELIMITED SIZE
               '|' DELIMITED SIZE
               WS-VALIDATION-MSG DELIMITED SPACES
               INTO WS-AUDIT-RECORD
               WITH POINTER WS-AUDIT-PTR
               ON OVERFLOW
                   SET WS-AUDIT-IS-TRUNCATED TO TRUE
           END-STRING
           IF WS-AUDIT-IS-TRUNCATED
               MOVE WS-TRUNCATION-MARKER
                   TO WS-AUDIT-RECORD(WS-AUDIT-MAX-LEN - 10:11)
           END-IF
