       IDENTIFICATION DIVISION.
       PROGRAM-ID. PARSE-SUBJECT-DN.
       AUTHOR. MAINFRAME-SECURITY-TEAM.
      *================================================================
      * SUBJECT DN PARSER - SPLITS AN RFC 4514 SUBJECT DN INTO ITS
      * RDN COMPONENTS AND EXTRACTS THE COMMON NAME (CN).
      *
      * AN ESCAPED COMMA (\,) INSIDE AN RDN VALUE IS *NOT* A COMPONENT
      * DELIMITER. IT IS FOLDED TO A SENTINEL BYTE BEFORE THE UNSTRING
      * SPLIT AND RESTORED TO A LITERAL COMMA AFTERWARDS, SO THE DN
      *     CN=Smith\, John,OU=Legal,O=Acme Bank
      * YIELDS THE COMMON NAME "Smith, John" AND AN RDN COUNT OF 3.
      *
      * THE RDN TABLE IS CLEARED TO SPACES ON EVERY CALL SO STALE
      * VALUES FROM A PRIOR CERTIFICATE CANNOT LEAK INTO THE RESULT.
      *================================================================
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-DN-PREPPED              PIC X(256).
       01  WS-COMMA-SENTINEL          PIC X  VALUE X'01'.
       01  WS-CUR-CHAR                PIC X.
       01  WS-SRC-IDX                 PIC 9(4).
       01  WS-NEXT-IDX                PIC 9(4).
       01  WS-DST-IDX                 PIC 9(4).
       01  WS-IDX                     PIC 9(2).
       01  WS-RDN-TABLE.
           05  WS-RDN-ENTRY OCCURS 10 TIMES PIC X(64).
       LINKAGE SECTION.
       01  LK-SUBJECT-DN              PIC X(256).
       01  LK-PARSED-CN               PIC X(64).
       01  LK-RDN-COUNT               PIC 9(2).
       PROCEDURE DIVISION USING LK-SUBJECT-DN LK-PARSED-CN
                                LK-RDN-COUNT.
       0000-PARSE-CONTROL.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROTECT-ESCAPED-COMMAS
           PERFORM 3000-SPLIT-RDNS
           PERFORM 4000-EXTRACT-CN
           GOBACK
           .
       1000-INITIALIZE.
           MOVE SPACES TO WS-RDN-TABLE
           MOVE SPACES TO WS-DN-PREPPED
           MOVE SPACES TO LK-PARSED-CN
           MOVE 0 TO LK-RDN-COUNT
           .
       2000-PROTECT-ESCAPED-COMMAS.
           MOVE 1 TO WS-SRC-IDX
           MOVE 1 TO WS-DST-IDX
           PERFORM UNTIL WS-SRC-IDX > 256
               MOVE LK-SUBJECT-DN(WS-SRC-IDX:1) TO WS-CUR-CHAR
               IF WS-CUR-CHAR = '\' AND WS-SRC-IDX < 256
                   COMPUTE WS-NEXT-IDX = WS-SRC-IDX + 1
                   IF LK-SUBJECT-DN(WS-NEXT-IDX:1) = ','
                       MOVE WS-COMMA-SENTINEL
                           TO WS-DN-PREPPED(WS-DST-IDX:1)
                       ADD 2 TO WS-SRC-IDX
                   ELSE
                       MOVE WS-CUR-CHAR
                           TO WS-DN-PREPPED(WS-DST-IDX:1)
                       ADD 1 TO WS-SRC-IDX
                   END-IF
               ELSE
                   MOVE WS-CUR-CHAR TO WS-DN-PREPPED(WS-DST-IDX:1)
                   ADD 1 TO WS-SRC-IDX
               END-IF
               ADD 1 TO WS-DST-IDX
           END-PERFORM
           .
       3000-SPLIT-RDNS.
           UNSTRING WS-DN-PREPPED DELIMITED BY ','
               INTO WS-RDN-ENTRY(1) WS-RDN-ENTRY(2)
                    WS-RDN-ENTRY(3) WS-RDN-ENTRY(4)
                    WS-RDN-ENTRY(5) WS-RDN-ENTRY(6)
                    WS-RDN-ENTRY(7) WS-RDN-ENTRY(8)
                    WS-RDN-ENTRY(9) WS-RDN-ENTRY(10)
               TALLYING IN LK-RDN-COUNT
           END-UNSTRING
           .
       4000-EXTRACT-CN.
           PERFORM VARYING WS-IDX FROM 1 BY 1
               UNTIL WS-IDX > LK-RDN-COUNT OR WS-IDX > 10
               INSPECT WS-RDN-ENTRY(WS-IDX)
                   REPLACING ALL WS-COMMA-SENTINEL BY ','
               IF WS-RDN-ENTRY(WS-IDX)(1:3) = 'CN='
                   MOVE WS-RDN-ENTRY(WS-IDX)(4:) TO LK-PARSED-CN
               END-IF
           END-PERFORM
           .
