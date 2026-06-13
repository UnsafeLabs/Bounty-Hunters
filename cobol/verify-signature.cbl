      * [ShanaBoo] Fix EBCDIC-to-ASCII conversion for fingerprint
       IDENTIFICATION DIVISION.
       PROGRAM-ID. VERIFY-SIGNATURE.
       
      * Working storage for signature verification
       01  WS-SIG-VERIFY-DATA.
           05  WS-SIG-VERIFY-LENGTH    PIC 9(4) COMP.
           05  WS-SIG-VERIFY-BUFFER    PIC X(64) USAGE DISPLAY
                                       NATIVE.
           05  WS-SIG-VERIFY-RESULT    PIC 9 COMP.
               88  WS-SIG-VALID      VALUE 0.
               88  WS-SIG-INVALID    VALUE 1.
           PERFORM VARYING WS-IDX FROM 1 BY 1
              UNTIL WS-IDX > WS-CERT-FINGERPRINT-LEN
               MOVE WS-CERT-FINGERPRINT(WS-IDX:1)
                  TO WS-SIG-VERIFY-BUFFER(WS-IDX:1)
           END-PERFORM
           
      *    Compare fingerprints
           MOVE ZERO TO WS-SIG-VERIFY-RESULT
           PERFORM VARYING WS-IDX FROM 1 BY 1
              UNTIL WS-IDX > WS-CERT-FINGERPRINT-LEN
               IF FUNCTION ORD(WS-SIG-VERIFY-BUFFER(WS-IDX:1))
                  NOT EQUAL FUNCTION ORD(CS-CERT-FINGERPRINT(WS-IDX:1))
                   MOVE 1 TO WS-SIG-VERIFY-RESULT
               END-IF
           END-PERFORM
           
           IF WS-SIG-VERIFY-RESULT = 0
               SET WS-SIG-VALID TO TRUE
               DISPLAY "Fingerprint verified: "
                   WS-SIG-VERIFY-BUFFER
           ELSE
               SET WS-SIG-INVALID TO TRUE