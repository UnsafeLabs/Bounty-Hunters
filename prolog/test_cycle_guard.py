"""Python model of Prolog visited-set cycle guard (issue #565)."""

def resolve_issuer_chain(cert, store, visited=None):
    if visited is None:
        visited = []
    issuer = cert["issuer"]
    if issuer in visited:
        return ("cycle", None)
    if cert["subject"] == cert["issuer"]:
        return ("root", cert)
    for c in store:
        if c["subject"] == issuer:
            return resolve_issuer_chain(c, store, visited + [issuer])
    return ("missing", None)

def verify_chain(chain, store):
    if len(chain) > 10:
        return "chain_too_deep"
    return "valid"

# Circular CA-A <-> CA-B
a = {"subject": "CA-A", "issuer": "CA-B"}
b = {"subject": "CA-B", "issuer": "CA-A"}
status, _ = resolve_issuer_chain(a, [a, b])
assert status == "cycle"
assert verify_chain([0]*11, []) == "chain_too_deep"
assert verify_chain([0]*10, []) == "valid"
print("Prolog cycle guard tests: ALL PASSED")
