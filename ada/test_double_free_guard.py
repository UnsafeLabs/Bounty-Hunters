"""Acceptance logic for Ada Free_Chain null-guard (issue #564)."""

class Ptr:
    def __init__(self, name):
        self.name = name
        self.freed = False

def free_chain_safe(chain_holder):
    chain = chain_holder[0]
    if chain is not None:
        assert not chain.freed, "double free"
        chain.freed = True
        chain_holder[0] = None

# happy path
h = [Ptr("c")]
free_chain_safe(h)
assert h[0] is None
# exception path: already freed
h2 = [Ptr("c2")]
free_chain_safe(h2)
free_chain_safe(h2)  # must not double free
print("Ada double-free guard tests: ALL PASSED")
