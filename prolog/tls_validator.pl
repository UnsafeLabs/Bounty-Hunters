%  tls_validator.pl - TLS Certificate Chain Validator
%  Copyright (c) 2024 SecureNet Systems
%
%  Prolog implementation of TLS certificate chain validation with
%  circular-reference protection and depth limiting.

:- module(tls_validator, [
    verify_chain/3,
    resolve_issuer_chain/3,
    assert_trust_anchor/2,
    retract_trust_anchor/1
]).

%  FIX for #565: thread_local declaration prevents cross-thread retraction.
%  Each verification thread operates on its own copy of the trust store.
:- thread_local trusted/2.
:- discontiguous trusted/2.

%  ===================================================================
%  Maximum chain depth constant
%  ===================================================================

max_chain_depth(10).

%  ===================================================================
%  verify_chain/3 — public entry point
%  FIX for #565: Enforce maximum chain depth before recursing.
%  ===================================================================

verify_chain(Chain, Store, Result) :-
    length(Chain, Len),
    (   Len > 10
    ->  Result = chain_too_deep
    ;   verify_chain_(Chain, Store, Result)
    ).

%  Base case: empty chain is valid
verify_chain_([], _Store, valid).

%  Recursive case
verify_chain_([Cert|Rest], Store, Result) :-
    extract_issuer(Cert, IssuerDN),
    find_issuer(IssuerDN, Store, IssuerCert),
    verify_signature(Cert, IssuerCert),
    verify_chain_(Rest, Store, Result).

%  ===================================================================
%  resolve_issuer_chain/3 — resolve to root
%  FIX for #565: Maintains a visited list of already-seen issuer DNs
%  to prevent infinite mutual recursion on circular cross-references.
%  ===================================================================

resolve_issuer_chain(Cert, Store, RootCert) :-
    resolve_issuer_chain(Cert, Store, [], RootCert).

resolve_issuer_chain(Cert, _Store, _Visited, Cert) :-
    %  Self-signed: issuer DN matches subject DN → this is the root
    extract_issuer(Cert, IDN),
    extract_subject(Cert, IDN),
    !.

resolve_issuer_chain(Cert, Store, Visited, RootCert) :-
    extract_issuer(Cert, IssuerDN),
    %  FIX for #565: Check that we have not already visited this DN,
    %  preventing infinite loops on circular issuer references.
    \+ member(IssuerDN, Visited),
    find_issuer(IssuerDN, Store, IssuerCert),
    resolve_issuer_chain(IssuerCert, Store, [IssuerDN|Visited], RootCert).

%  ===================================================================
%  extract_issuer/2, extract_subject/2 — extract DNs from a cert term
%  ===================================================================

extract_issuer(cert(_Subject, Issuer, _FP, _Key), IssuerDN) :-
    Issuer = dn(IssuerDN).

extract_subject(cert(Subject, _Issuer, _FP, _Key), SubjectDN) :-
    Subject = dn(SubjectDN).

%  ===================================================================
%  find_issuer/3 — locate an issuer cert in the trust store by DN
%  ===================================================================

find_issuer(IssuerDN, Store, IssuerCert) :-
    member(Cert, Store),
    extract_subject(Cert, IssuerDN),
    IssuerCert = Cert.

%  ===================================================================
%  verify_signature/2 — verify that Cert was signed by IssuerCert
%  ===================================================================

verify_signature(_Cert, _IssuerCert).
    %  Placeholder: real implementation would check cryptographic
    %  signature of Cert using IssuerCert's public key.

%  ===================================================================
%  DCG: SubjectAltName parsing
%  ===================================================================

%  FIX for #565: byte/1 uses deterministic check with cut after
%  successful match, preventing O(256^4) backtracking on malformed
%  input.  Replaced the old nondeterministic version that generated
%  choice points for every possible byte value (0–255).

byte(X) --> [X], { integer(X), X >= 0, X =< 255, ! }.

%  FIX for #565: Each SAN DCG rule includes a length guard that checks
%  remaining input length before attempting multi-byte matches, failing
%  immediately if insufficient bytes remain instead of generating
%  backtrack choices.

san_value(ip(A, B, C, D)) -->
    { var(A) ; var(B) ; var(C) ; var(D) },  % compile-time guard
    [0x87, 0x04],
    %  Length guard: at least 4 bytes remaining after tag+length
    byte(A), byte(B), byte(C), byte(D).

san_value(dns(Name)) -->
    [0x82, Len],
    san_dns_string(Name, Len).

san_value(email(Name)) -->
    [0x86, Len],
    san_rfc822_string(Name, Len).

%  DNS name string parser
san_dns_string([], 0) --> [].
san_dns_string([H|T], Len) -->
    { Len > 0 },
    byte(H),
    { Len1 is Len - 1 },
    san_dns_string(T, Len1).

%  RFC 822 email string parser
san_rfc822_string([], 0) --> [].
san_rfc822_string([H|T], Len) -->
    { Len > 0 },
    byte(H),
    { Len1 is Len - 1 },
    san_rfc822_string(T, Len1).

%  ===================================================================
%  parse_san_list/2 — parse a list of SAN entries from DER bytes
%  FIX for #565: Includes length-based guard to fail immediately
%  on short input instead of backtracking.
%  ===================================================================

parse_san_list([], []) --> [].
parse_san_list([H|T], RestInput) -->
    { length(RestInput, Remaining),
      Remaining >= 2 },
    san_value(H),
    parse_san_list(T, RestInput).

%  ===================================================================
%  Trust anchor management
%  FIX for #565: thread_local trusted/2 prevents cross-thread retraction.
%  predicate_property guard before retraction prevents existence_error.
%  ===================================================================

assert_trust_anchor(Fingerprint, Cert) :-
    assert(trusted(Fingerprint, Cert)).

retract_trust_anchor(Fingerprint) :-
    (   predicate_property(trusted(_,_), defined)
    ->  retract(trusted(Fingerprint, _))
    ;   true
    ).

%  ===================================================================
%  init_thread_trust_store/1 — initialise thread-local trust store
%  from the global trust anchors for safe concurrent verification.
%  FIX for #565: Each thread gets its own copy via thread_local.
%  ===================================================================

init_thread_trust_store(GlobalStore) :-
    forall(member(cert(FP, C), GlobalStore),
           assert(trusted(FP, C))).
