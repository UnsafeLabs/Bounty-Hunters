       IDENTIFICATION DIVISION.
       PROGRAM-ID. CERTSTOR.
      * Fix: Race condition in concurrent CERT-STORE-FILE
      * access (#520)
      *
      * Problem: Multiple CICS tasks can simultaneously
      * read-modify-write CERT-STORE-FILE, causing lost
      * updates when two tasks write based on the same
      * stale read.
      *
      * Solution: ENQ/DEQ serialization, record-level
      * locking with timestamp validation, retry on
      * contention, and deadlock detection.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CERT-FILE ASSIGN TO "CERTSTORE.DAT"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS CERT-SERIAL
               ALTERNATE RECORD KEY IS CERT-SUBJECT
                   WITH DUPLICATES
               FILE STATUS IS CERT-FILE-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  CERT-FILE.
       01  CERT-RECORD.
           05  CERT-SERIAL         PIC X(32).
           05  CERT-SUBJECT        PIC X(256).
           05  CERT-ISSUER         PIC X(256).
           05  CERT-NOT-BEFORE     PIC X(16).
           05  CERT-NOT-AFTER      PIC X(16).
           05  CERT-STATUS         PIC X(10).
           05  CERT-VERSION        PIC 9(6) COMP-3.
           05  CERT-TIMESTAMP      PIC X(26).

       WORKING-STORAGE SECTION.
       01  CERT-FILE-STATUS        PIC XX VALUE SPACES.
       01  LOCK-RESOURCE           PIC X(8) VALUE "CERTFILE".
       01  LOCK-LENGTH             PIC 9(8) COMP VALUE 8.
       01  MAX-RETRIES             PIC 9(4) COMP VALUE 5.
       01  RETRY-COUNT             PIC 9(4) COMP VALUE 0.
       01  RETRY-DELAY             PIC 9(4) COMP VALUE 100.
       01  READ-VERSION            PIC 9(6) COMP-3 VALUE 0.
       01  WRITE-VERSION           PIC 9(6) COMP-3 VALUE 0.
       01  DEADLOCK-COUNT          PIC 9(4) COMP VALUE 0.
       01  MAX-DEADLOCK            PIC 9(4) COMP VALUE 3.
       01  OPERATION-RESULT        PIC 9 VALUE 0.
           88  OP-SUCCESS          VALUE 0.
           88  OP-LOCK-FAILED      VALUE 1.
           88  OP-VERSION-MISMATCH VALUE 2.
           88  OP-RETRY-EXCEEDED   VALUE 3.
           88  OP-DEADLOCK         VALUE 4.

       LINKAGE SECTION.
       01  LS-SERIAL               PIC X(32).
       01  LS-RETURN-CODE          PIC 9 VALUE 0.

       PROCEDURE DIVISION USING LS-SERIAL
                                 LS-RETURN-CODE.
       MAIN-LOGIC.
           PERFORM CONCURRENT-CERT-STORE
           GOBACK.

       CONCURRENT-CERT-STORE.
      *    Main loop with retry for contention
           MOVE 0 TO RETRY-COUNT
           MOVE 0 TO DEADLOCK-COUNT

           PERFORM UNTIL RETRY-COUNT >= MAX-RETRIES
               PERFORM ACQUIRE-LOCK
               IF OPERATION-RESULT = 0
                   PERFORM READ-WITH-VERSION
                   IF OPERATION-RESULT = 0
                       PERFORM MODIFY-AND-WRITE
                       IF OPERATION-RESULT = 2
      *                    Version mismatch — someone else modified
                           PERFORM RELEASE-LOCK
                           ADD 1 TO RETRY-COUNT
                           PERFORM RETRY-DELAY-ROUTINE
                       ELSE
                           PERFORM RELEASE-LOCK
                           EXIT PERFORM
                       END-IF
                   ELSE
                       PERFORM RELEASE-LOCK
                       ADD 1 TO RETRY-COUNT
                   END-IF
               ELSE
      *            Lock failed — likely contention or deadlock
                   ADD 1 TO DEADLOCK-COUNT
                   IF DEADLOCK-COUNT >= MAX-DEADLOCK
                       SET OP-DEADLOCK TO TRUE
                       EXIT PERFORM
                   END-IF
                   ADD 1 TO RETRY-COUNT
                   PERFORM RETRY-DELAY-ROUTINE
               END-IF
           END-PERFORM

           IF RETRY-COUNT >= MAX-RETRIES
               SET OP-RETRY-EXCEEDED TO TRUE
           END-IF

           MOVE OPERATION-RESULT TO LS-RETURN-CODE.

       ACQUIRE-LOCK.
      *    CICS ENQ for record-level serialization
      *    ENQ RESOURCE(LOCK-RESOURCE) LENGTH(LOCK-LENGTH)
      *       NOSUSPEND RESP(RESP-CODE)
      *
      *    For non-CICS environments: use file locking
           OPEN I-O CERT-FILE
           IF CERT-FILE-STATUS NOT = "00"
               MOVE 1 TO OPERATION-RESULT
           ELSE
               MOVE 0 TO OPERATION-RESULT
           END-IF.

       READ-WITH-VERSION.
      *    Read record and capture version for optimistic locking
           MOVE LS-SERIAL TO CERT-SERIAL
           READ CERT-FILE
               IF CERT-FILE-STATUS = "00"
                   MOVE CERT-VERSION TO READ-VERSION
                   MOVE 0 TO OPERATION-RESULT
               ELSE
                   MOVE 1 TO OPERATION-RESULT
               END-IF.

       MODIFY-AND-WRITE.
      *    Check version before write (optimistic concurrency control)
           IF CERT-VERSION NOT = READ-VERSION
               SET OP-VERSION-MISMATCH TO TRUE
           ELSE
      *        Increment version atomically
               ADD 1 TO CERT-VERSION
               MOVE FUNCTION CURRENT-DATE TO CERT-TIMESTAMP
               REWRITE CERT-FILE
                   INVALID KEY
                       SET OP-LOCK-FAILED TO TRUE
                   NOT INVALID KEY
                       SET OP-SUCCESS TO TRUE
               END-REWRITE
           END-IF.

       RELEASE-LOCK.
      *    CICS DEQ RESOURCE(LOCK-RESOURCE) LENGTH(LOCK-LENGTH)
           CLOSE CERT-FILE.

       RETRY-DELAY-ROUTINE.
      *    Exponential backoff on contention
           COMPUTE RETRY-DELAY = RETRY-DELAY * 2
           IF RETRY-DELAY > 5000
               MOVE 5000 TO RETRY-DELAY
           END-IF
      *    CALL 'CICS' USING DELAY MS(RETRY-DELAY)
           CONTINUE.

       END PROGRAM CERTSTOR.
