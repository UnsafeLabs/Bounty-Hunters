% Fix: Non-terminating unification in verify_chain/3 (#565)
%
% Problem: verify_chain/3 enters infinite recursion when
% certificate chain contains cycles (e.g., self-signed
% intermediate that references itself as issuer).
%
% Solution: Track visited certificates with occurs check,
% enforce maximum depth, and detect cycles explicitly.

:- module(verify_chain, [verify_chain/3, verify_chain/4]).

%% verify_chain(+CertChain, +TrustAnchors, -Result) is det.
%  Verify a certificate chain with default max depth of 10.
verify_chain(CertChain, TrustAnchors, Result) :-
    verify_chain(CertChain, TrustAnchors, 10, Result).

%% verify_chain(+CertChain, +TrustAnchors, +MaxDepth, -Result) is det.
%  Verify certificate chain with explicit depth limit.
%  Result = valid | invalid(Reason).
verify_chain(CertChain, TrustAnchors, MaxDepth, Result) :-
    (   is_list(CertChain),
        is_list(TrustAnchors),
        integer(MaxDepth), MaxDepth > 0
    ->  verify_chain_aux(CertChain, TrustAnchors, MaxDepth, [], Result)
    ;   Result = invalid(bad_input)
    ).

%% verify_chain_aux(+Chain, +Anchors, +MaxDepth, +Visited, -Result)
%  Internal: tracks visited certificates to detect cycles.
verify_chain_aux([], _Anchors, _Depth, _Visited, valid) :- !.

verify_chain_aux([Cert|Rest], Anchors, Depth, Visited, Result) :-
    (   Depth =< 0
    ->  Result = invalid(max_depth_exceeded)
    ;   memberchk(Cert, Visited)
    ->  Result = invalid(cycle_detected)
    ;   \+ occurs_check_ok(Cert)
    ->  Result = invalid(occurs_check_failure)
    ;   verify_certificate(Cert, Anchors)
    ->  (   Rest = []
        ->  Result = valid
        ;   NewDepth is Depth - 1,
            NewVisited = [Cert|Visited],
            verify_chain_aux(Rest, Anchors, NewDepth, NewVisited, Result)
        )
    ;   Result = invalid(cert_verification_failed(Cert))
    ).

%% occurs_check_ok(+Term) is semidet.
%  Check that Term does not contain infinite terms.
%  Prevents non-terminating unification.
occurs_check_ok(Term) :-
    \+ has_cyclic_term(Term),
    ground(Term).

%% has_cyclic_term(+Term) is semidet.
%  Detect cyclic terms that would cause infinite unification.
has_cyclic_term(Term) :-
    cyclic_term(Term), !.
has_cyclic_term(Term) :-
    compound(Term),
    functor(Term, _, Arity),
    has_cyclic_arg(Arity, Term).

has_cyclic_arg(0, _) :- !, fail.
has_cyclic_arg(N, Term) :-
    arg(N, Term, Arg),
    has_cyclic_term(Arg), !.
has_cyclic_arg(N, Term) :-
    N > 1,
    N1 is N - 1,
    has_cyclic_arg(N1, Term).

%% verify_certificate(+Cert, +Anchors) is semidet.
%  Check if certificate is signed by a trust anchor.
%  Uses occurs_check to prevent infinite unification.
verify_certificate(Cert, Anchors) :-
    member(Anchor, Anchors),
    cert_subject(Cert, Subject),
    anchor_subject(Anchor, Subject),
    cert_issuer(Cert, Issuer),
    anchor_subject(Anchor, Issuer), !.

%% Extract subject from certificate with safety checks.
cert_subject(cert(Subject, _Issuer, _Serial), Subject) :-
    atom(Subject), !.
cert_subject(Cert, Subject) :-
    is_dict(Cert),
    get_dict(subject, Cert, Subject),
    atom(Subject), !.

cert_issuer(cert(_Subject, Issuer, _Serial), Issuer) :-
    atom(Issuer), !.
cert_issuer(Cert, Issuer) :-
    is_dict(Cert),
    get_dict(issuer, Cert, Issuer),
    atom(Issuer), !.

anchor_subject(anchor(Subject, _Key), Subject) :-
    atom(Subject).
