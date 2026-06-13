 ```diff
--- a/cobol/3500-PARSE-SUBJECT-DN.cob
+++ b/cobol/3500-PARSE-SUBJECT-DN.cob
@@ -280,6 +280,12 @@
        01  WS-RDN-INDEX              PIC 9(3) COMP.
        01  WS-RDN-PTR                PIC 9(4) COMP.
        01  WS-TEMP-CN                PIC X(256).
+       01  WS-ESCAPED-COMMA-IDX      PIC 9(4) COMP.
+       01  WS-PLACEHOLDER-CHAR       PIC X(1) VALUE X'01'.
+       01  WS-SUBJECT-CN-WORK        PIC X(256).
+       01  WS-CN-PARSE-PTR           PIC 9(4) COMP.
+       01  WS-CN-PARSE-LEN           PIC 9(4) COMP.
+       01  WS-TEMP-CHAR              PIC X(1).
 
       *----------------------------------------------------------------*
       * 3500-PARSE-SUBJECT-DN                                          *
@@ -287,6 +293,9 @@
       *----------------------------------------------------------------*
        3500-PARSE-SUBJECT-DN SECTION.
 
+      *    Initialize RDN table to prevent stale data leaks
+           PERFORM 3510-INITIALIZE-RDN-TABLE
+
       *    Extract Common Name from Subject DN
            MOVE SPACES TO WS-PARSED-CN
            MOVE SPACES TO WS-TEMP-CN
@@ -295,8 +304,11 @@
       *    Find CN= in the subject DN
            PERFORM 3520-FIND-COMMON-NAME
 
-      *    Parse RDN components using UNSTRING
-           UNSTRING WS-SUBJECT-COMMON-NAME DELIMITED BY ','
+      *    Pre-process DN to handle escaped commas
+           PERFORM 3530-PREPROCESS-ESCAPED-COMMAS
+
+      *    Parse RDN components using UNSTRING on processed DN
+           MOVE 0 TO WS-RDN-COUNT
+           UNSTRING WS-SUBJECT-CN-WORK DELIMITED BY ','
                INTO WS-RDN-TABLE(1)
                     WS-RDN-TABLE(2)
                     WS-RDN-TABLE(3)
@@ -310,6 +322,9 @@
                     WS-RDN-TABLE(11)
                     WS-RDN-TABLE(12)
                TALLYING IN WS-RDN-COUNT
+
+      *    Post-process RDN table to restore commas in place of placeholders
+           PERFORM 3540-RESTORE-ESCAPED-COMMAS
            END-UNSTRING
 
       *    Find and extract the CN value from RDN table
@@ -318,6 +333,20 @@
            GOBACK
            .
 
+      *----------------------------------------------------------------*
+      * 3510-INITIALIZE-RDN-TABLE                                      *
+      * Initialize RDN table with SPACES to prevent stale data         *
+      *----------------------------------------------------------------*
+       3510-INITIALIZE-RDN-TABLE SECTION.
+           MOVE SPACES TO WS-RDN-TABLE(1)  WS-RDN-TABLE(2)
+                    WS-RDN-TABLE(3)  WS-RDN-TABLE(4)
+                    WS-RDN-TABLE(5)  WS-RDN-TABLE(6)
+                    WS-RDN-TABLE(7)  WS-RDN-TABLE(8)
+                    WS-RDN-TABLE(9)  WS-RDN-TABLE(10)
+                    WS-RDN-TABLE(11) WS-RDN-TABLE(12)
+           MOVE 0 TO WS-RDN-COUNT
+           EXIT
+           .
+
       *----------------------------------------------------------------*
       * 3520-FIND-COMMON-NAME                                          *
       * Locate CN= value in subject DN                                 *
@@ -340,6 +369,66 @@
            EXIT
            .
 
+      *----------------------------------------------------------------*
+      * 3530-PREPROCESS-ESCAPED-COMMAS                                   *
+      * Replace escaped commas with placeholder to protect during split*
+      *----------------------------------------------------------------*
+       3530-PREPROCESS-ESCAPED-COMMAS SECTION.
+           MOVE SPACES TO WS-SUBJECT-CN-WORK
+           MOVE 1 TO WS-CN-PARSE-PTR
+           MOVE 1 TO WS-ESCAPED-COMMA-IDX
+           COMPUTE WS-CN-PARSE-LEN = FUNCTION LENGTH(
+               FUNCTION TRIM(WS-SUBJECT-COMMON-NAME))
+
+           PERFORM VARYING WS-CN-PARSE-PTR FROM 1 BY 1
+                   UNTIL WS-CN-PARSE-PTR > WS-CN-PARSE-LEN
+               MOVE WS-SUBJECT-COMMON-NAME(WS-CN-PARSE-PTR:1)
+                   TO WS-TEMP-CHAR
+               IF WS-TEMP-CHAR = '\'
+                  AND WS-CN-PARSE-PTR < WS-CN-PARSE-LEN
+                  AND WS-SUBJECT-COMMON-NAME(WS-CN-PARSE-PTR + 1:1)
+                      = ','
+                   MOVE WS-PLACEHOLDER-CHAR
+                       TO WS-SUBJECT-CN-WORK(WS-ESCAPED-COMMA-IDX:1)
+                   ADD 1 TO WS-CN-PARSE-PTR
+               ELSE
+                   MOVE WS-TEMP-CHAR
+                       TO WS-SUBJECT-CN-WORK(WS-ESCAPED-COMMA-IDX:1)
+               END-IF
+               ADD 1 TO WS-ESCAPED-COMMA-IDX
+           END-PERFORM
+           EXIT
+           .
+
+      *----------------------------------------------------------------*
+      * 3540-RESTORE-ESCAPED-COMMAS                                    *
+      * Restore escaped commas in RDN table from placeholders          *
+      *----------------------------------------------------------------*
+       3540-RESTORE-ESCAPED-COMMAS SECTION.
+           PERFORM VARYING WS-RDN-INDEX FROM 1 BY 1
+                   UNTIL WS-RDN-INDEX > WS-RDN-COUNT
+               MOVE 1 TO WS-CN-PARSE-PTR
+               COMPUTE WS-CN-PARSE-LEN = FUNCTION LENGTH(
+                   FUNCTION TRIM(WS-RDN-TABLE(WS-RDN-INDEX)))
+               PERFORM UNTILNumbers  WS-CN-PARSE-PTR > WS-CN-PARSE-LEN
+                   IF WS-RDN-TABLE(WS-RDN-INDEX)(WS-CN-PARSE-PTR:1)
+                       = WS-PLACEHOLDER-CHAR
+                       MOVE ',' TO WS-RDN-TABLE(WS-RDN-INDEX)
+                           (WS-CN-PARSE-PTR:1)
+                   END-IF
+                   ADD 1 TO WS-CN-PARSE-PTR
+               END-PERFORM
+           END-PERFORM
+           EXIT
+           .
+
       *----------------------------------------------------------------*
       * 3550-EXTRACT-CN-FROM-RDNS                                      *
       *