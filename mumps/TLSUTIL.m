TLSUTIL ; TLS utility hardened against naked reference cascades
 ;
 ; All writes use fully-qualified ^GLBTLS or ^XTMP references. This
 ; routine intentionally avoids naked global syntax after SET/KILL/DO
 ; boundaries because extrinsics and post-conditionals can move the
 ; naked reference unexpectedly.
 ;
CERT(SESSID,CERTID) ;
 N IDX,RAWCERT,HASHVAL,CHAINOK,EXPVAL
 S RAWCERT=$G(^GLBTLS(SESSID,"cert",CERTID,"raw"))
 Q:RAWCERT=""
 S ^GLBTLS(SESSID,"meta","lastcheck")=$H
 S IDX=""
 F  S IDX=$O(^GLBTLS(SESSID,"chain",IDX)) Q:IDX=""  D
 . I '$D(^GLBTLS(SESSID,"chain",IDX))#2 Q
 . S CHAINOK=$D(^GLBTLS(SESSID,"chain",IDX))
 . I CHAINOK D VERIFYONE(SESSID,IDX)
 . I 'CHAINOK S ^GLBTLS(SESSID,"chain",IDX,"skipped")=$H
 . S EXPVAL=$$FMTEXP($G(^GLBTLS(SESSID,"chain",IDX,"notBefore")))
 . S ^GLBTLS(SESSID,"chain",IDX,"expire")=EXPVAL
 S HASHVAL=$$HASH^TLSCERT(RAWCERT,SESSID,CERTID)
 S ^GLBTLS(SESSID,"cert",CERTID,"hash")=HASHVAL
 S ^GLBTLS(SESSID,"cert",CERTID,"ts")=$H
 Q
 ;
VERIFY(SESSID) ;
 N IDX,RAWCERT
 S IDX=""
 F  S IDX=$O(^GLBTLS(SESSID,"chain",IDX)) Q:IDX=""  D
 . I '$D(^GLBTLS(SESSID,"chain",IDX,"raw"))#2 Q
 . S RAWCERT=$G(^GLBTLS(SESSID,"chain",IDX,"raw"))
 . I '$$VERIFYSIG^TLSCHAIN(RAWCERT) D  Q
 . . S ^GLBTLS(SESSID,"chain",IDX,"status")="I"
 . S ^GLBTLS(SESSID,"chain",IDX,"status")="V"
 . K ^GLBTLS(SESSID,"chain",IDX,"raw")
 . S ^GLBTLS(SESSID,"chain",IDX,"verified")=$H
 Q
 ;
VERIFYONE(SESSID,IDX) ;
 N RAWCERT
 I '$D(^GLBTLS(SESSID,"chain",IDX,"raw"))#2 Q
 S RAWCERT=$G(^GLBTLS(SESSID,"chain",IDX,"raw"))
 I RAWCERT="" Q
 D VERIFY^TLSCHAIN(IDX)
 S ^GLBTLS(SESSID,"chain",IDX,"status")="V"
 Q
 ;
HASH(RAWCERT,SESSID,CERTID) ;
 N JOBID,SEQNO,HASH,DUMMY
 S JOBID=$J
 S SEQNO=$G(^XTMP("TLSHASH",JOBID,"seqno"),0)+1
 S ^XTMP("TLSHASH",JOBID,"seqno")=SEQNO
 S HASH=$$COMPHASH^TLSHASH(RAWCERT)
 S ^XTMP("TLSHASH",JOBID,SEQNO)=HASH
 S ^XTMP("TLSHASH",JOBID,SEQNO,"ts")=$H
 S DUMMY=$G(^GLBTLS(SESSID,"cert",CERTID))
 Q HASH
 ;
CLEANUP ;
 N JOBID,SEQNO,TS,CUTOFF
 S CUTOFF=$$HTADD($H,-1)
 S JOBID=""
 F  S JOBID=$O(^XTMP("TLSHASH",JOBID)) Q:JOBID=""  D
 . S TS=$G(^XTMP("TLSHASH",JOBID,"ts"))
 . I TS'="",TS<CUTOFF K ^XTMP("TLSHASH",JOBID) Q
 . S SEQNO=""
 . F  S SEQNO=$O(^XTMP("TLSHASH",JOBID,SEQNO)) Q:SEQNO=""  D
 . . I SEQNO="seqno" Q
 . . S TS=$G(^XTMP("TLSHASH",JOBID,SEQNO,"ts"))
 . . I TS=""!(TS<CUTOFF) K ^XTMP("TLSHASH",JOBID,SEQNO)
 Q
 ;
FMTEXP(NOTBEFORE) ;
 Q $S(NOTBEFORE'="":NOTBEFORE+365,1:"")
 ;
HTADD(HDATE,DAYS) ;
 Q HDATE+DAYS
 ;
TSTTLSUT(RESULT) ;
 N SESSID,CERTID,IDX
 S RESULT=0
 S SESSID="T562",CERTID="C1"
 K ^GLBTLS(SESSID),^XTMP("TLSHASH",$J)
 S ^GLBTLS(SESSID,"cert",CERTID,"raw")="CERT"
 S ^GLBTLS(SESSID,"meta","lastcheck")=$H
 D CERT(SESSID,CERTID)
 I $D(^GLBTLS(SESSID,"meta","lastcheck","expire")) S RESULT=RESULT+1
 I '$D(^GLBTLS(SESSID,"cert",CERTID,"ts"))#2 S RESULT=RESULT+2
 ;
 S IDX=1
 S ^GLBTLS(SESSID,"chain",IDX,"raw")="RAWCERT"
 D VERIFY(SESSID)
 I $D(^GLBTLS(SESSID,"chain",IDX,"raw")) S RESULT=RESULT+4
 I $G(^GLBTLS(SESSID,"chain",IDX,"status"))'="V" S RESULT=RESULT+8
 ;
 K ^GLBTLS(SESSID,"chain",99)
 S ^GLBTLS(SESSID,"chain",99,"raw","status")="phantom"
 D VERIFY(SESSID)
 I $D(^GLBTLS(SESSID,"chain",99,"status")) S RESULT=RESULT+16
 Q

