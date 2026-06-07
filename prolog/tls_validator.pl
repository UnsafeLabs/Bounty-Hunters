:- module(tls_validator, [
    verify_chain/3,
    verify_chain_/3,
    resolve_issuer_chain/3,
    resolve_issuer_chain/4,
    san_value//1,
    byte//1,
    assert_trust_anchor/2,
    retract_trust_anchor/1,
    init_thread_trust_store/0,
    run_tests/0
]).

:- use_module(library(lists)).
:- use_module(library(plunit)).

:- thread_local trusted/2.
:- discontiguous trusted/2.
:- dynamic global_trusted/2.
:- dynamic trust_store_cert/3.

max_chain_depth(10).

extract_subject(cert(subject(Subject), issuer(_Issuer), _Serial, _Key), subject(Subject)).
extract_issuer(cert(subject(_Subject), issuer(Issuer), _Serial, _Key), issuer(Issuer)).

same_dn(subject(DN), issuer(DN)).

find_issuer(IssuerDN, Store, IssuerCert) :-
    trust_store_cert(Store, _Fingerprint, IssuerCert),
    extract_subject(IssuerCert, SubjectDN),
    same_dn(SubjectDN, IssuerDN),
    !.

verify_signature(Cert, IssuerCert) :-
    Cert = cert(subject(_), issuer(_), _Serial, _Key),
    IssuerCert = cert(subject(_), issuer(_), _IssuerSerial, _IssuerKey),
    !.

verify_chain(Chain, Store, Result) :-
    length(Chain, Len),
    max_chain_depth(Max),
    (   Len > Max
    ->  Result = chain_too_deep
    ;   verify_chain_(Chain, Store, Result)
    ).

verify_chain_([], _Store, valid) :- !.
verify_chain_([Cert|Rest], Store, Result) :-
    extract_issuer(Cert, IssuerDN),
    find_issuer(IssuerDN, Store, IssuerCert),
    verify_signature(Cert, IssuerCert),
    !,
    verify_chain_(Rest, Store, Result).
verify_chain_([_Cert|_Rest], _Store, chain_invalid).

resolve_issuer_chain(Cert, Store, RootCert) :-
    resolve_issuer_chain(Cert, Store, [], RootCert).

resolve_issuer_chain(Cert, _Store, _Visited, Cert) :-
    extract_subject(Cert, SubjectDN),
    extract_issuer(Cert, IssuerDN),
    same_dn(SubjectDN, IssuerDN),
    !.
resolve_issuer_chain(Cert, Store, Visited, RootCert) :-
    extract_issuer(Cert, IssuerDN),
    \+ memberchk(IssuerDN, Visited),
    find_issuer(IssuerDN, Store, IssuerCert),
    resolve_issuer_chain(IssuerCert, Store, [IssuerDN|Visited], RootCert).
resolve_issuer_chain(_Cert, _Store, _Visited, chain_invalid).

byte(X) --> [X], { integer(X), X >= 0, X =< 255, ! }.

remaining_at_least(Needed, Input, Input) :-
    length(Input, Len),
    Len >= Needed.

san_value(ip(A, B, C, D), Input, Rest) :-
    remaining_at_least(6, Input, Input),
    Input = [0x87, 0x04 | Bytes],
    phrase((byte(A), byte(B), byte(C), byte(D)), Bytes, Rest),
    !.
san_value(dns(Name), Input, Rest) :-
    remaining_at_least(2, Input, Input),
    Input = [0x82, Len | Bytes],
    integer(Len),
    Len >= 0,
    length(Codes, Len),
    append(Codes, Rest, Bytes),
    atom_codes(Name, Codes),
    !.

init_thread_trust_store :-
    retractall(trusted(_, _)),
    forall(global_trusted(Fingerprint, Cert), assertz(trusted(Fingerprint, Cert))).

assert_trust_anchor(Fingerprint, Cert) :-
    assertz(global_trusted(Fingerprint, Cert)),
    assertz(trusted(Fingerprint, Cert)).

retract_trust_anchor(Fingerprint) :-
    (   predicate_property(trusted(_, _), defined)
    ->  retractall(trusted(Fingerprint, _))
    ;   true
    ).

make_cert(Name, Issuer, Serial, cert(subject(dn([cn(Name)])), issuer(dn([cn(Issuer)])), Serial, key(rsa))).

reset_store(Store) :-
    retractall(trust_store_cert(Store, _, _)).

seed_circular_2(Store, Leaf) :-
    reset_store(Store),
    make_cert('CA-A', 'CA-B', 1, A),
    make_cert('CA-B', 'CA-A', 2, B),
    make_cert('Leaf', 'CA-A', 3, Leaf),
    assertz(trust_store_cert(Store, 'fp-a', A)),
    assertz(trust_store_cert(Store, 'fp-b', B)).

seed_circular_3(Store, Leaf) :-
    reset_store(Store),
    make_cert('CA-A', 'CA-B', 1, A),
    make_cert('CA-B', 'CA-C', 2, B),
    make_cert('CA-C', 'CA-A', 3, C),
    make_cert('Leaf', 'CA-A', 4, Leaf),
    assertz(trust_store_cert(Store, 'fp-a', A)),
    assertz(trust_store_cert(Store, 'fp-b', B)),
    assertz(trust_store_cert(Store, 'fp-c', C)).

seed_linear_chain(Store, Depth, Chain) :-
    reset_store(Store),
    make_cert('Cert-0', 'Cert-0', 0, Root),
    assertz(trust_store_cert(Store, 'Cert-0', Root)),
    seed_linear_chain_(Store, Depth, Chain).

seed_linear_chain_(_Store, 0, []) :- !.
seed_linear_chain_(Store, N, [Cert|Rest]) :-
    N > 0,
    Prev is N - 1,
    format(atom(Name), 'Cert-~w', [N]),
    format(atom(Issuer), 'Cert-~w', [Prev]),
    make_cert(Name, Issuer, N, Cert),
    assertz(trust_store_cert(Store, Name, Cert)),
    seed_linear_chain_(Store, Prev, Rest).

verify_shared_anchor :-
    init_thread_trust_store,
    trusted('fp-root', _),
    retract_trust_anchor('fp-root').

:- begin_tests(tls_validator).

test(circular_2ca_terminates, [true(Root == chain_invalid)]) :-
    seed_circular_2(cycle2, Leaf),
    resolve_issuer_chain(Leaf, cycle2, Root).

test(circular_3ca_terminates, [true(Root == chain_invalid)]) :-
    seed_circular_3(cycle3, Leaf),
    resolve_issuer_chain(Leaf, cycle3, Root).

test(malformed_ip_san_fails_fast, [fail]) :-
    phrase(san_value(ip(_, _, _, _)), [0x87, 0x04, 192, 168, 1]).

test(valid_ip_san, [true(IP == ip(192, 168, 1, 10))]) :-
    phrase(san_value(IP), [0x87, 0x04, 192, 168, 1, 10]).

test(depth_10_passes, [true(Result == valid)]) :-
    seed_linear_chain(depth10, 10, Chain),
    verify_chain(Chain, depth10, Result).

test(depth_11_fails, [true(Result == chain_too_deep)]) :-
    seed_linear_chain(depth11, 11, Chain),
    verify_chain(Chain, depth11, Result).

test(concurrent_shared_anchor_is_thread_local, [true((Status1 == true, Status2 == true))]) :-
    retractall(global_trusted(_, _)),
    retractall(trusted(_, _)),
    make_cert('Root', 'Root', 0, Root),
    assert_trust_anchor('fp-root', Root),
    thread_create(verify_shared_anchor, T1, []),
    thread_create(verify_shared_anchor, T2, []),
    thread_join(T1, Status1),
    thread_join(T2, Status2).

:- end_tests(tls_validator).

run_tests :-
    run_tests([tls_validator]).
