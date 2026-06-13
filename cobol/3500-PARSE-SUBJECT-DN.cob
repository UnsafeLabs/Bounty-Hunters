      ******************************************************************
      * 3500-PARSE-SUBJECT-DN - Parse certificate Subject DN
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PARSE-SUBJECT-DN.
           05  WS-RDN-TABLE.
               10  WS-RDN-ENTRY OCCURS 20 TIMES.
                   15  WS-RDN-VALUE    PIC X(256).
           05  WS-ESCAPED-COMMA-PLACEHOLDER PIC X(1) VALUE X'01'.
           05  WS-PROCESSED-DN     PIC X(2048).
           05  WS-IDX              PIC 9(4) COMP.
           05  WS-IDX2             PIC 9(4) COMP.

       LINKAGE SECTION.
       01  LK-SUBJECT-DN       PIC X(2048).
       PROCEDURE DIVISION USING LK-SUBJECT-DN
                                LK-PARSED-CN
                                LK-RDN-COUNT.
           PERFORM 3510-INITIALIZE-TABLE
           PERFORM 3500-PARSE-DN
           GOBACK.

      * 3500-PARSE-DN
      ******************************************************************
       3500-PARSE-DN.
           PERFORM 3505-REPLACE-ESCAPED-COMMAS
           
           UNSTRING WS-PROCESSED-DN DELIMITED BY ','
               INTO WS-RDN-ENTRY (1) THRU WS-RDN-ENTRY (20)
               TALLYING IN WS-RDN-COUNT
           END-UNSTRING
           
           PERFORM 3510-EXTRACT-CN
           PERFORM 3520-RESTORE-ESCAPED-COMMAS
           .

      ******************************************************************
      * 3505-REPLACE-ESCAPED-COMMAS
      ******************************************************************
       3505-REPLACE-ESCAPED-COMMAS.
           MOVE SPACES TO WS-PROCESSED-DN
           MOVE 1 TO WS-IDX
           MOVE 1 TO WS-IDX2
           
           PERFORM UNTIL WS-IDX > LENGTH OF LK-SUBJECT-DN
                      OR LK-SUBJECT-DN (WS-IDX:1) = SPACES
               IF WS-IDX < LENGTH OF LK-SUBJECT-DN
                  AND LK-SUBJECT-DN (WS-IDX:1) = '\'
                  AND LK-SUBJECT-DN (WS-IDX + 1:1) = ','
                   MOVE WS-ESCAPED-COMMA-PLACEHOLDER 
                       TO WS-PROCESSED-DN (WS-IDX2:1)
                   ADD 2 TO WS-IDX
                   ADD 1 TO WS-IDX2
               ELSE
                   MOVE LK-SUBJECT-DN (WS-IDX:1) 
                       TO WS-PROCESSED-DN (WS-IDX2:1)
                   ADD 1 TO WS-IDX
                   ADD 1 TO WS-IDX2
               END-IF
           END-PERFORM
           .

      ******************************************************************
      ******************************************************************
       3510-EXTRACT-CN.
           PERFORM VARYING WS-RDN-IDX FROM 1 BY 1
                   UNTIL WS-RDN-IDX > WS-RDN-COUNT
               IF WS-RDN-ENTRY (WS-RDN-IDX) (1:3) = 'CN='
                   OR WS-RDN-ENTRY (WS-RDN-IDX) (1:3) = 'cn='
                   MOVE WS-RDN-ENTRY (WS-RDN-IDX) (4:) 
                   EXIT PERFORM
               END-IF
           END-PERFORM
           .

      ******************************************************************
      * 3510-INITIALIZE-TABLE
      ******************************************************************
       3510-INITIALIZE-TABLE.
           MOVE SPACES TO WS-RDN-TABLE
           MOVE ZERO TO WS-RDN-COUNT
           .

      ******************************************************************
      * 3520-RESTORE-ESCAPED-COMMAS
      ******************************************************************
       3520-RESTORE-ESCAPED-COMMAS.
           PERFORM VARYING WS-RDN-IDX FROM 1 BY 1
                   UNTIL WS-RDN-IDX > WS-RDN-COUNT
               MOVE 1 TO WS-IDX
               PERFORM UNTIL WS-IDX > LENGTH OF WS-RDN-ENTRY (WS-RDN-IDX)
                   IF WS-RDN-ENTRY (WS-RDN-IDX) (WS-IDX:1) = 
                      WS-ESCAPED-COMMA-PLACEHOLDER
                       MOVE ',' 
                           TO WS-RDN-ENTRY (WS-RDN-IDX) (WS-IDX:1)
                   END-IF
                   ADD 1 TO WS-IDX
               END-PERFORM
           END-PERFORM
           
      *    Also restore in parsed CN
           MOVE 1 TO WS-IDX
           PERFORM UNTIL WS-IDX > LENGTH OF LK-PARSED-CN
               IF LK-PARSED-CN (WS-IDX:1) = WS-ESCAPED-COMMA-PLACEHOLDER
                   MOVE ',' TO LK-PARSED-CN (WS-IDX:1)
               END-IF
               ADD 1 TO WS-IDX
           END-PERFORM
           .