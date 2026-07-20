% Certificate chain verification with cycle detection (issue #565)
% Uses visited set to prevent non-terminating unification on circular issuers.

:- module(verify_chain_mod, [
    verify_chain/3,
    resolve_issuer_chain/4,
    byte//1
]).

% Max chain depth
max_chain_depth(10).

verify_chain(Chain, Store, Result) :-
    length(Chain, Len),
    max_chain_depth(Max),
    (   Len > Max
    ->  Result = chain_too_deep
    ;   verify_chain_(Chain, Store, Result)
    ).

verify_chain_([], _, valid).
verify_chain_([Cert|Rest], Store, Result) :-
    extract_issuer(Cert, IssuerDN),
    find_issuer(IssuerDN, Store, IssuerCert),
    verify_signature(Cert, IssuerCert),
    verify_chain_(Rest, Store, Result).

% resolve with visited list (cycle guard)
resolve_issuer_chain(Cert, Store, RootCert) :-
    resolve_issuer_chain(Cert, Store, [], RootCert).

resolve_issuer_chain(Cert, Store, Visited, RootCert) :-
    extract_issuer(Cert, IDN),
    \+ member(IDN, Visited),
    (   is_self_signed(Cert)
    ->  RootCert = Cert
    ;   find_issuer(IDN, Store, IC),
        resolve_issuer_chain(IC, Store, [IDN|Visited], RootCert)
    ).

% Deterministic byte DCG (no 0..255 choice points)
byte(X) --> [X], { integer(X), X >= 0, X =< 255, ! }.

% Stubs for structure (real implementations elsewhere)
extract_issuer(cert(subject(_), issuer(DN)), DN).
is_self_signed(cert(subject(DN), issuer(DN))).
find_issuer(DN, Store, Cert) :- member(Cert, Store), Cert = cert(subject(DN), _).
verify_signature(_, _).

% Thread-local trust store guards (SWI-Prolog)
% :- thread_local trusted/2.
% :- dynamic trusted/2.
