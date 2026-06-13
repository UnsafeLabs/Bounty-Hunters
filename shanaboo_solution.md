 ```diff
--- a/cobol/3500-PARSE-SUBJECT-DN.cob
+++ b/cobol/3500-PARSE-SUBJECT-DN.cob
@@ -1,3 +1,4 @@
+      *================================================================*
       * 3500-PARSE-SUBJECT-DN
       * Parse certificate Subject DN into RDN components and extract
       * the Common Name for hostname matching.
@@ -5,6 +6,8 @@
       *================================================================*
        IDENTIFICATION DIVISION.
        PROGRAM-ID. PARSE-SUBJECT-DN.
+      *================================================================*
+      *================================================================*
        ENVIRONMENT DIVISION.
        DATA DIVISION.
        WORKING-STORAGE SECTION.
@@ -12,6 +15,10 @@
        01  WS-SUBJECT-DN           PIC X(256).
        01  WS-SUBJECT-DN-LEN       PIC 9(3) COMP.
        01  WS-SUBJECT-COMMON-NAME  PIC X(256).
+      * Working copy for pre-processing escaped commas
+       01  WS-DN-WORK              PIC X(256).
+       01  WS-DN-WORK-LEN          PIC 9(3) COMP.
+       01  WS-ESCAPE-IDX           PIC 9(3) COMP.
       * Parsed RDN table
        01  WS-RDN-TABLE.
            05  WS-RDN-ENTRY OCCURS 20 TIMES.
@@ -20,6 +27,7 @@
        01  WS-RDN-COUNT            PIC 9(2) COMP.
        01  WS-RDN-IDX              PIC 9(2) COMP.
        01  WS-TEMP-CN              PIC X(64).
+       01  WS-TEMP-CHAR            PIC X(1).
       * Delimiters and pointers
        01  WS-DELIMITER            PIC X(1) VALUE ','.
        01  WS-POINTER              PIC 9(3) COMP.
@@ -27,6 +35,10 @@
        01  WS-EQUALS-POS           PIC 9(3) COMP.
        01  WS-RDN-NAME             PIC X(10).
        01  WS-RDN-VALUE            PIC X(100).
+      * Placeholder for escaped comma (using a character unlikely in DN)
+       01  WS-PLACEHOLDER          PIC X(2) VALUE X'1F1F'.
+       01  WS-RESTORE-IDX          PIC 9(3) COMP.
+       01  WS-RESTORE-COUNT        PIC 9(3) COMP.
       *================================================================*
        LINKAGE SECTION.
        01  LK-SUBJECT-DN           PIC X(256).
@@ -37,6 +49,7 @@
            05  LK-RDN-VALUE        PIC X(100).
        01  LK-RDN-COUNT            PIC 9(2) COMP.
        01  LK-PARSED-CN            PIC X(64).
+      *================================================================*
        PROCEDURE DIVISION USING LK-SUBJECT-DN
                                 LK-RDN-TABLE
                                  LK-RDN-COUNT
@@ -44,6 +57,10 @@
       *================================================================*
       * MAIN-LOGIC
       *================================================================*
+      * Initialize RDN table to prevent stale data from previous cert
+           PERFORM 1000-INITIALIZE-RDN-TABLE
+      *    Pre-process DN to handle escaped commas
+           PERFORM 2000-PREPROCESS-ESCAPED-COMMAS
       *    Copy input and determine length
            MOVE LK-SUBJECT-DN TO WS-SUBJECT-DN
            COMPUTE WS-SUBJECT-DN-LEN =
@@ -51,7 +68,7 @@
       *    Extract Common Name field
            PERFORM 3000-EXTRACT-COMMON-NAME
       *    Split DN into RDN components using UNSTRING
-           PERFORM 3500-UNSTRING-RDNS
+           PERFORM 3500-UNSTRING-RDNS.
       *    Return parsed CN
            MOVE WS-TEMP-CN TO LK-PARSED-CN
            .
@@ -59,6 +76,34 @@
       *================================================================*
       * 1000-INITIALIZE-RDN-TABLE
       *================================================================*
+           INITIALIZE WS-RDN-TABLE
+           MOVE ZERO TO WS-RDN-COUNT
+           .
+      *================================================================*
+      * 2000-PREPROCESS-ESCAPED-COMMAS
+      * Replace escaped commas with placeholder before UNSTRING
+      *================================================================*
+           MOVE WS-SUBJECT-DN TO WS-DN-WORK
+           MOVE WS-SUBJECT-DN-LEN TO WS-DN-WORK-LEN
+           MOVE 1 TO WS-ESCAPE-IDX
+           PERFORM UNTIL WS-ESCAPE-IDX > WS-DN-WORK-LEN
+               IF WS-DN-WORK(WS-ESCAPE-IDX:1) = '\'
+                  AND WS-ESCAPE-IDX < WS-DN-WORK-LEN
+                  AND WS-DN-WORK(WS-ESCAPE-IDX + 1:1) = ','
+      *            Replace \, with placeholder (keep backslash for now)
+                   MOVE WS-PLACEHOLDER TO
+                       WS-DN-WORK(WS-ESCAPE-IDX:2)
+                   ADD 1 TO WS-ESCAPE-IDX
+               END-IF
+               ADD 1 TO WS-ESCAPE-IDX
+           END-PERFORM
+      *    Update working DN with pre-processed version
+           MOVE WS-DN-WORK TO WS-SUBJECT-DN
+           COMPUTE WS-SUBJECT-DN-LEN =
+               FUNCTION LENGTH(FUNCTION TR Diamond WS-DN-WORK)
+           .
+      *================================================================*
+      * 3000-EXTRACT-COMMON-NAME
+      *================================================================*
+           .
+      *================================================================*
+      * 3500-UNSTRING-RDNS
+      *================================================================*
+           .
+      *================================================================*
+      * 4000-PARSE-RDN-ENTRY
+      *================================================================*
+           .
+      *================================================================*
+      * 5000-RESTORE-ESCAPED-COMMAS
+      * Restore placeholder to actual comma in parsed values
+      *================================================================*
+           .
+      *================================================================*
+      * 6000-POSTPROCESS-RDN-VALUES
+      *================================================================*
+           .
+       1000-INITIALIZE-RDN-TABLE.
+           INITIALIZE WS-RDN-TABLE
+           MOVE ZERO TO WS-RDN-COUNT
+           .
+      *================================================================*
+      * 2000-PREPROCESS-ESCAPED-COMMAS
+      * Replace escaped commas with placeholder before UNSTRING
+      *